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


def progressive_format(info, quality):
    selected = info.get('requested_formats') or [info]
    video = next((f for f in selected if f.get('vcodec') not in (None, 'none')), {})
    baseline_height = video.get('height') or 0
    baseline_fps = video.get('fps') or 0
    candidates = []
    for f in info.get('formats') or [info]:
        if (f.get('ext') != 'mp4' or not str(f.get('vcodec', '')).startswith(('avc1', 'h264'))
                or not str(f.get('acodec', '')).startswith(('mp4a', 'aac'))
                or f.get('has_drm') or f.get('protocol') not in (None, 'https', 'http')):
            continue
        height, fps = f.get('height') or 0, f.get('fps') or 0
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
    return max(candidates, key=lambda f: (f.get('height') or 0, f.get('fps') or 0,
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
