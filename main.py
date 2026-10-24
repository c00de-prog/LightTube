"""LightTube beta: shared browser recommendations and local HLS playback."""
import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlparse, urlencode

from playback import quality_format, select_video, quality_details, available_video_qualities, AUDIO_PATTERN, select_audio, startup_format, progressive_format, format_diagnostics, proxy_media, safe_headers

from profiles import browser_profiles, profile_path, load_preferences, save_preferences

import yt_dlp
from yt_dlp.cookies import load_cookies
from session_cookies import MemoryYoutubeDL, YouTubeCookiePolicy, youtube_domain
import httpx
from yt_dlp.networking import Request as YouTubeRequest
from youtube_feed import parse_cards, parse_page, cards_from_data, continuation, FeedParseError
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
SEGMENT = re.compile(r"segment-\d{6,}\.ts")
logger = logging.getLogger("uvicorn.error")


def get_video_id(value):
    value = value.strip()
    if VIDEO_ID.fullmatch(value):
        return value
    try:
        parsed = urlparse(value)
        if (parsed.scheme != "https" or parsed.username or parsed.password
                or parsed.port not in (None, 443)):
            raise ValueError()
        host = (parsed.hostname or "").lower()
        parts = parsed.path.strip("/").split("/")
        if host == "youtu.be":
            result = parsed.path.strip("/")
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
            if parsed.path == "/watch":
                result = parse_qs(parsed.query).get("v", [""])[0]
            elif len(parts) == 2 and parts[0] in {"shorts", "live", "embed"}:
                result = parts[1]
            else:
                raise ValueError()
        else:
            raise ValueError()
        if not VIDEO_ID.fullmatch(result):
            raise ValueError()
        return result
    except ValueError:
        raise ValueError("Нужна HTTPS-ссылка YouTube или ID видео.") from None


def find_deno():
    configured = os.environ.get("LIGHTTUBE_DENO")
    if configured and Path(configured).is_file():
        return configured
    executable = shutil.which("deno")
    if executable:
        return executable
    local = os.environ.get("LOCALAPPDATA")
    if local:
        packages = Path(local) / "Microsoft" / "WinGet" / "Packages"
        for package in packages.glob("DenoLand.Deno_*"):
            executable = package / "deno.exe"
            if executable.is_file():
                return str(executable)
    executable = Path.home() / ".deno" / "bin" / ("deno.exe" if os.name == "nt" else "deno")
    return str(executable) if executable.is_file() else None


class SafeYDLLogger:
    """Do not expose cookie contents or signed media URLs in normal logs."""
    def debug(self, message):
        pass
    def warning(self, message):
        pass
    def error(self, message):
        pass


class YouTubeService:
    def __init__(self):
        self.deno = find_deno()
        self.network_lock = threading.Lock()
        self.cookie_lock = threading.Lock()
        self._session_cookies = None
        self.playback_pending = threading.Event()
        self.blocked_until = 0.0
        self.feed = None
        self.feed_at = 0.0
        self.feed_attempt = 0.0
        self.feed_warning = ""
        self.search_cache = {}
        self.search_attempt = 0.0
        self.image_lock = threading.Lock()
        self.image_sources = OrderedDict()
        self.metadata = {}
        self.browser = os.environ.get("LIGHTTUBE_COOKIE_BROWSER", "firefox").lower()
        prefs = load_preferences()
        if prefs.get("browser") in {"none", "firefox", "chrome", "edge", "chromium", "brave", "opera", "vivaldi", "safari"}:
            self.browser = prefs["browser"]
        self.profile = prefs.get("profile", "auto") if isinstance(prefs.get("profile", "auto"), str) else "auto"
        self.ask_profile = prefs.get("ask_profile", True) is not False
        self.default_quality = prefs.get("quality", 720) if prefs.get("quality", 720) in {0, 360, 480, 720, 1080} else 720
        self.default_audio = prefs.get("audio", "auto") if isinstance(prefs.get("audio"), str) and re.fullmatch(AUDIO_PATTERN, prefs["audio"]) else "auto"
        self.settings_generation = 0
        self.page_cursors = OrderedDict()
        self.latest_cursor = None
        self.feed_cursor = None
        self.related_cache = {}
        self.channel_cache = {}
        self.page_attempt = 0.0

    def register_image(self, url):
        if not isinstance(url, str) or not url:
            return ""
        try:
            parsed = urlparse(url)
            if (parsed.scheme != "https" or parsed.hostname not in {
                    "i.ytimg.com", "yt3.ggpht.com", "yt3.googleusercontent.com"}
                    or parsed.username or parsed.password or parsed.port not in (None, 443)):
                return ""
        except ValueError:
            return ""
        key = hashlib.sha256(url.encode()).hexdigest()[:32]
        with self.image_lock:
            self.image_sources[key] = url
            self.image_sources.move_to_end(key)
            while len(self.image_sources) > 1024:
                self.image_sources.popitem(last=False)
        return "/api/images/" + key

    def local_images(self, items):
        for item in items:
            for field in ("thumbnail", "avatar"):
                item[field] = self.register_image(item.get(field, ""))
        return items

    def options(self):
        options = {
            "quiet": True, "logger": SafeYDLLogger(),
            "source_address": "0.0.0.0", "socket_timeout": 15,
            "retries": 1, "extractor_retries": 1,
            "noplaylist": True, "mark_watched": False,
        }
        browser = self.browser
        if browser not in {"none", "firefox", "chrome", "edge", "chromium", "brave", "opera", "vivaldi", "safari"}:
            raise ValueError("Выбери поддерживаемый браузер в настройках.")
        if browser != "none":
            profile = profile_path(browser, self.profile)
            options["cookiesfrombrowser"] = (browser, profile) if profile else (browser,)
        if self.deno:
            options["js_runtimes"] = {"deno": {"path": self.deno}}
        return options

    def memory_cookies(self, specification, ydl):
        with self.cookie_lock:
            if self._session_cookies is None:
                jar = load_cookies(None, specification, ydl)
                # Browser extraction can read unrelated sites; do not retain them.
                for cookie in list(jar):
                    if not youtube_domain(cookie.domain):
                        jar.clear(cookie.domain, cookie.path, cookie.name)
                jar.filename = None
                jar.set_policy(YouTubeCookiePolicy())
                self._session_cookies = jar
            return self._session_cookies

    def ydl(self, options=None):
        options = dict(self.options() if options is None else options)
        specification = options.get("cookiesfrombrowser")
        return MemoryYoutubeDL(options, lambda ydl: self.memory_cookies(specification, ydl))

    def clear_session_cookies(self):
        with self.cookie_lock:
            if self._session_cookies is not None:
                self._session_cookies.clear()
            self._session_cookies = None

    def check_access(self):
        remaining = int(self.blocked_until - time.monotonic())
        if remaining > 0:
            raise RuntimeError(f"YouTube ограничил запросы. Повтори через {remaining + 1} с.")

    def explain(self, error):
        text = str(error).lower()
        if "429" in text or "not a bot" in text:
            self.blocked_until = time.monotonic() + 300
            return "YouTube требует проверку или ограничил запросы. Пауза на 5 минут; проверь YouTube в выбранном браузере."
        if any(word in text for word in ("cookie", "cookies", "profile", "dpapi", "decrypt")):
            return "Не удалось прочитать сессию выбранного браузера. Закрой его перед повтором. На Windows Chrome/Edge могут запрещать расшифровку cookies; попробуй Firefox."
        if "requested format" in text:
            return "Нет совместимого H.264/AAC в выбранном качестве. Попробуй другое качество или видео."
        if "login" in text or "sign in" in text:
            return "Нужен вход в YouTube в выбранном браузере на серверном ПК."
        return "YouTube не вернул данные. Проверь соединение, версию yt-dlp и доступ к ролику в выбранном браузере."

    def fetch_cards(self, path, scope="home"):
        self.check_access()
        options = self.options()
        with self.ydl(options) as ydl:
            # urlopen uses yt-dlp's cookie jar, TLS handlers and IPv4 option.
            # Accessing cookiejar eagerly gives a useful error if Firefox fails.
            _ = ydl.cookiejar
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
                "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml",
            }
            with ydl.urlopen(YouTubeRequest("https://www.youtube.com" + path, headers=headers)) as response:
                final_host = (urlparse(response.url).hostname or "").lower()
                if final_host not in {"youtube.com", "www.youtube.com"}:
                    raise FeedParseError("YouTube перенаправил на страницу входа или согласия. Открой главную в выбранном браузере на серверном ПК.")
                data = response.read(8 * 1024 * 1024 + 1)
                if len(data) > 8 * 1024 * 1024:
                    raise FeedParseError("Страница YouTube слишком большая для текущего лимита парсера.")
        page = parse_page(data.decode("utf-8", errors="replace"), scope=scope, limit=60)
        self.latest_cursor = self.register_cursor(page["continuation"], page["config"])
        return self.local_images(page["items"])

    def recommendations(self, refresh=False):
        with self.network_lock:
            now = time.monotonic()
            if self.feed is not None and not refresh and now - self.feed_at < 300:
                return {"items": self.feed, "cached": True, "checked_at": self.feed_wall,
                        "warning": self.feed_warning, "source": "youtube-home-html", "cursor": self.feed_cursor}
            if self.feed_attempt and now - self.feed_attempt < 60:
                remaining = max(1, int(60 - (now - self.feed_attempt)))
                notice = f"Повторная проверка через {remaining} с."
                return {"items": self.feed or [], "cached": self.feed is not None,
                        "checked_at": getattr(self, "feed_wall", None),
                        "warning": (self.feed_warning + " " + notice).strip(),
                        "source": "youtube-home-html", "cursor": self.feed_cursor}
            self.feed_attempt = now
            try:
                items = self.fetch_cards("/?hl=ru")
                self.feed = items
                self.feed_cursor = self.latest_cursor
                self.feed_at = time.monotonic()
                self.feed_wall = int(time.time())
                self.feed_warning = ""
                return {"items": items, "cached": False, "checked_at": self.feed_wall,
                        "warning": "", "source": "youtube-home-html", "cursor": self.feed_cursor}
            except Exception as error:
                warning = str(error) if isinstance(error, FeedParseError) else self.explain(error)
                self.feed_warning = warning
                logger.warning("Recommendations unavailable: %s", warning)
                return {"items": self.feed or [], "cached": self.feed is not None,
                        "checked_at": getattr(self, "feed_wall", None),
                        "warning": warning, "source": "youtube-home-html", "cursor": self.feed_cursor}

    def channel_videos(self, identifier):
        with self.network_lock:
            cached = self.channel_cache.get(identifier)
            if cached and cached[0] > time.monotonic():
                return cached[1]
            try:
                self.check_access()
                items = self.fetch_cards(f"/channel/{identifier}/videos?hl=ru")
                result = {"items": items, "cursor": self.latest_cursor, "warning": ""}
                if len(self.channel_cache) >= 12:
                    self.channel_cache.pop(next(iter(self.channel_cache)))
                self.channel_cache[identifier] = (time.monotonic() + 180, result)
                return result
            except Exception as error:
                return {"items": [], "cursor": None, "warning": self.explain(error)}

    def search(self, query):
        with self.network_lock:
            now = time.monotonic()
            cached = self.search_cache.get(query)
            if cached and cached[0] > now:
                return {"items": cached[1], "warning": "", "cached": True, "cursor": cached[2]}
            if self.search_attempt and now - self.search_attempt < 5:
                return {"items": [], "warning": "Подожди несколько секунд перед новым поиском.", "cached": False}
            self.search_attempt = now
            try:
                items = self.fetch_cards("/results?" + urlencode({"search_query": query, "hl": "ru"}), scope="search")
                while len(self.search_cache) >= 12:
                    self.search_cache.pop(next(iter(self.search_cache)))
                self.search_cache[query] = (time.monotonic() + 180, items, self.latest_cursor)
                return {"items": items, "warning": "", "cached": False, "cursor": self.latest_cursor}
            except Exception as error:
                warning = str(error) if isinstance(error, FeedParseError) else self.explain(error)
                return {"items": [], "warning": warning, "cached": False}

    def register_cursor(self, next_page, config):
        if not next_page or not isinstance(config.get("INNERTUBE_CONTEXT"), dict):
            return None
        key = secrets.token_urlsafe(18)
        self.page_cursors[key] = {"next": next_page, "config": config,
                                  "expires": time.monotonic() + 900, "result": None}
        while len(self.page_cursors) > 80:
            self.page_cursors.popitem(last=False)
        return key

    def more(self, key):
        with self.network_lock:
            page = self.page_cursors.get(key)
            if not page or page["expires"] < time.monotonic():
                return {"items": [], "cursor": None, "warning": "Список устарел. Обнови рекомендации."}
            if page["result"] is not None:
                return page["result"]
            now = time.monotonic()
            if self.page_attempt and now - self.page_attempt < 5:
                return {"items": [], "cursor": key, "warning": "Подожди несколько секунд перед загрузкой следующей страницы."}
            self.page_attempt = now
            try:
                self.check_access()
                from yt_dlp.extractor.youtube import YoutubeTabIE
                config = page["config"]
                next_page = page["next"]
                with self.ydl() as ydl:
                    # yt-dlp builds authentication headers from this browser's session.
                    extractor = YoutubeTabIE(ydl)
                    headers = extractor.generate_api_headers(ytcfg=config)
                    headers.update({"Content-Type": "application/json", "Origin": "https://www.youtube.com"})
                    payload = {"context": config["INNERTUBE_CONTEXT"], "continuation": next_page["token"]}
                    params = {"prettyPrint": "false"}
                    if config.get("INNERTUBE_API_KEY"):
                        params["key"] = config["INNERTUBE_API_KEY"]
                    url = "https://www.youtube.com/youtubei/v1/" + next_page["endpoint"] + "?" + urlencode(params)
                    with ydl.urlopen(YouTubeRequest(url, data=json.dumps(payload).encode(), headers=headers, method="POST")) as response:
                        raw = response.read(8 * 1024 * 1024 + 1)
                        if len(raw) > 8 * 1024 * 1024:
                            raise FeedParseError("Следующая страница слишком большая.")
                data = json.loads(raw)
                items = self.local_images(cards_from_data(data, 60, allow_empty=True))
                cursor = self.register_cursor(continuation(data, next_page["endpoint"]), config)
                result = {"items": items, "cursor": cursor, "warning": ""}
                page["result"] = result
                return result
            except Exception as error:
                warning = str(error) if isinstance(error, FeedParseError) else self.explain(error)
                return {"items": [], "cursor": key, "warning": warning}

    def related(self, identifier):
        with self.network_lock:
            cached = self.related_cache.get(identifier)
            if cached and cached[0] > time.monotonic():
                return {"items": cached[1], "cursor": cached[2], "warning": ""}
            try:
                items = self.fetch_cards("/watch?" + urlencode({"v": identifier, "hl": "ru"}), scope="related")
                items = [item for item in items if item["id"] != identifier]
                if len(self.related_cache) >= 12:
                    self.related_cache.pop(next(iter(self.related_cache)))
                self.related_cache[identifier] = (time.monotonic() + 300, items, self.latest_cursor)
                return {"items": items, "cursor": self.latest_cursor, "warning": ""}
            except Exception as error:
                warning = str(error) if isinstance(error, FeedParseError) else self.explain(error)
                return {"items": [], "cursor": None, "warning": warning}

    def configure(self, browser, quality, profile=None, ask_profile=None, audio=None):
        with self.network_lock:
            profile = profile if profile is not None else (self.profile if browser == self.browser else "auto")
            if browser != "none":
                profile_path(browser, profile)
            ask = self.ask_profile if ask_profile is None else ask_profile
            audio = self.default_audio if audio is None else audio
            if not re.fullmatch(AUDIO_PATTERN, audio):
                raise ValueError("Неизвестный язык озвучки.")
            save_preferences(browser, profile, quality, ask, audio)
            self.default_audio = audio
            changed = browser != self.browser or profile != self.profile
            self.profile = profile
            self.ask_profile = ask
            self.browser = browser
            self.default_quality = quality
            if changed:
                self.clear_session_cookies()
                self.settings_generation += 1
                self.feed = None
                self.feed_at = self.feed_attempt = 0
                self.feed_warning = ""
                self.feed_cursor = None
                self.search_cache.clear()
                self.related_cache.clear()
                self.channel_cache.clear()
                self.metadata.clear()
                self.page_cursors.clear()
            return changed

    def extract(self, identifier, quality, speculative=False, expected_generation=None):
        quality = quality or 1080
        key = (identifier, quality)
        if not self.network_lock.acquire(blocking=not speculative):
            return None
        try:
            if expected_generation is not None and expected_generation != self.settings_generation:
                return None
            if speculative and self.playback_pending.is_set():
                return None
            cached = self.metadata.get(key)
            if cached and cached[0] > time.monotonic():
                return dict(cached[1], _lighttube_cache_hit=True)
            self.check_access()
            options = self.options()
            if speculative:
                options.update(socket_timeout=5, retries=0, extractor_retries=0)
            options["format_sort"] = ["lang", "res", "fps", "vbr", "tbr"]
            options["format"] = quality_format(quality)
            try:
                with self.ydl(options) as ydl:
                    info = ydl.extract_info("https://www.youtube.com/watch?v=" + identifier, download=False)
            except Exception as error:
                raise RuntimeError(self.explain(error)) from None
            if info.get("is_live") or info.get("is_upcoming"):
                raise ValueError("Трансляции и премьеры пока не поддерживаются.")
            if len(self.metadata) >= 24:
                self.metadata.pop(next(iter(self.metadata)))
            ttl = 180
            for source in info.get("requested_formats") or [info]:
                try:
                    expires = parse_qs(urlparse(source.get("url", "")).query).get("expire", [None])[0]
                    if expires is not None:
                        ttl = min(ttl, max(0, float(expires) - time.time() - 30))
                except (TypeError, ValueError):
                    pass
            expiry = time.monotonic() + ttl
            self.metadata[key] = (expiry, info)
            return dict(info, _lighttube_cache_hit=False)
        finally:
            self.network_lock.release()


def input_arguments(item, common_headers):
    url = item.get("url") or ""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.port not in (None, 443)
            or not (host.endswith(".googlevideo.com") or host in {"youtube.com", "www.youtube.com"})):
        raise ValueError("Неподдерживаемый адрес потока.")
    headers = dict(common_headers)
    headers.update(item.get("http_headers") or {})
    lines = []
    for name, value in headers.items():
        value = str(value)
        if name.lower() in {"user-agent", "referer", "origin"} and not any(c in value for c in "\r\n"):
            lines.append(f"{name}: {value}\r\n")
    args = ["-rw_timeout", "20000000", "-reconnect", "1",
            "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5",
            "-reconnect_max_retries", "3", "-reconnect_delay_total_max", "20",
            "-protocol_whitelist", "http,https,tcp,tls,crypto"]
    if lines:
        args += ["-headers", "".join(lines)]
    return args + ["-i", url]


def playlist_seconds(path):
    try:
        return sum(float(v) for v in re.findall(r"#EXTINF:([\d.]+)", path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0.0


def update(job, **values):
    with job["lock"]:
        job["state"].update(values)


def run_stream(service, job, identifier, quality):
    process = None
    started = time.monotonic()
    folder = job["folder"]
    playlist = folder / "index.m3u8"
    try:
        update(job, stage="extracting", message="Получаем адреса видео и звука…")
        if job.pop("refresh_urls", False):
            job.pop("info_override", None)
            with service.network_lock:
                service.metadata.pop((identifier, quality or 1080), None)
        try:
            info = job.get("info_override") or service.extract(identifier, quality)
        finally:
            service.playback_pending.clear()
        if job["stop"].is_set():
            return
        job["target_info"] = info
        job["target_info_at"] = time.monotonic()
        info = select_audio(select_video(info, quality), job.get("audio", "auto"))
        update(job, available_qualities=available_video_qualities(info))
        preview = startup_format(info, quality) if job.get("start_low") else None
        if preview:
            info = preview
            quality = 360
        update(job, startup_low=bool(preview), target_quality=job.get("quality", quality),
               audio_preference=info.get("_audio_preference", "auto"), audio_language=info.get("_audio_language", ""),
               audio_warning=info.get("_audio_warning", ""), audio_tracks=info.get("_audio_tracks", []))
        upload_date = info.get("upload_date") or ""
        published = f"{upload_date[6:8]}.{upload_date[4:6]}.{upload_date[:4]}" if re.fullmatch(r"\d{8}", upload_date) else ""
        views = info.get("view_count")
        update(job, channel_id=info.get("channel_id") or "", published=published,
               views=f"{views:,}".replace(",", " ") + " просмотров" if isinstance(views, int) else "")
        selected = info.get("requested_formats") or [info]
        progressive = None if job.get("force_hls") else progressive_format(info, quality)
        common = dict(title=info.get("title") or "Видео", channel=info.get("channel") or info.get("uploader") or "",
                      channel_id=info.get("channel_id") or "", description=(info.get("description") or "")[:12000],
                      duration=info.get("duration") or 0, quality=(f"До {quality}p" if quality else "Авто · до 1080p"),
                      extraction_seconds=round(time.monotonic() - started, 2), cache_hit=bool(info.get("_lighttube_cache_hit")))
        if progressive:
            with job["lock"]:
                job["media"] = {"url": progressive["url"], "headers": safe_headers(info.get("http_headers"), progressive.get("http_headers"))}
            update(job, **common, **format_diagnostics([progressive]), **quality_details([progressive], quality), mode="mp4", stage="ready", ready=True,
                   stream=job["media_stream"], startup_seconds=round(time.monotonic() - started, 2),
                   message="Готовый MP4 через ПК. Загружаем первые кадры…")
            return
        update(job, **common, **format_diagnostics(selected), **quality_details(selected, quality), mode="hls",
               fallback_reason="Готового MP4 сопоставимого качества нет." if not job.get("force_hls") else "Выбран HLS или выполнено переключение.")
        command = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "warning"]
        for item in selected:
            command += input_arguments(item, info.get("http_headers") or {})
        vi = next((i for i, x in enumerate(selected) if x.get("vcodec") not in (None, "none")), None)
        ai = next((i for i, x in enumerate(selected) if x.get("acodec") not in (None, "none")), None)
        if vi is None or ai is None:
            raise ValueError("Не найдены совместимые видео и звук.")
        command += ["-map", f"{vi}:v:0", "-map", f"{ai}:a:0",
                    "-c:v", "copy", "-c:a", "aac", "-profile:a", "aac_low",
                    "-b:a", "128k", "-ar", "48000", "-ac", "2",
                    "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "event",
                    "-hls_list_size", "0", "-hls_flags", "temp_file",
                    "-hls_segment_filename", str(folder / "segment-%06d.ts"), str(playlist)]
        height = max((x.get("height") or 0 for x in selected), default=0)
        update(job, stage="buffering", message="Готовим первые фрагменты…",
               title=info.get("title") or "Видео", quality=(f"До {quality}p" if quality else "Авто · до 1080p"),
               channel=info.get("channel") or info.get("uploader") or "",
               channel_id=info.get("channel_id") or "", description=(info.get("description") or "")[:12000],
               width=max((x.get("width") or 0 for x in selected), default=0), height=height,
               duration=info.get("duration") or 0,
               extraction_seconds=round(time.monotonic() - started, 1))
        with (folder / "ffmpeg.log").open("wb") as log:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            while not job["stop"].is_set():
                with job["lock"]:
                    state = dict(job["state"])
                    idle = time.monotonic() - job["last_seen"]
                if idle > 180:
                    job["stop"].set()
                    break
                seconds = playlist_seconds(playlist)
                if seconds > 0:
                    values = dict(ready=True, buffered=round(seconds, 1), stage="streaming", message="Поток готов.")
                    if not state["ready"]:
                        values["startup_seconds"] = round(time.monotonic() - started, 1)
                    update(job, **values)
                code = process.poll()
                if code is not None:
                    if code != 0 or seconds <= 0:
                        raise RuntimeError("FFmpeg остановился. Подробности в ffmpeg.log этой сессии.")
                    update(job, stage="complete", message="Подготовка завершена. Это не проверка целостности аудио.")
                    return
                job["stop"].wait(0.4)
    except Exception as error:
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "Ошибка подготовки потока. Проверь FFmpeg и Deno."
        logger.warning("Stream error: %s", message)
        update(job, stage="error", ready=False, message=message)
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if job["stop"].is_set():
            update(job, stage="stopped", ready=False, message="Поток остановлен.")


@asynccontextmanager
async def lifespan(app):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg не найден в PATH.")
    app.state.youtube = YouTubeService()
    app.state.jobs = {}
    app.state.session_id = secrets.token_urlsafe(18)
    app.state.history = OrderedDict()
    app.state.history_lock = threading.Lock()
    app.state.tasks = set()
    app.state.start_lock = asyncio.Lock()
    app.state.prefetch_task = None
    app.state.prefetch_at = 0.0
    app.state.media_slots = asyncio.Semaphore(4)
    app.state.media_client = httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        timeout=httpx.Timeout(20, connect=8), follow_redirects=False,
        limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
    )
    app.state.image_slots = asyncio.Semaphore(4)
    app.state.image_cache = OrderedDict()
    app.state.image_failures = {}
    app.state.suggest_cache = OrderedDict()
    app.state.suggest_lock = asyncio.Lock()
    app.state.suggest_client = httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        timeout=httpx.Timeout(5, connect=3), follow_redirects=False,
    )
    app.state.image_client = httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        timeout=httpx.Timeout(10, connect=5), follow_redirects=False,
        headers={"User-Agent": "LightTube/0.3", "Accept": "image/webp,image/png,image/jpeg,image/gif"},
    )
    with tempfile.TemporaryDirectory(prefix="lighttube-hls-") as root:
        app.state.root = Path(root)
        logger.info("LightTube: папка сессий %s", root)
        try:
            yield
        finally:
            for job in app.state.jobs.values():
                job["stop"].set()
            if app.state.tasks:
                await asyncio.gather(*list(app.state.tasks), return_exceptions=True)
            if app.state.prefetch_task:
                await asyncio.gather(app.state.prefetch_task, return_exceptions=True)
            await app.state.media_client.aclose()
            app.state.youtube.clear_session_cookies()
            await app.state.image_client.aclose()
            await app.state.suggest_client.aclose()


app = FastAPI(title="LightTube Recommendations BETA", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(BASE / "static" / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/api/feed")
async def feed(request: Request, refresh: bool = False):
    result = await asyncio.to_thread(request.app.state.youtube.recommendations, refresh)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


BROWSERS = [
    {"id": "firefox", "name": "Firefox"}, {"id": "chrome", "name": "Chrome"},
    {"id": "edge", "name": "Edge"}, {"id": "brave", "name": "Brave"},
    {"id": "opera", "name": "Opera"}, {"id": "vivaldi", "name": "Vivaldi"},
    {"id": "chromium", "name": "Chromium"}, {"id": "safari", "name": "Safari"},
    {"id": "none", "name": "Без браузерной сессии"},
]


@app.get("/api/session")
def session_info(request: Request):
    state = request.app.state
    return JSONResponse({"session_id": state.session_id, "browser": state.youtube.browser,
                         "quality": state.youtube.default_quality, "audio": state.youtube.default_audio, "browsers": BROWSERS,
                         "profile": state.youtube.profile, "ask_profile": state.youtube.ask_profile,
                         "settings_generation": state.youtube.settings_generation},
                        headers={"Cache-Control": "no-store"})


@app.get("/api/profiles")
async def profiles(request: Request, browser: str = "firefox"):
    if browser not in {b["id"] for b in BROWSERS}:
        raise HTTPException(422, "Неизвестный браузер.")
    items = await asyncio.to_thread(browser_profiles, browser)
    return JSONResponse({"items": [{"id": p["id"], "label": p["label"]} for p in items]},
                        headers={"Cache-Control": "no-store"})


class SettingsBody(BaseModel):
    browser: Literal["none", "firefox", "chrome", "edge", "brave", "opera", "vivaldi", "chromium", "safari"]
    quality: Literal[0, 360, 480, 720, 1080]
    profile: str | None = Field(default=None, max_length=32)
    ask_profile: bool | None = None
    audio: str | None = Field(default=None, max_length=35, pattern=AUDIO_PATTERN)


@app.post("/api/settings")
async def save_settings(body: SettingsBody, request: Request):
    state = request.app.state
    try:
        changed = await asyncio.to_thread(state.youtube.configure, body.browser, body.quality, body.profile, body.ask_profile, body.audio)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except OSError as error:
        raise HTTPException(500, "Не удалось сохранить настройки на сервере.") from error
    if changed:
        for job in state.jobs.values():
            job["stop"].set()
        with state.history_lock:
            state.history.clear()
    return {"ok": True, "browser_changed": changed, "browser": state.youtube.browser,
            "quality": state.youtube.default_quality, "audio": state.youtube.default_audio, "session_id": state.session_id,
            "profile": state.youtube.profile, "ask_profile": state.youtube.ask_profile,
            "settings_generation": state.youtube.settings_generation}


@app.get("/api/more")
async def more(request: Request, cursor: str = ""):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,40}", cursor):
        raise HTTPException(400, "Некорректная страница рекомендаций.")
    result = await asyncio.to_thread(request.app.state.youtube.more, cursor)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@app.get("/api/related/{identifier}")
async def related(identifier: str, request: Request):
    if not VIDEO_ID.fullmatch(identifier):
        raise HTTPException(400, "Некорректный ID видео.")
    result = await asyncio.to_thread(request.app.state.youtube.related, identifier)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


class HistoryBody(BaseModel):
    token: str = Field(min_length=10, max_length=64)
    position: float = Field(ge=0, le=604800, allow_inf_nan=False)
    completed: bool = False


@app.get("/api/history")
def get_history(request: Request):
    state = request.app.state
    with state.history_lock:
        items = list(reversed(list(state.history.values())))
    return JSONResponse({"items": items, "session_id": state.session_id},
                        headers={"Cache-Control": "no-store"})


@app.post("/api/history")
def record_history(body: HistoryBody, request: Request):
    state = request.app.state
    job = state.jobs.get(body.token)
    if not job:
        raise HTTPException(404, "Сессия видео отсутствует.")
    with job["lock"]:
        video = dict(job["state"])
    if job.get("settings_generation", state.youtube.settings_generation) != state.youtube.settings_generation:
        return {"ok": True}
    if not video.get("duration") or body.position < 1:
        return {"ok": True}
    identifier = video["video_id"]
    item = {"id": identifier, "title": video.get("title") or "Видео",
            "channel": video.get("channel") or "", "channel_id": video.get("channel_id") or "",
            "published": video.get("published") or "", "views": video.get("views") or "", "duration": video["duration"],
            "position": min(body.position, video["duration"]), "completed": body.completed,
            "thumbnail": "/api/thumbnail/" + identifier, "avatar": "", "watched_at": int(time.time())}
    with state.history_lock:
        previous = state.history.get(identifier)
        if previous and previous.get("completed"):
            item["completed"] = True
        state.history[identifier] = item
        state.history.move_to_end(identifier)
        while len(state.history) > 100:
            state.history.popitem(last=False)
    return {"ok": True}


@app.delete("/api/history")
def clear_history(request: Request):
    with request.app.state.history_lock:
        request.app.state.history.clear()
    return {"ok": True}


@app.get("/api/images/{key}")
async def image_proxy(key: str, request: Request):
    state = request.app.state
    if not re.fullmatch(r"[0-9a-f]{32}", key):
        raise HTTPException(404)
    with state.youtube.image_lock:
        source = state.youtube.image_sources.get(key)
    if not source:
        raise HTTPException(404, "Изображение отсутствует. Обнови ленту.")

    def cached_response():
        cached = state.image_cache.get(key)
        if not cached:
            return None
        state.image_cache.move_to_end(key)
        return Response(cached[0], media_type=cached[1], headers={
            "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})

    cached = cached_response()
    if cached is not None:
        return cached
    if state.image_failures.get(key, 0) > time.monotonic():
        raise HTTPException(502, "Источник изображения временно недоступен.")
    async with state.image_slots:
        cached = cached_response()
        if cached is not None:
            return cached
        try:
            async with state.image_client.stream("GET", source) as upstream:
                if upstream.status_code != 200:
                    raise ValueError("Image HTTP error")
                mime = upstream.headers.get("content-type", "").split(";")[0].strip().lower()
                if mime not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
                    raise ValueError("Unsupported image type")
                content = bytearray()
                async for chunk in upstream.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 1024 * 1024:
                        raise ValueError("Image too large")
                if not content:
                    raise ValueError("Empty image")
            state.image_cache[key] = (bytes(content), mime)
            while sum(len(value[0]) for value in state.image_cache.values()) > 8 * 1024 * 1024:
                state.image_cache.popitem(last=False)
            return cached_response()
        except (httpx.HTTPError, ValueError):
            state.image_failures[key] = time.monotonic() + 60
            while len(state.image_failures) > 256:
                state.image_failures.pop(next(iter(state.image_failures)))
            raise HTTPException(502, "Не удалось загрузить изображение с сервера YouTube.") from None


@app.get("/api/suggest")
async def suggest(request: Request, q: str = Query("", max_length=160)):
    query = " ".join(q.split())
    headers = {"Cache-Control": "no-store"}
    if len(query) < 2 or query.lower().startswith(("http:", "https:")):
        return JSONResponse({"items": []}, headers=headers)
    state = request.app.state
    key = query.casefold()
    async with state.suggest_lock:
        cached = state.suggest_cache.get(key)
        if cached and time.monotonic() - cached[0] < cached[2]:
            state.suggest_cache.move_to_end(key)
            return JSONResponse({"items": cached[1]}, headers=headers)
        items, ttl = [], 600
        try:
            # Public query suggestions only; never send browser/account cookies.
            async with state.suggest_client.stream(
                "GET", "https://suggestqueries.google.com/complete/search",
                params={"client": "firefox", "ds": "yt", "hl": "ru", "q": query},
            ) as upstream:
                upstream.raise_for_status()
                raw = bytearray()
                async for chunk in upstream.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 131072:
                        raise ValueError("Suggestion response too large")
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
                    raise ValueError("Unexpected suggestions")
                seen = set()
                for value in payload[1]:
                    if isinstance(value, str) and 0 < len(value) <= 160 and value.casefold() not in seen:
                        seen.add(value.casefold())
                        items.append(value)
                        if len(items) == 8:
                            break
        except (httpx.HTTPError, ValueError, UnicodeError):
            ttl = 30
        state.suggest_cache[key] = (time.monotonic(), items, ttl)
        state.suggest_cache.move_to_end(key)
        while len(state.suggest_cache) > 128:
            state.suggest_cache.popitem(last=False)
    return JSONResponse({"items": items}, headers=headers)


@app.get("/api/channels/{identifier}")
async def channel_videos(identifier: str, request: Request):
    if not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", identifier):
        raise HTTPException(422, "Неверный идентификатор канала.")
    result = await asyncio.to_thread(request.app.state.youtube.channel_videos, identifier)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@app.get("/api/search")
async def search(request: Request, q: str = ""):
    q = q.strip()
    if not q or len(q) > 160:
        raise HTTPException(400, "Введи запрос от 1 до 160 символов.")
    result = await asyncio.to_thread(request.app.state.youtube.search, q)
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@app.get("/api/thumbnail/{identifier}")
async def thumbnail(identifier: str, request: Request):
    if not VIDEO_ID.fullmatch(identifier):
        raise HTTPException(404)
    local = request.app.state.youtube.register_image(
        f"https://i.ytimg.com/vi/{identifier}/hqdefault.jpg")
    return await image_proxy(local.rsplit("/", 1)[-1], request)


class PrepareBody(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    quality: Literal[0, 360, 480, 720, 1080] | None = None
    audio: str | None = Field(default=None, max_length=35, pattern=AUDIO_PATTERN)
    mode: Literal["auto", "hls"] = "auto"
    start_low: bool = False


class PrefetchBody(BaseModel):
    video_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    quality: Literal[0, 360, 480, 720, 1080] = 720
    settings_generation: int


@app.post("/api/prefetch")
async def prefetch(body: PrefetchBody, request: Request):
    state = request.app.state
    if body.settings_generation != state.youtube.settings_generation:
        return {"status": "skipped"}
    if state.start_lock.locked() or state.youtube.playback_pending.is_set() or state.youtube.network_lock.locked() or any(not t.done() for t in state.tasks):
        return {"status": "busy"}
    if state.prefetch_task and not state.prefetch_task.done():
        return {"status": "busy"}
    if time.monotonic() - state.prefetch_at < 10:
        return {"status": "limited"}
    state.prefetch_at = time.monotonic()
    async def work():
        try:
            await asyncio.to_thread(state.youtube.extract, body.video_id, body.quality, True, expected_generation=body.settings_generation)
        except Exception:
            # Foreground playback will show an actionable, sanitized error.
            pass
    state.prefetch_task = asyncio.create_task(work())
    return {"status": "scheduled"}


@app.api_route("/media/{token}", methods=["GET", "HEAD"])
async def media(token: str, request: Request):
    return await proxy_media(request, token)


@app.post("/api/jobs/{token}/hls")
async def use_hls(token: str, request: Request):
    state = request.app.state
    async with state.start_lock:
        job = state.jobs.get(token)
        if not job or job["stop"].is_set():
            raise HTTPException(410, "Сессия завершена.")
        if job.get("force_hls"):
            return {"ok": True}
        job["force_hls"] = True
        state.youtube.playback_pending.set()
        previous = job.get("task")
        if previous:
            await asyncio.gather(previous, return_exceptions=True)
        if job["stop"].is_set():
            raise HTTPException(410, "Сессия завершена.")
        update(job, ready=False, stage="queued", mode="hls", stream=job["hls_stream"],
               message="Переключаемся на HLS…")
        state.youtube.playback_pending.set()
        task = asyncio.create_task(asyncio.to_thread(run_stream, state.youtube, job, job["identifier"], job["quality"]))
        job["task"] = task
        state.tasks.add(task)
        task.add_done_callback(state.tasks.discard)
    return {"ok": True}


def create_job(state, identifier, quality, mode="auto", start_low=False, info=None, audio=None):
    token = secrets.token_urlsafe(24)
    folder = state.root / token
    folder.mkdir()
    job = {"identifier": identifier, "quality": quality, "force_hls": mode == "hls",
           "media_stream": f"/media/{token}", "hls_stream": f"/hls/{token}/index.m3u8", "folder": folder, "stop": threading.Event(), "lock": threading.Lock(), "browser": state.youtube.browser, "settings_generation": state.youtube.settings_generation,
           "last_seen": time.monotonic(), "state": {
               "stage": "queued", "ready": False, "message": "Запускаем подготовку…",
               "video_id": identifier, "title": "", "quality": "", "duration": 0,
               "channel": "", "channel_id": "", "published": "", "views": "", "description": "", "buffered": 0, "folder": str(folder), "log": str(folder / "ffmpeg.log"),
               "stream": f"/hls/{token}/index.m3u8"}}
    job["audio"] = state.youtube.default_audio if audio is None else audio
    job["start_low"] = start_low
    job["info_override"] = info
    state.jobs[token] = job
    task = asyncio.create_task(asyncio.to_thread(run_stream, state.youtube, job, identifier, quality))
    job["task"] = task
    state.tasks.add(task)
    task.add_done_callback(state.tasks.discard)
    return token


class UpgradeBody(BaseModel):
    quality: Literal[0, 360, 480, 720, 1080] = 720
    audio: str | None = Field(default=None, max_length=35, pattern=AUDIO_PATTERN)


@app.post("/api/jobs/{token}/quality")
async def change_quality(token: str, body: UpgradeBody, request: Request):
    state = request.app.state
    async with state.start_lock:
        job = state.jobs.get(token)
        if not job or job["stop"].is_set():
            raise HTTPException(410, "Сессия завершена.")
        if not job.get("promoted", True):
            raise HTTPException(409, "Этот поток ещё не выбран для просмотра.")
        if job.get("settings_generation") != state.youtube.settings_generation:
            raise HTTPException(410, "Профиль изменён.")
        audio = job.get("audio", state.youtube.default_audio) if body.audio is None else body.audio
        previous = state.jobs.get(job.get("upgrade"))
        if previous and not previous["stop"].is_set():
            if previous["quality"] == body.quality and previous.get("audio", "auto") == audio:
                return {"id": job["upgrade"]}
            raise HTTPException(409, "Дождись завершения переключения качества.")
        if sum(not item["stop"].is_set() for item in state.jobs.values()) >= 2:
            raise HTTPException(409, "Уже готовится другое качество. Дождись переключения.")
        # Prune stopped sessions only; current playback and its pending rendition survive.
        for old_key, old in list(state.jobs.items()):
            if len(state.jobs) < 6:
                break
            if old["stop"].is_set() and (not old.get("task") or old["task"].done()):
                state.jobs.pop(old_key)
                shutil.rmtree(old["folder"], ignore_errors=True)
        state.youtube.playback_pending.set()
        info = job.get("target_info") if time.monotonic() - job.get("target_info_at", 0) < 120 else None
        child = create_job(state, job["identifier"], body.quality,
                           "hls" if job.get("force_hls") else "auto", info=info, audio=audio)
        state.jobs[child]["promoted"] = False
        job["upgrade"] = child
        return {"id": child}


@app.post("/api/prepare")
async def prepare(body: PrepareBody, request: Request):
    try:
        identifier = get_video_id(body.url)
    except ValueError as error:
        raise HTTPException(400, str(error))
    state = request.app.state
    if state.start_lock.locked():
        raise HTTPException(409, "Предыдущий поток ещё останавливается.")
    async with state.start_lock:
        state.youtube.playback_pending.set()
        for job in state.jobs.values():
            job["stop"].set()
        if state.tasks:
            await asyncio.gather(*list(state.tasks), return_exceptions=True)
        # Ограниченное число старых папок; завершённый процесс уже остановлен.
        while len(state.jobs) >= 6:
            old_key = next(iter(state.jobs))
            old = state.jobs.pop(old_key)
            shutil.rmtree(old["folder"], ignore_errors=True)
        return {"id": create_job(state, identifier, state.youtube.default_quality if body.quality is None else body.quality, body.mode, body.start_low, audio=body.audio)}


@app.post("/api/jobs/{token}/promote")
def promote_job(token: str, request: Request):
    job = request.app.state.jobs.get(token)
    if not job or job["stop"].is_set():
        raise HTTPException(410, "Сессия завершена.")
    job["promoted"] = True
    return {"ok": True}


@app.get("/api/jobs/{token}")
def job_status(token: str, request: Request):
    job = request.app.state.jobs.get(token)
    if job is None:
        raise HTTPException(404, "Сессия отсутствует.")
    with job["lock"]:
        job["last_seen"] = time.monotonic()
        result = dict(job["state"])
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@app.post("/api/jobs/{token}/stop")
def stop_job(token: str, request: Request):
    job = request.app.state.jobs.get(token)
    if job:
        job["stop"].set()
        child = request.app.state.jobs.get(job.get("upgrade"))
        if child and not child.get("promoted"):
            child["stop"].set()
    return {"ok": True}


@app.get("/hls/{token}/{filename}")
def hls_file(token: str, filename: str, request: Request):
    job = request.app.state.jobs.get(token)
    if job is None or not (filename == "index.m3u8" or SEGMENT.fullmatch(filename)):
        raise HTTPException(404)
    path = job["folder"] / filename
    if not path.is_file():
        raise HTTPException(404)
    with job["lock"]:
        job["last_seen"] = time.monotonic()
    return FileResponse(path, media_type="application/vnd.apple.mpegurl" if filename.endswith("m3u8") else "video/mp2t",
                        headers={"Cache-Control": "no-store"})
