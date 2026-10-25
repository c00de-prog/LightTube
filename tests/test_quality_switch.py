import time

from fastapi.testclient import TestClient

import main
from playback import startup_format
from test_fast_playback import formats


def preview_info():
    info = formats()
    low = {**info['formats'][-1], 'format_id': '18', 'height': 360, 'width': 640,
           'vbr': 300, 'tbr': 428, 'url': 'https://abc.googlevideo.com/low'}
    info['formats'].append(low)
    return info


def ready(client, token):
    for _ in range(100):
        data = client.get('/api/jobs/' + token).json()
        if data.get('ready') or data.get('stage') == 'error':
            return data
        time.sleep(.01)
    raise AssertionError('job did not become ready')


def test_preview_optional_and_only_compatible_trusted_sources():
    info = preview_info()
    assert startup_format(info, 720)['requested_formats'][0]['height'] == 360
    assert startup_format(info, 360) is None
    for field, value in [('url', 'https://localhost/private'), ('has_drm', True),
                         ('acodec', 'opus'), ('height', 480), ('fps', 120)]:
        copy = {**info, 'formats': [{**info['formats'][-1], field: value}]}
        assert startup_format(copy, 720) is None
    assert startup_format(formats(), 720) is None


def test_upgrade_reuses_extraction_preserves_preview_and_promotes(monkeypatch):
    calls = []
    def extract(self, identifier, quality, *args, **kwargs):
        calls.append((identifier, quality))
        return preview_info()
    monkeypatch.setattr(main.YouTubeService, 'extract', extract)
    monkeypatch.setattr(main.subprocess, 'Popen', lambda *a, **k: (_ for _ in ()).throw(AssertionError('No FFmpeg for MP4')))
    with TestClient(main.app) as client:
        first = client.post('/api/prepare', json={'url': '9w4PxRm2vhU', 'quality': 720, 'start_low': True}).json()['id']
        data = ready(client, first)
        assert data['startup_low'] and data['height'] == 360 and data['target_quality'] == 720
        child = client.post(f'/api/jobs/{first}/quality', json={'quality': 720}).json()['id']
        assert client.post(f'/api/jobs/{first}/quality', json={'quality': 720}).json()['id'] == child
        assert ready(client, child)['height'] == 720
        assert len(calls) == 1
        assert not main.app.state.jobs[first]['stop'].is_set()
        assert client.post(f'/api/jobs/{child}/quality', json={'quality': 1080}).status_code == 409
        assert client.post(f'/api/jobs/{child}/promote').status_code == 200
        client.post(f'/api/jobs/{first}/stop')
        assert not main.app.state.jobs[child]['stop'].is_set()
        assert client.post(f'/api/jobs/{child}/quality', json={'quality': 2161}).status_code == 422
        # A new video stops both renditions from the previous viewing session.
        client.post('/api/prepare', json={'url': 'MdQM9Gn2QyA', 'quality': 720})
        assert main.app.state.jobs[child]['stop'].is_set()


def test_cancel_stops_unpromoted_rendition_and_stale_urls_are_not_reused(monkeypatch):
    calls = []
    def extract(self, *args, **kwargs):
        calls.append(1)
        return preview_info()
    monkeypatch.setattr(main.YouTubeService, 'extract', extract)
    with TestClient(main.app) as client:
        first = client.post('/api/prepare', json={'url': '9w4PxRm2vhU'}).json()['id']
        ready(client, first)
        main.app.state.jobs[first]['target_info_at'] -= 121
        child = client.post(f'/api/jobs/{first}/quality', json={'quality': 720}).json()['id']
        ready(client, child)
        assert len(calls) == 2
        client.post(f'/api/jobs/{first}/stop')
        assert main.app.state.jobs[child]['stop'].is_set()
        assert client.post(f'/api/jobs/{child}/promote').status_code == 410
