# LightTube 0.4.0

LightTube runs on a local Windows PC and serves a lightweight video interface to browsers on the same home network. The server uses FastAPI, yt-dlp, Deno and FFmpeg. This source package contains no accounts, cookies or Windows executables.

## Install or update

Back up your working source files, close LightTube and extract this update over the project directory. Keep your existing `.venv`, personal settings and tools. Install dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Start from source:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Or rebuild the standalone Windows application:

```powershell
.\.venv\Scripts\python.exe build_windows.py
```

Run the new `dist\LightTube.exe`. The builder requires FFmpeg, ffprobe and Deno on the build PC; it bundles them with Python and the interface into the EXE. The EXE unpacks its bundled runtime to a temporary location at startup. Windows builds must be created and tested on Windows. The build script also accepts `--onedir`.

Open http://127.0.0.1:8000 on the server PC, or the address displayed by the launcher on your TV/phone. All clients share one active stream and the selected server browser account. Do not expose this unauthenticated local server to the public Internet.

## Desktop application

- **Server:** current LAN address, Start server, Stop, Open LightTube and Minimize to tray.
- **Console:** live output, Copy log and Clear. Worker threads never update Tk directly.
- **Settings:** English/Russian interface and temporary-video folder. Language changes immediately; folder changes apply after Stop and Start.
- Minimize to tray keeps the server running. The tray menu restores the window or quits with normal cleanup. Closing the window stops the server.
- Launcher preferences are stored in `%LOCALAPPDATA%\LightTube\host-settings.json`. Changing the cache folder preserves the language setting.

## Intro and branding

The site uses the supplied neon play image; the native application icon is unchanged. Settings offer the supplied search-to-logo animation, the supplied color-dots animation, a gentler search animation, or no intro. The intro runs alongside the recommendation request. Reduced-motion preferences suppress some effects.

Intro sound can be disabled independently. Firefox, Edge and other browsers may require a user gesture before audio plays: use **Enable sound** on the intro or click it. LightTube does not bypass browser autoplay permissions. Replay intro can be used to test another selection.

## Local profile and continue watching

Click the profile avatar to edit your nickname or select a PNG/JPEG/WebP photo up to 10 MiB. The browser resizes the photo to a 256-pixel square before storing it locally; it is not uploaded to the server or YouTube. Remove photo restores the initials avatar.

**Continue watching** appears below the Recommendations heading and before the main grid. It stores up to 24 unfinished video/music entries on this device, separated by the selected browser/profile. Positions are saved during playback and when leaving the page. Entries expire 24 hours after their latest save or are removed when playback finishes; Clear removes this shelf. Expired entries are removed on the next page access or periodic shelf refresh, not by an OS background task. Browser storage can be cleared or unavailable. Changing hostname/IP changes the browser storage origin.

The existing History tab remains a separate, shared server-memory history, cleared when the server exits. The local shelf can survive a server restart for its remaining lifetime. Restoring an entry starts a new server job when the original cache is unavailable.

## Browsing

- Search filters on desktop support Videos, Channels and Playlists, plus Today, This week, This month and This year. The filter menu is hidden on narrow/touch layouts; basic search remains available.
- Playlist cards open their entries rather than treating the playlist ID as a video.
- Music loads the YouTube music page. Personalization depends on the upstream account and returned markup; this is not a full YouTube Music client.
- Topic chips such as Mixes are populated from real YouTube homepage chips when their navigation data is returned. LightTube does not fabricate personal categories or playlists. Some accounts/layouts do not expose these chips.
- Subscriptions reads the signed-in account's subscriptions video feed. With no account or an unreadable session, a sign-in/browser message is displayed. An empty subscription feed may also mean no videos are available. It does not add/remove channel subscriptions.

## Audio and quality

When available, HLS prepares **at most two** audio renditions: the currently selected language plus the original; if these are the same, the interface language can be the second rendition. Audio choices persist for following videos. Other languages are not all downloaded in advance. FFmpeg copies one H.264 video stream and converts the selected audio renditions to AAC-LC, 128 kbps, 48 kHz stereo.

The HLS master advertises separate language tracks. hls.js switches an already-prepared track within the same playback session; a short buffer transition can still occur. Native HLS uses the browser audio-track API when available. An unprepared language uses the existing background rendition preparation and position restore. No synthetic dubbing is generated. Multi-audio can be disabled by API clients with `multi_audio: false` in `/api/prepare`.

Progressive MP4 remains available when a suitable combined stream exists and a second audio rendition is not needed. Available quality choices are based on compatible source H.264 formats. Many YouTube 2K/4K variants use VP9/AV1 and remain unsupported; there is no upscaling or video transcoding.

Completed HLS renditions, including all referenced alternate-audio playlists, can be reused within the server session when video, quality, audio, interface language and browser/profile match. Partial or missing caches are regenerated. The local Continue shelf stores metadata/positions, not media files.

## YouTube session and recommendations

Firefox is the supported browser-session source in the normal selector. Sign in to YouTube on the server PC, then select its profile. The client TV/phone does not receive the account cookies. Cookies used by LightTube stay in server process memory; your source browser retains its own cookies after exit.

The **Mark completed videos watched on YouTube** preference requests yt-dlp's watched-history reporting only for completed videos and only with a selected browser session. Merely listing cards, prefetching URLs or starting playback does not report a completed view. The feature can be disabled. Reporting uses an additional request, may fail, and does not provide proof YouTube accepted the history entry. YouTube may ignore it when history is paused, authentication is unavailable, or request behavior changes. Recommendation changes are neither immediate nor guaranteed. Diagnostics log reporting failures; requests retain the existing rate-limit cooldown.

The home feed is cached and rate limited. Personal subscription feeds, categories and history reporting rely on YouTube behavior that can change; failures retain search/link playback where possible.

## Storage

The chosen folder holds per-run `lighttube-hls-*` directories. Normal shutdown stops workers and removes this run's temporary videos. Force termination can leave temporary files. A soft cache budget prunes eligible stopped sessions, but an active long video can exceed it. Host preferences and browser-local photo/intro settings remain after shutdown. Account cookies are never included in build artifacts.

## Verification and limits

Python tests cover extraction/caching controls, profile isolation, media URL validation, playlists/date filters, subscription fallback, completion-reporting gating, cache replay and actual FFmpeg generation of a two-language HLS master from local fixtures. Browser interaction checks cover intro animation while the feed loads, choice persistence, photo validation, 24-hour expiry, music/subscription navigation and search filters.

These controlled checks do not authenticate a real YouTube account, prove personalized subscriptions/categories or confirm YouTube history acceptance. Windows GUI/EXE behavior, Firefox/Edge audio permissions and the actual TV must be tested on those devices. Livestream playback remains unsupported.
