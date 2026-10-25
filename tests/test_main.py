import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


@pytest.mark.parametrize("url", [
    "9w4PxRm2vhU", "https://youtu.be/9w4PxRm2vhU",
    "https://www.youtube.com/watch?v=9w4PxRm2vhU&list=abc",
    "https://www.youtube.com/shorts/9w4PxRm2vhU",
])
def test_youtube_urls(url):
    assert main.get_video_id(url) == "9w4PxRm2vhU"


@pytest.mark.parametrize("url", [
    "https://youtube.com.evil.test/watch?v=9w4PxRm2vhU",
    "http://youtube.com/watch?v=9w4PxRm2vhU",
    "https://localhost/9w4PxRm2vhU", "https://youtube.com:8443/watch?v=9w4PxRm2vhU",
    "https://user:secret@youtube.com/watch?v=9w4PxRm2vhU",
])
def test_reject_untrusted_urls(url):
    with pytest.raises(ValueError):
        main.get_video_id(url)


def test_feed_cache_refresh_and_no_watch_reporting(monkeypatch):
    calls = []
    service = main.YouTubeService()
    def fake_fetch(path):
        calls.append(path)
        return [{"id": "9w4PxRm2vhU", "title": "Video", "channel": "Channel", "duration": 120}]
    monkeypatch.setattr(service, "fetch_cards", fake_fetch)
    first = service.recommendations()
    assert len(first["items"]) == 1 and not first["cached"]
    assert service.options()["mark_watched"] is False
    assert service.options()["source_address"] == "0.0.0.0"
    assert service.recommendations()["cached"]
    assert service.recommendations(True)["cached"]
    assert len(calls) == 1
    service.feed_attempt -= 61
    assert not service.recommendations(True)["cached"]
    assert len(calls) == 2


def test_429_keeps_existing_feed_and_blocks_new_extraction(monkeypatch):
    service = main.YouTubeService()
    def fail(path):
        raise RuntimeError("HTTP Error 429: Too Many Requests")
    monkeypatch.setattr(service, "fetch_cards", fail)
    service.feed = [{"id": "9w4PxRm2vhU"}]
    service.feed_wall = 1
    result = service.recommendations(True)
    assert result["items"] == service.feed and "YouTube" in result["warning"]
    with pytest.raises(RuntimeError, match="ограничил"):
        service.extract("9w4PxRm2vhU", 720)


def test_empty_feed_reason_survives_cooldown(monkeypatch):
    service = main.YouTubeService()
    def fail(path):
        raise main.FeedParseError("Need Firefox login or changed HTML")
    monkeypatch.setattr(service, "fetch_cards", fail)
    first = service.recommendations()
    second = service.recommendations(True)
    assert first["warning"] in second["warning"]
    assert second["items"] == []


def test_homepage_uses_cookie_session_and_bounded_html(monkeypatch):
    received = []
    from io import BytesIO
    from youtube_feed import parse_cards
    import json
    html = '<script>var ytInitialData = ' + json.dumps({"contents": {"videoRenderer": {
        "videoId": "9w4PxRm2vhU", "title": {"simpleText": "Hello"}}}}) + ';</script>'
    class Response(BytesIO):
        url = "https://www.youtube.com/?hl=ru"
    class FakeYDL:
        cookiejar = object()
        def __init__(self, options):
            assert options["cookiesfrombrowser"][0] == "firefox"
            assert options["source_address"] == "0.0.0.0"
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def urlopen(self, request):
            received.append(request.url)
            return Response(html.encode())
    monkeypatch.setattr(main, "MemoryYoutubeDL", lambda options, provider: FakeYDL(options))
    service = main.YouTubeService()
    result = service.fetch_cards("/?hl=ru")
    assert result[0]["id"] == parse_cards(html)[0]["id"]
    assert result[0]["thumbnail"].startswith("/api/images/")
    assert received == ["https://www.youtube.com/?hl=ru"]


def test_input_reconnect_and_header_injection():
    args = main.input_arguments({"url": "https://abc.googlevideo.com/videoplayback", "http_headers": {
        "User-Agent": "safe", "Referer": "bad\r\nInjected: x"}}, {})
    assert "-reconnect" in args and args.index("-reconnect") < args.index("-i")
    assert "Injected" not in "".join(args)
    with pytest.raises(ValueError):
        main.input_arguments({"url": "http://127.0.0.1/private"}, {})


def test_api_card_selection_and_safe_hls_files(monkeypatch):
    captured = []
    def fake_stream(service, job, identifier, quality):
        captured.append((identifier, quality))
        (job["folder"] / "index.m3u8").write_text("#EXTM3U\n", encoding="utf-8")
        main.update(job, ready=True, stage="complete")
    monkeypatch.setattr(main, "run_stream", fake_stream)
    with TestClient(main.app) as client:
        assert client.get("/").status_code == 200
        assert client.post("/api/prepare", json={"url": "https://evil.test", "quality": 720}).status_code == 400
        assert client.post("/api/prepare", json={"url": "9w4PxRm2vhU", "quality": 2161}).status_code == 422
        result = client.post("/api/prepare", json={"url": "9w4PxRm2vhU", "quality": 720})
        token = result.json()["id"]
        import time
        for _ in range(50):
            if captured:
                break
            time.sleep(.01)
        assert captured == [("9w4PxRm2vhU", 720)]
        state = client.get("/api/jobs/" + token)
        assert state.status_code == 200
        assert state.headers["cache-control"] == "no-store"
        assert client.get(f"/hls/{token}/ffmpeg.log").status_code == 404
        assert client.get("/hls/missing/index.m3u8").status_code == 404
        assert client.post(f"/api/jobs/{token}/stop").status_code == 200


def test_image_proxy_cache_and_no_cookie_forwarding():
    import httpx
    calls = []
    def handler(request):
        calls.append(str(request.url))
        assert 'cookie' not in request.headers
        return httpx.Response(200, headers={'Content-Type': 'image/jpeg'}, content=b'\xff\xd8test-avatar')
    with TestClient(main.app) as client:
        client.portal.call(main.app.state.image_client.aclose)
        main.app.state.image_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        service = main.app.state.youtube
        local = service.register_image('https://yt3.ggpht.com/test-avatar')
        assert local.startswith('/api/images/')
        assert service.register_image('https://yt3.ggpht.com.evil.test/image') == ''
        assert service.register_image('http://127.0.0.1/private') == ''
        response = client.get(local)
        assert response.status_code == 200 and response.headers['content-type'] == 'image/jpeg'
        assert response.headers['x-content-type-options'] == 'nosniff'
        assert client.get(local).status_code == 200
        assert len(calls) == 1
        assert client.get('/api/thumbnail/9w4PxRm2vhU').status_code == 200
        assert client.get('/api/images/not-an-id').status_code == 404
        assert client.get('/api/thumbnail/invalid').status_code == 404


def test_more_uses_session_headers_and_reuses_result(monkeypatch):
    from io import BytesIO
    import json
    from yt_dlp.extractor.youtube import YoutubeTabIE
    calls = []
    class FakeYDL:
        def __init__(self, options): self.params = options
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def urlopen(self, request):
            calls.append(request)
            return BytesIO(json.dumps({'onResponseReceivedActions': [{
                'appendContinuationItemsAction': {'continuationItems': [
                    {'videoRenderer': {'videoId': 'MdQM9Gn2QyA', 'title': {'simpleText': 'Next'}}}
                ]}}]}).encode())
    monkeypatch.setattr(main, 'MemoryYoutubeDL', lambda options, provider: FakeYDL(options))
    monkeypatch.setattr(YoutubeTabIE, 'generate_api_headers', lambda self, ytcfg: {'X-Test-Session': 'test'})
    service = main.YouTubeService()
    key = service.register_cursor({'token': 'upstream-token', 'endpoint': 'browse'}, {'INNERTUBE_CONTEXT': {'client': {'clientName': 'WEB'}}})
    result = service.more(key)
    assert result['warning'] == ''
    assert result['items'][0]['id'] == 'MdQM9Gn2QyA'
    assert result['cursor'] is None
    assert json.loads(calls[0].data)['continuation'] == 'upstream-token'
    assert calls[0].headers['X-Test-Session'] == 'test'
    assert service.more(key) == result and len(calls) == 1


def test_history_is_temporary_but_settings_survive_restart(monkeypatch):
    def fake_stream(service, job, identifier, quality):
        main.update(job, ready=True, stage='complete', title='Example', channel='Test channel', duration=120)
    monkeypatch.setattr(main, 'run_stream', fake_stream)
    with TestClient(main.app) as client:
        sid = client.get('/api/session').json()['session_id']
        token = client.post('/api/prepare', json={'url': '9w4PxRm2vhU', 'quality': 720}).json()['id']
        import time
        for _ in range(50):
            if client.get('/api/jobs/' + token).json()['duration']:
                break
            time.sleep(.01)
        assert client.post('/api/history', json={'token': token, 'position': 35}).status_code == 200
        item = client.get('/api/history').json()['items'][0]
        assert item['position'] == 35 and item['channel'] == 'Test channel' and not item['completed']
        assert client.post('/api/settings', json={'browser': 'chrome', 'quality': 1080}).status_code == 200
        settings = client.get('/api/session').json()
        assert settings['browser'] == 'chrome' and settings['quality'] == 1080
        assert client.get('/api/history').json()['items'] == []
        client.post('/api/history', json={'token': token, 'position': 60})
        assert client.get('/api/history').json()['items'] == []
        assert client.post('/api/settings', json={'browser': 'arbitrary', 'quality': 720}).status_code == 422
    with TestClient(main.app) as client:
        assert client.get('/api/session').json()['session_id'] != sid
        assert client.get('/api/history').json()['items'] == []
        assert client.get('/api/session').json()['quality'] == 1080


def test_settings_accept_auto_and_related_validates_id():
    with TestClient(main.app) as client:
        assert client.post('/api/settings', json={'browser': 'none', 'quality': 0}).status_code == 200
        assert client.get('/api/session').json()['quality'] == 0
        assert client.get('/api/related/bad').status_code == 400
        assert client.get('/api/more?cursor=bad').status_code == 400
