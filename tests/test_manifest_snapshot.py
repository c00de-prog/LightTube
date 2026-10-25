import threading
from types import SimpleNamespace
from pathlib import Path

import main


def test_manifest_permission_retry_and_snapshot(tmp_path, monkeypatch):
    path = tmp_path / "index.m3u8"
    path.write_bytes(b"#EXTM3U\n")
    job = {"folder": tmp_path, "lock": threading.Lock()}
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(jobs={"test": job})))
    original = Path.read_bytes
    calls = []
    def read(p):
        calls.append(p)
        if len(calls) == 1:
            raise PermissionError("FFmpeg replacement")
        return original(p)
    monkeypatch.setattr(Path, "read_bytes", read)
    response = main.hls_file("test", "index.m3u8", request)
    assert response.body == b"#EXTM3U\n"
    assert response.headers["content-length"] == str(len(response.body))
    assert len(calls) == 2


def test_manifest_locked_returns_retryable_response(tmp_path, monkeypatch):
    (tmp_path / "index.m3u8").write_bytes(b"#EXTM3U\n")
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(jobs={
        "test": {"folder": tmp_path, "lock": threading.Lock()}
    })))
    def locked(p):
        raise PermissionError("locked")
    monkeypatch.setattr(Path, "read_bytes", locked)
    response = main.hls_file("test", "index.m3u8", request)
    assert response.status_code == 503
    assert response.headers["retry-after"] == "1"
