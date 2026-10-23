"""A shared in-process YouTube cookie jar with no cookie-file writeback."""
from functools import cached_property
from http.cookiejar import DefaultCookiePolicy

from yt_dlp import YoutubeDL


def youtube_domain(domain):
    host = domain.lstrip('.').lower()
    return host == 'youtube.com' or host.endswith('.youtube.com') or host == 'youtu.be'


class YouTubeCookiePolicy(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return youtube_domain(cookie.domain) and super().set_ok(cookie, request)


class MemoryYoutubeDL(YoutubeDL):
    def __init__(self, options, cookie_provider):
        self._cookie_provider = cookie_provider
        options = dict(options)
        options.pop('cookiesfrombrowser', None)
        options.pop('cookiefile', None)
        super().__init__(options)

    @cached_property
    def cookiejar(self):
        return self._cookie_provider(self)

    def save_cookies(self):
        # Never export or write account cookies back to any file.
        pass
