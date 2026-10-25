from http.cookiejar import Cookie

from fastapi.testclient import TestClient
from yt_dlp.cookies import YoutubeDLCookieJar

import main
from session_cookies import MemoryYoutubeDL


def cookie(domain, name='SID', value='test-secret'):
    return Cookie(0, name, value, None, False, domain, True, domain.startswith('.'), '/', True,
                  True, None, True, None, None, {}, False)


def test_browser_cookies_read_once_pruned_and_never_saved(monkeypatch):
    calls, jars = [], []

    def load(cookie_file, specification, ydl):
        assert cookie_file is None
        calls.append(specification)
        jar = YoutubeDLCookieJar()
        jar.set_cookie(cookie('.youtube.com'))
        jar.set_cookie(cookie('.unrelated.example', 'OTHER'))
        jars.append(jar)
        return jar

    monkeypatch.setattr(main, 'load_cookies', load)
    monkeypatch.setattr(YoutubeDLCookieJar, 'save', lambda *a, **kw: (_ for _ in ()).throw(AssertionError('No writes permitted')))
    service = main.YouTubeService()
    with service.ydl() as first:
        jar = first.cookiejar
        assert [(c.domain,c.name) for c in jar] == [('.youtube.com','SID')]
        assert jar.filename is None
        assert 'cookiesfrombrowser' not in first.params
    with service.ydl() as second:
        assert second.cookiejar is jar
        assert second.cookiejar.get_cookie_header('https://www.youtube.com/') == 'SID=test-secret'
        assert not second.cookiejar.get_cookie_header('https://unrelated.example/')
    assert len(calls) == 1
    service.configure(service.browser, 1080)
    assert service._session_cookies is jar
    service.configure('none', 720)
    assert service._session_cookies is None and list(jar) == []
    with service.ydl() as third:
        assert third.cookiejar is not jar
    assert len(calls) == 2


def test_cookie_writeback_disabled_even_with_filename(tmp_path):
    jar = YoutubeDLCookieJar(str(tmp_path/'secret.txt'))
    jar.set_cookie(cookie('.youtube.com'))
    with MemoryYoutubeDL({'quiet':True,'cookiefile':str(tmp_path/'secret.txt')},lambda _:jar) as ydl:
        assert ydl.cookiejar is jar
    assert not (tmp_path/'secret.txt').exists()


def test_shutdown_clears_jar_and_ffmpeg_gets_no_account_cookie(monkeypatch):
    def load(*args):
        jar = YoutubeDLCookieJar()
        jar.set_cookie(cookie('.youtube.com'))
        return jar
    monkeypatch.setattr(main,'load_cookies',load)
    with TestClient(main.app):
        service = main.app.state.youtube
        with service.ydl() as ydl:
            jar = ydl.cookiejar
        assert len(list(jar)) == 1
    assert service._session_cookies is None and not list(jar)
    args = main.input_arguments({'url':'https://abc.googlevideo.com/videoplayback'}, {'Cookie':'SID=test-secret','User-Agent':'test'})
    assert 'test-secret' not in str(args) and 'User-Agent: test' in str(args)
