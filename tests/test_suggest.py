import httpx
from fastapi.testclient import TestClient

import main


def test_suggestions_cached_bounded_and_anonymous():
    requests = []

    def upstream(request):
        requests.append(request)
        assert request.url.host == "suggestqueries.google.com"
        assert request.url.params["ds"] == "yt"
        assert "cookie" not in request.headers
        return httpx.Response(200, json=["music", ["music", "Music", "music live", 42] + [str(i) for i in range(20)]])

    with TestClient(main.app) as client:
        original = main.app.state.suggest_client
        main.app.state.suggest_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        # Close the unused real client without making any external request.
        client.portal.call(original.aclose)
        first = client.get("/api/suggest", params={"q": "music"})
        assert first.status_code == 200
        assert first.json()["items"][:2] == ["music", "music live"]
        assert len(first.json()["items"]) == 8
        assert client.get("/api/suggest?q=MUSIC").json() == first.json()
        assert len(requests) == 1
        assert client.get("/api/suggest?q=x").json() == {"items": []}
        assert client.get("/api/suggest?q=https://youtu.be/example").json() == {"items": []}
        assert client.get("/api/suggest", params={"q": "x" * 161}).status_code == 422
        assert len(requests) == 1


def test_suggestion_failure_keeps_search_available_and_is_cached():
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(429)

    with TestClient(main.app) as client:
        original = main.app.state.suggest_client
        main.app.state.suggest_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        client.portal.call(original.aclose)
        assert client.get("/api/suggest?q=music").json() == {"items": []}
        assert client.get("/api/suggest?q=music").json() == {"items": []}
        assert len(calls) == 1
        assert main.app.state.youtube.blocked_until == 0
