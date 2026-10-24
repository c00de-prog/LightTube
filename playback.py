"""Progressive media selection and a bounded, same-origin streaming proxy."""
import asyncio
import re
import time
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask


def validate_media_url(url):
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or '').lower()
        if (parsed.scheme == 'https' and not parsed.username and not parsed.password
                and parsed.port in (None, 443)
                and (host.endswith('.googlevideo.com') or host in {'youtube.com', 'www.youtube.com'})):
            return url
    except (TypeError, ValueError):
        pass
    raise ValueError('Неподдерживаемый адрес потока.')


def safe_headers(*sources):
    result = {}
    for source in sources:
        for name, value in (source or {}).items():
            if name.lower() in {'user-agent', 'referer', 'origin'}:
                value = str(value)
                if not any(c in value for c in '\r\n'):
                    result[name.lower()] = value
    result['accept-encoding'] = 'identity'
    return result


def video_bitrate(f):
    if isinstance(f.get('vbr'), (int, float)) and f['vbr'] > 0:
        return f['vbr']
    if f.get('acodec') == 'none' and isinstance(f.get('tbr'), (int, float)):
        return f['tbr']
    if isinstance(f.get('tbr'), (int, float)) and isinstance(f.get('abr'), (int, float)):
        return max(0, f['tbr'] - f['abr'])
    return None


def quality_format(quality):
    quality = quality or 1080
    video = 'bv[ext=mp4][vcodec^=avc1][fps<=60]'
    combined = 'b[ext=mp4][vcodec^=avc1][acodec^=mp4a][fps<=60]'
    return (f'({video}[height<={quality}]/{video}[width<={quality}])+ba[ext=m4a][acodec^=mp4a]/'
            f'({combined}[height<={quality}]/{combined}[width<={quality}])')


def video_resolution(f):
    """Use the short dimension for portrait as well as landscape video."""
    width, height = f.get('width') or 0, f.get('height') or 0
    return min(width, height) if width and height else height or width


def compatible_video_formats(info, limit=1080):
    pool = list(info.get('formats') or []) + list(info.get('requested_formats') or [info])
    result = []
    for f in pool:
        if (f.get('ext') != 'mp4' or not str(f.get('vcodec', '')).startswith(('avc1', 'h264'))
                or f.get('has_drm') or not 0 < video_resolution(f) <= (limit or 1080)
                or (f.get('fps') or 0) > 60
                or f.get('protocol') not in (None, 'https', 'http', 'm3u8', 'm3u8_native')):
            continue
        try:
            validate_media_url(f.get('url'))
        except ValueError:
            continue
        result.append(f)
    return result


def select_video(info, quality):
    candidates = compatible_video_formats(info, quality)
    if not candidates:
        raise ValueError('Нет совместимого H.264-потока в выбранном качестве.')
    chosen = max(candidates, key=lambda f: (video_resolution(f), f.get('fps') or 0,
                  video_bitrate(f) or 0, f.get('acodec') in (None, 'none')))
    previous = info.get('requested_formats') or [info]
    audio = next((f for f in previous if f.get('acodec') not in (None, 'none')), None)
    if audio and audio is not chosen:
        selected = [{**chosen, 'acodec': 'none'}, audio]
    else:
        selected = [chosen]
    return dict(info, requested_formats=selected)


def quality_details(selected, limit):
    video = next((f for f in selected if f.get('vcodec') not in (None, 'none')), {})
    resolution, fps = video_resolution(video), video.get('fps') or 0
    label = f'{resolution:g}p' if resolution else 'Разрешение неизвестно'
    if fps > 30:
        label += f' · {fps:g} fps'
    details = []
    if video.get('width') and video.get('height'):
        details.append(f'{video["width"]} × {video["height"]}')
    if fps:
        details.append(f'{fps:g} fps')
    bitrate = video_bitrate(video)
    if bitrate:
        details.append(f'{bitrate / 1000:.2f} Мбит/с · по данным источника')
    note = ''
    if limit and resolution and resolution < limit:
        note = f'Лимит {limit}p; выбран доступный H.264-поток {resolution:g}p. Масштабирование до лимита не выполняется.'
    return {'source_quality': label, 'source_details': ' · '.join(details), 'quality_note': note}


def available_video_qualities(info):
    choices = {}
    for f in compatible_video_formats(info):
        resolution, fps = video_resolution(f), f.get('fps') or 0
        key = (resolution, fps)
        choices[key] = f'{resolution:g}p' + (f' · {fps:g} fps' if fps > 30 else '')
    return [choices[key] for key in sorted(choices)][-24:]


AUDIO_PATTERN = r"^(auto|original|[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,3})$"
LANGUAGE_NAMES = {'ru': 'Русский', 'en': 'English', 'uz': 'Oʻzbekcha', 'tg': 'Тоҷикӣ',
                  'de': 'Deutsch', 'tr': 'Türkçe', 'es': 'Español', 'fr': 'Français',
                  'pt': 'Português', 'ar': 'العربية', 'ja': '日本語', 'ko': '한국어', 'hi': 'हिन्दी'}


def original_audio(f):
    return '(original)' in str(f.get('format_note', '')).lower() or (f.get('language_preference') or 0) >= 10


def audio_language(f):
    return str(f.get('language') or '').lower()


def same_audio(first, second):
    # An unknown language must not silently replace an explicitly identified track.
    return audio_language(first) == audio_language(second)


def usable_audio(info):
    result = []
    for f in info.get('formats') or info.get('requested_formats') or [info]:
        if f.get('acodec') in (None, 'none') or f.get('has_drm'):
            continue
        if f.get('protocol') not in (None, 'https', 'http', 'm3u8', 'm3u8_native'):
            continue
        try:
            validate_media_url(f.get('url'))
        except ValueError:
            continue
        result.append(f)
    return result


def select_audio(info, preference='auto'):
    """Choose an existing audio track without another network extraction."""
    available = usable_audio(info)
    tracks = {}
    for f in available:
        language = audio_language(f)
        if language and re.fullmatch(AUDIO_PATTERN, language):
            label = LANGUAGE_NAMES.get(language, LANGUAGE_NAMES.get(language.split('-')[0], language))
            if '-' in language:
                label += ' · ' + language
            tracks[language] = {'id': language, 'label': label}
    selected = info.get('requested_formats') or [info]
    audio = next((f for f in selected if f.get('acodec') not in (None, 'none')), {})
    matches = []
    warning = ''
    if preference == 'original':
        matches = [f for f in available if original_audio(f)]
    elif preference != 'auto':
        code = preference.lower()
        matches = [f for f in available if audio_language(f) == code]
        if not matches and '-' not in code:
            matches = [f for f in available if audio_language(f).split('-')[0] == code and not audio_language(f).endswith('-desc')]
    if matches:
        # Avoid adding a duplicate video input when a separate audio rendition exists.
        audio = max(matches, key=lambda f: (f.get('vcodec') in (None, 'none'),
                    f.get('language_preference') or 0, f.get('abr') or f.get('tbr') or 0))
        video = next((f for f in selected if f.get('vcodec') not in (None, 'none')), None)
        if video and video is not audio:
            selected = [{**video, 'acodec': 'none'}, audio]
        elif video:
            selected = [video]
    elif preference != 'auto':
        warning = 'Выбранная озвучка недоступна у этого ролика. Используется доступная дорожка; предпочтение сохранено.'
    return dict(info, requested_formats=selected, _audio_preference=preference,
                _audio_language=audio_language(audio), _audio_warning=warning,
                _audio_tracks=sorted(tracks.values(), key=lambda t: t['label']))


def startup_format(info, quality):
    """Select an optional <=360p H.264 preview from already extracted metadata."""
    selected = info.get('requested_formats') or [info]
    target = max((video_resolution(f) for f in selected if f.get('vcodec') not in (None, 'none')), default=0)
    if target <= 360 or (quality and quality <= 360):
        return None
    audio = next((f for f in selected if f.get('acodec') not in (None, 'none')), {})
    candidates = []
    for f in info.get('formats') or []:
        if (0 < video_resolution(f) <= 360
                and str(f.get('vcodec', '')).startswith(('avc1', 'h264'))
                and str(f.get('acodec', '')).startswith(('mp4a', 'aac'))
                and f.get('ext') == 'mp4' and not f.get('has_drm') and same_audio(audio, f)
                and f.get('protocol') in (None, 'https', 'http')
                and (f.get('fps') or 0) <= 60):
            try:
                validate_media_url(f.get('url'))
            except ValueError:
                continue
            candidates.append(f)
    if not candidates:
        return None
    chosen = max(candidates, key=lambda f: (video_resolution(f), video_bitrate(f) or 0))
    return {**info, 'requested_formats': [chosen], 'formats': [chosen]}


def progressive_format(info, quality):
    selected = info.get('requested_formats') or [info]
    video = next((f for f in selected if f.get('vcodec') not in (None, 'none')), {})
    audio = next((f for f in selected if f.get('acodec') not in (None, 'none')), {})
    baseline_height = video_resolution(video)
    baseline_fps = video.get('fps') or 0
    candidates = []
    for f in info.get('formats') or [info]:
        if (f.get('ext') != 'mp4' or not str(f.get('vcodec', '')).startswith(('avc1', 'h264'))
                or not str(f.get('acodec', '')).startswith(('mp4a', 'aac'))
                or not same_audio(audio, f) or f.get('has_drm') or f.get('protocol') not in (None, 'https', 'http')):
            continue
        height, fps = video_resolution(f), f.get('fps') or 0
        if not height or height > (quality or 1080) or height < baseline_height or fps > 60:
            continue
        if baseline_fps and (not fps or fps < baseline_fps):
            continue
        baseline_rate, candidate_rate = video_bitrate(video), video_bitrate(f)
        if baseline_rate and (not candidate_rate or candidate_rate < baseline_rate):
            continue
        try:
            validate_media_url(f.get('url'))
        except ValueError:
            continue
        candidates.append(f)
    return max(candidates, key=lambda f: (video_resolution(f), f.get('fps') or 0,
                                         f.get('vbr') or f.get('tbr') or 0), default=None)


def format_diagnostics(formats):
    video = next((f for f in formats if f.get('vcodec') not in (None, 'none')), {})
    audio = next((f for f in formats if f.get('acodec') not in (None, 'none')), {})
    return {'format_id': '+'.join(str(f.get('format_id') or '?') for f in formats),
            'video_codec': video.get('vcodec') or '', 'audio_codec': audio.get('acodec') or '',
            'fps': video.get('fps'), 'video_bitrate_kbps': video.get('vbr'),
            'total_bitrate_kbps': sum(f.get('tbr') or 0 for f in formats) or None,
            'width': video.get('width') or 0, 'height': video.get('height') or 0}


async def proxy_media(request, token):
    state = request.app.state
    job = state.jobs.get(token)
    if not job or job['stop'].is_set():
        raise HTTPException(410, 'Сессия потока завершена.')
    with job['lock']:
        media = job.get('media')
        job['last_seen'] = time.monotonic()
    if not media or job.get('force_hls'):
        raise HTTPException(409, 'Для этой сессии используется HLS.')
    validate_media_url(media['url'])
    headers = dict(media['headers'])
    byte_range = request.headers.get('range')
    if byte_range:
        if len(byte_range) > 80 or not re.fullmatch(r'bytes=(?:\d+-\d*|-\d+)', byte_range):
            raise HTTPException(416, 'Поддерживается один диапазон байтов.')
        headers['range'] = byte_range
    try:
        await asyncio.wait_for(state.media_slots.acquire(), timeout=2)
    except asyncio.TimeoutError:
        raise HTTPException(503, 'Слишком много запросов к потоку.') from None
    upstream, closed = None, False

    async def close():
        nonlocal closed
        if not closed:
            closed = True
            try:
                if upstream is not None:
                    await upstream.aclose()
            finally:
                state.media_slots.release()

    try:
        upstream = await state.media_client.send(
            state.media_client.build_request(request.method, media['url'], headers=headers), stream=True)
        response_headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
        if upstream.status_code == 416:
            value = upstream.headers.get('content-range', '')
            if re.fullmatch(r'bytes \*/\d+', value):
                response_headers['Content-Range'] = value
            await close()
            return Response(status_code=416, headers=response_headers)
        if upstream.status_code in (403, 410):
            job['refresh_urls'] = True
        if upstream.status_code not in (200, 206) or upstream.headers.get('content-encoding', 'identity') != 'identity':
            raise ValueError('Недоступен готовый поток.')
        mime = upstream.headers.get('content-type', 'video/mp4').split(';', 1)[0].lower()
        if mime not in {'video/mp4', 'application/octet-stream', 'binary/octet-stream'}:
            raise ValueError('Источник вернул не MP4.')
        if upstream.status_code == 206 and not re.fullmatch(r'bytes \d+-\d+/\d+', upstream.headers.get('content-range', '')):
            raise ValueError('Некорректный диапазон потока.')
        for key in ('content-length', 'content-range', 'accept-ranges'):
            value = upstream.headers.get(key)
            if value and '\r' not in value and '\n' not in value:
                response_headers[key] = value
        if request.method == 'HEAD':
            code = upstream.status_code
            await close()
            return Response(status_code=code, headers=response_headers, media_type='video/mp4')
    except (httpx.HTTPError, ValueError):
        await close()
        raise HTTPException(502, 'Готовый поток недоступен. Переключись на HLS.') from None
    except BaseException:
        await close()
        raise

    async def chunks():
        try:
            async for chunk in upstream.aiter_raw(65536):
                if job['stop'].is_set() or job.get('force_hls'):
                    return
                with job['lock']:
                    job['last_seen'] = time.monotonic()
                yield chunk
        except httpx.HTTPError:
            raise RuntimeError('Соединение с медиапотоком прервано.') from None
        finally:
            await close()
    return StreamingResponse(chunks(), status_code=upstream.status_code, headers=response_headers,
                             media_type='video/mp4', background=BackgroundTask(close))
