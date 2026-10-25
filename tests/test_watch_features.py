import json
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
import main
from youtube_feed import parse_page
from test_quality_switch import ready

CHANNEL = 'UCabcdefghijklmnopqrstuv'


def fixture_html():
    return '<script>var ytInitialData = ' + json.dumps({'contents': {'items': [
        {'channelRenderer': {'channelId': CHANNEL, 'title': {'simpleText': 'Author'},
         'subscriberCountText': {'simpleText': '@author'}, 'videoCountText': {'simpleText': '2 млн подписчиков'},
         'descriptionSnippet': {'simpleText': 'Description'}, 'thumbnail': {'thumbnails': [{'url': 'https://yt3.ggpht.com/avatar', 'width': 160}]}}},
        {'videoRenderer': {'videoId': '9w4PxRm2vhU', 'title': {'simpleText': 'Video'}}}
    ]}}) + ';</script>'


def test_search_parses_channels_and_channels_only_scope():
    mixed = parse_page(fixture_html(), scope='search')['items']
    assert [item.get('kind', 'video') for item in mixed] == ['channel', 'video']
    channels = parse_page(fixture_html(), scope='channels')['items']
    assert len(channels) == 1 and channels[0]['id'] == CHANNEL
    assert channels[0]['avatar'] == 'https://yt3.ggpht.com/avatar'
    assert channels[0]['title'] == 'Author'


def test_channel_search_uses_server_filter_separate_cache_and_safe_types(monkeypatch):
    calls = []
    with TestClient(main.app) as client:
        service = main.app.state.youtube
        def fetch(path, scope='home'):
            calls.append((path, scope))
            return parse_page(fixture_html(), scope=scope)['items']
        monkeypatch.setattr(service, 'fetch_cards', fetch)
        assert len(client.get('/api/search?q=author').json()['items']) == 2
        result = client.get('/api/search?q=author&type=channels')
        assert result.status_code == 200 and result.json()['items'][0]['kind'] == 'channel'
        assert len(client.get('/api/search?q=author&type=channels').json()['items']) == 1
        assert len(calls) == 2
        assert parse_qs(urlparse(calls[-1][0]).query)['sp'] == ['EgIQAg==']
        assert calls[-1][1] == 'channels'
        assert client.get('/api/search?q=author&type=arbitrary').status_code == 422


def worker_factory(calls, full=True, mode='hls'):
    def worker(service, job, identifier, quality):
        calls.append((identifier, quality, job.get('audio')))
        (job['folder'] / 'index.m3u8').write_text('#EXTM3U\n#EXTINF:2,\nsegment-000000.ts\n' + ('#EXT-X-ENDLIST\n' if full else ''))
        (job['folder'] / 'segment-000000.ts').write_bytes(b'media bytes')
        main.update(job, title='Video', ready=True, stage='complete', completed_media=full,
                    mode=mode, duration=2, startup_low=False)
        service.playback_pending.clear()
    return worker


def test_finished_hls_replays_same_files_without_another_worker(monkeypatch):
    calls = []
    monkeypatch.setattr(main, 'run_stream', worker_factory(calls))
    with TestClient(main.app) as client:
        body = {'url': '9w4PxRm2vhU', 'quality': 720, 'audio': 'auto'}
        token = client.post('/api/prepare', json=body).json()['id']
        ready(client, token)
        folder = main.app.state.jobs[token]['folder']
        original = (folder / 'segment-000000.ts').read_bytes()
        client.post(f'/api/jobs/{token}/stop')
        repeat = client.post('/api/prepare', json=body).json()
        assert repeat == {'id': token, 'cached': True}
        assert len(calls) == 1
        assert client.get('/api/jobs/' + token).json()['media_cache_hit']
        assert client.get(f'/hls/{token}/segment-000000.ts').content == original
        # Different saved audio/quality must not reuse the wrong rendition.
        changed = client.post('/api/prepare', json={**body, 'audio': 'ru'}).json()['id']
        ready(client, changed)
        assert changed != token and len(calls) == 2
        client.post('/api/settings', json={'browser': 'none', 'quality': 720})
        again = client.post('/api/prepare', json=body).json()['id']
        ready(client, again)
        assert again != token and len(calls) == 3
    assert not folder.exists()  # normal shutdown still removes session media


def test_partial_missing_or_proxy_media_is_not_mislabeled_as_cached(monkeypatch):
    for mode, full, missing in [('hls', False, False), ('hls', True, True), ('mp4', True, False)]:
        calls = []
        monkeypatch.setattr(main, 'run_stream', worker_factory(calls, full=full, mode=mode))
        with TestClient(main.app) as client:
            body = {'url': '9w4PxRm2vhU', 'quality': 720}
            first = client.post('/api/prepare', json=body).json()['id']
            ready(client, first)
            if missing: (main.app.state.jobs[first]['folder'] / 'segment-000000.ts').unlink()
            second = client.post('/api/prepare', json=body).json()['id']
            ready(client, second)
            assert second != first and len(calls) == 2


def test_completed_cache_is_bounded_to_six_sessions(monkeypatch):
    calls = []
    monkeypatch.setattr(main, 'run_stream', worker_factory(calls))
    with TestClient(main.app) as client:
        for number in range(7):
            token = client.post('/api/prepare', json={'url': str(number).zfill(11)}).json()['id']
            ready(client, token)
        assert len(main.app.state.jobs) == 6
        token = client.post('/api/prepare', json={'url': '00000000000'}).json()['id']
        ready(client, token)
        assert len(calls) == 8


def test_channel_profile_avatar_and_author_labels(monkeypatch):
    from youtube_feed import channel_profile
    html = '<script>var ytInitialData = ' + json.dumps({'metadata': {'channelMetadataRenderer': {'title': 'Author', 'avatar': {'thumbnails': [{'url': 'https://yt3.ggpht.com/author', 'width': 160}]}}}}) + ';</script>'
    profile = channel_profile(html)
    assert profile['title'] == 'Author' and profile['avatar'].endswith('/author')
    service = main.YouTubeService()
    def fetch(path):
        service.latest_channel_profile = profile
        return [{'id': '9w4PxRm2vhU', 'title': 'Video', 'channel': '552K'}]
    monkeypatch.setattr(service, 'fetch_cards', fetch)
    data = service.channel_videos(CHANNEL)
    assert data['items'][0]['channel'] == 'Author'
    assert data['items'][0]['avatar'].startswith('/api/images/')
    assert data['channel']['avatar'] == data['items'][0]['avatar']
