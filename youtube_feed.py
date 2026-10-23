"""Extract public card metadata from YouTube HTML; never execute page scripts."""
import json
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup

ID = re.compile(r"[A-Za-z0-9_-]{11}")
ASSIGNMENT = re.compile(r'(?:\b(?:var|let|const)\s+)?ytInitialData\s*=\s*|window\s*\[\s*["\']ytInitialData["\']\s*\]\s*=\s*')


class FeedParseError(ValueError):
    pass


def text(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    return value.get("simpleText") or value.get("content") or "".join(
        run.get("text", "") for run in value.get("runs", []) if isinstance(run, dict))


def seconds(label):
    label = label.strip()
    if not re.fullmatch(r"\d+(?::\d{1,2}){1,2}", label):
        return None
    result = 0
    for part in label.split(":"):
        result = result * 60 + int(part)
    return result


def channel_avatar(renderer):
    """Only inspect channel-avatar fields, never the video thumbnail."""
    metadata = renderer.get("metadata", {}).get("lockupMetadataViewModel", {})
    roots = [renderer.get("channelThumbnailSupportedRenderers"),
             renderer.get("channelThumbnail"), renderer.get("ownerThumbnail"),
             metadata.get("image"), metadata.get("avatar")]
    candidates = []
    for root in roots:
        for node in walk(root):
            value = node.get("url")
            if not isinstance(value, str):
                continue
            if value.startswith("//"):
                value = "https:" + value
            try:
                parsed = urlparse(value)
                if (parsed.scheme == "https" and parsed.hostname in {
                        "yt3.ggpht.com", "yt3.googleusercontent.com"}
                        and not parsed.username and not parsed.password
                        and parsed.port in (None, 443) and len(value) <= 4096):
                    width = node.get("width")
                    candidates.append((width if isinstance(width, (int, float)) else 0, value))
            except ValueError:
                continue
    return max(candidates, default=(0, ""))[1]


def walk(value):
    """Iterative traversal avoids recursion limits and excludes ad containers."""
    queue = [value]
    while queue:
        item = queue.pop()
        if isinstance(item, dict):
            if any(key in item for key in (
                "adSlotRenderer", "displayAdRenderer", "promotedSparklesWebRenderer",
                "inFeedAdLayoutRenderer", "adPlacementRenderer", "promotedVideoRenderer",
            )):
                continue
            yield item
            queue.extend(reversed(list(item.values())))
        elif isinstance(item, list):
            queue.extend(reversed(item))


def initial_data(html):
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script"):
        source = script.string or script.get_text()
        if "ytInitialData" not in source:
            continue
        for match in ASSIGNMENT.finditer(source):
            try:
                value, _ = json.JSONDecoder().raw_decode(source[match.end():].lstrip())
                if isinstance(value, dict):
                    return value
            except (ValueError, RecursionError):
                continue
    raise FeedParseError(
        "YouTube не прислал данные карточек (ytInitialData). "
        "Возможна страница согласия, проверка входа или изменение разметки. "
        "Открой youtube.com в выбранном браузере на серверном ПК и проверь главную."
    )


def extra_metadata(renderer):
    channel_id = ""
    for node in walk(renderer):
        browse = node.get("browseEndpoint", {})
        candidate = browse.get("browseId", "")
        if isinstance(candidate, str) and re.fullmatch(r"UC[A-Za-z0-9_-]{22}", candidate):
            channel_id = candidate
            break
    watched = False
    for node in walk(renderer):
        percent = node.get("percentDurationWatched")
        if isinstance(percent, (int, float)) and percent > 0:
            watched = True
        if node.get("isWatched") is True:
            watched = True
    return {"channel_id": channel_id, "is_watched": watched}


def renderer_card(renderer):
    identifier = renderer.get("videoId", "")
    title = text(renderer.get("title"))
    channel = text(renderer.get("ownerText") or renderer.get("longBylineText") or renderer.get("shortBylineText"))
    label = text(renderer.get("lengthText"))
    if not label:
        for node in walk(renderer.get("thumbnailOverlays", [])):
            duration = node.get("thumbnailOverlayTimeStatusRenderer")
            if duration:
                label = text(duration.get("text"))
                if duration.get("style") in {"LIVE", "UPCOMING"}:
                    return None
                break
    if renderer.get("upcomingEventData"):
        return None
    card = make_card(identifier, title, channel, seconds(label), text(renderer.get("viewCountText") or renderer.get("shortViewCountText")), channel_avatar(renderer))
    if card:
        card.update(extra_metadata(renderer))
        card["published"] = text(renderer.get("publishedTimeText"))
    return card


def lockup_card(renderer):
    # New homepage cards often use lockupViewModel instead of videoRenderer.
    identifier = renderer.get("contentId", "")
    content_type = renderer.get("contentType", "")
    if content_type and content_type != "LOCKUP_CONTENT_TYPE_VIDEO":
        return None
    metadata = renderer.get("metadata", {}).get("lockupMetadataViewModel", {})
    title = text(metadata.get("title"))
    channel = ""
    rows = metadata.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", [])
    for row in rows:
        for part in row.get("metadataParts", []):
            candidate = text(part.get("text"))
            if candidate:
                channel = candidate
                break
        if channel:
            break
    duration = None
    for node in walk(renderer.get("contentImage", {})):
        if "text" in node:
            candidate = seconds(text(node["text"]))
            if candidate is not None:
                duration = candidate
                break
    parts = []
    for row in rows[1:]:
        parts.extend(text(part.get("text")) for part in row.get("metadataParts", []))
    card = make_card(identifier, title, channel, duration, parts[0] if parts else "", channel_avatar(renderer))
    if card:
        card.update(extra_metadata(renderer))
        card["published"] = " · ".join(p for p in parts[1:] if p)
    return card


def make_card(identifier, title, channel, duration, views, avatar=""):
    if not isinstance(identifier, str) or not ID.fullmatch(identifier) or not title:
        return None
    return {"id": identifier, "title": title, "channel": channel,
            "duration": duration, "views": views,
            "thumbnail": f"https://i.ytimg.com/vi/{identifier}/hqdefault.jpg",
            "avatar": avatar}


def parse_cards(html, limit=24):
    data = initial_data(html)
    return cards_from_data(data, limit)


def cards_from_data(data, limit=60, allow_empty=False):
    items, seen = [], set()
    # Stay inside visible contents, avoiding unrelated menus/player metadata.
    for node in walk(data.get("contents", data)):
        card = None
        for key in ("videoRenderer", "gridVideoRenderer", "compactVideoRenderer", "videoWithContextRenderer"):
            if isinstance(node.get(key), dict):
                card = renderer_card(node[key])
                break
        if not card and isinstance(node.get("lockupViewModel"), dict):
            card = lockup_card(node["lockupViewModel"])
        if card and card["id"] not in seen:
            seen.add(card["id"])
            items.append(card)
            if len(items) >= limit:
                break
    if not items and not allow_empty:
        raise FeedParseError(
            "YouTube вернул страницу без доступных видеокарточек. "
            "Проверь вход, согласие на cookies и историю просмотров в выбранном браузере на ПК. "
            "Также могла измениться разметка YouTube."
        )
    return items


def page_config(html):
    """Read JSON arguments to ytcfg.set without evaluating any JavaScript."""
    config = {}
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script"):
        source = script.string or script.get_text()
        for match in re.finditer(r"ytcfg\.set\s*\(\s*", source):
            try:
                value, _ = json.JSONDecoder().raw_decode(source[match.end():])
                if isinstance(value, dict):
                    config.update(value)
            except (ValueError, RecursionError):
                continue
    return config


def related_contents(data):
    contents = data.get("contents", {})
    watch = contents.get("twoColumnWatchNextResults") or contents.get("singleColumnWatchNextResults") or {}
    secondary = watch.get("secondaryResults", {})
    if isinstance(secondary, dict):
        secondary = secondary.get("secondaryResults", secondary)
    if secondary:
        return secondary
    # Mobile layouts can nest secondaryResults one level deeper.
    for node in walk(contents):
        secondary = node.get("secondaryResults")
        if isinstance(secondary, dict) and secondary:
            return secondary
    raise FeedParseError("YouTube не прислал блок «Далее» в HTML этого ролика.")


def continuation(data, default_endpoint="browse"):
    for node in walk(data):
        renderer = node.get("continuationItemRenderer")
        if not isinstance(renderer, dict):
            continue
        endpoint = renderer.get("continuationEndpoint", {})
        token = endpoint.get("continuationCommand", {}).get("token")
        api = endpoint.get("commandMetadata", {}).get("webCommandMetadata", {}).get("apiUrl", "")
        kind = api.rsplit("/", 1)[-1] if api else default_endpoint
        if isinstance(token, str) and 0 < len(token) <= 24000 and kind in {"browse", "next", "search"}:
            return {"token": token, "endpoint": kind}
    for node in walk(data):
        value = node.get("nextContinuationData") or node.get("reloadContinuationData")
        if isinstance(value, dict):
            token = value.get("continuation")
            if isinstance(token, str) and 0 < len(token) <= 24000:
                return {"token": token, "endpoint": default_endpoint}
    return None


def parse_page(html, scope="home", limit=60):
    data = initial_data(html)
    content = related_contents(data) if scope == "related" else data.get("contents", data)
    return {
        "items": cards_from_data(content, limit),
        "continuation": continuation(content, "next" if scope == "related" else "search" if scope == "search" else "browse"),
        "config": page_config(html),
    }
