# LightTube — Source Quality Beta

A local streaming client for TVs, laptops and phones. Your PC prepares the stream and serves a browser UI over your home network.

## Update

Back up the working project. Replace these files together:

```text
LightTube/
  main.py
  playback.py
  youtube_feed.py
  profiles.py
  session_cookies.py
  requirements.txt
  README.md
  static/
    index.html
    style.css
    app.js
    hls.min.js       # keep your existing copy
```

Keep your `.venv` and `.gitignore`. If `hls.min.js` is missing:

```powershell
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js" -OutFile ".\static\hls.min.js"
```

Install dependencies and start:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

FFmpeg must be in PATH; Deno is needed for full yt-dlp YouTube support. Python 3.11+ is recommended.
Open http://127.0.0.1:8000 on the PC. Other devices use http://SERVER_IP:8000. Use `ipconfig` to find the server PC's current IPv4 address. Reload with Ctrl+F5 after updating.

## What's new

- More cards from the initial homepage response and a **Show more** button when YouTube provides continuation data.
- A collapsible **Up next** section below the player, parsed from the selected video's actual YouTube watch-page response. It is not a copy of the home feed.
- Channel name and a collapsible description under the video.
- Mini-player: minimize while browsing, restore without restarting playback, or stop it.
- SVG icon controls for play/pause, stop, sound, mini-player, fullscreen and settings. Buttons have labels and tooltips.
- Separate dialogs: player gear for quality and audio language, LT for the server profile, and the top/sidebar gear for playback preferences.
- Session-only history on the server: partial and completed views with playback position.
- Real channel avatars where available, proxied through the local server together with thumbnails.
- Both the in-player timeline and the separate diagnostic timeline remain available.

## Browser selection

Open the **LT** profile button and select the browser installed on the **server PC**: Firefox, Chrome, Edge, Brave, Opera, Vivaldi, Chromium or Safari (where supported), or no browser session.

Open YouTube in that browser, log in if needed, resolve any consent or verification screen, verify that videos and the homepage work, then close the browser before testing.

Browser support does not mean cookie access is guaranteed. Chrome/Edge on Windows may lock or protect cookie databases; selecting Firefox can be a practical alternative. LightTube does not disable browser security.

Changing browser or profile stops the active stream and clears the shared history and recommendation caches. Changing only quality does not stop the current stream.

Optional startup variables:

```powershell
$env:LIGHTTUBE_COOKIE_BROWSER = "firefox"
$env:LIGHTTUBE_FIREFOX_PROFILE = "C:\path\to\firefox\profile"
$env:LIGHTTUBE_DENO = "C:\path\to\deno.exe"
```

The Firefox profile override applies only when Firefox is selected. Client devices do not need the selected browser, Python, Deno or FFmpeg.

## Quality

Settings are maximum limits: Auto (up to 1080p), up to 360p, 480p, 720p or 1080p. The server selects compatible H.264 video and AAC audio.

A source may have a nonstandard height such as 640 or 840 pixels because of its aspect ratio or cropping. That is not a new quality tier. The player badge displays the actual source resolution and frame rate when known; its quality settings also show dimensions, source-reported bitrate, available H.264 choices, and any gap below the requested limit. Video is copied, not upscaled.

Saving quality applies it to the next video. **Apply to this video** prepares a second rendition while the current one keeps playing, then switches at the current playback position. A brief pause is possible; this is staged switching, not seamless adaptive HLS. If preparation fails or times out, the current rendition remains active.

FFmpeg copies the video and converts only audio to AAC-LC, 128 kbps, 48 kHz, stereo. Reconnection attempts are limited. Stream integrity is not guaranteed after network failures; inspect the session's `ffmpeg.log` if playback stalls.

## History and lifetime

There are no LightTube accounts. History is shared by devices connected to this server and exists only in server memory. Playback position is periodically recorded; minimizing keeps playback running, while closing or selecting another video records the previous position.

History, cached page tokens and recommendations reset on server restart. Browser/profile preferences are saved separately and persist. The UI detects a lost connection or a new server session during its periodic local heartbeat and clears stale history from the screen. The old browser-local history key is removed by this version.

Temporary media files are deleted at normal shutdown. An abrupt crash can leave temporary files behind. Browser cookies are not deleted.

History is a record, not a permanent video archive. Selecting an old history card prepares it again from the beginning; saved-position resume is not implemented in this beta.

## Recommendations and pagination

BeautifulSoup4 locates page scripts, and Python decodes `ytInitialData` and `ytcfg` as JSON without executing JavaScript.

The initial feed reads up to 60 available cards; the actual count depends on the response. Show more uses continuation data returned by YouTube, with headers generated by yt-dlp for the selected browser session. Only server-side opaque cursor IDs are exposed to the client.

If YouTube does not supply continuation/context data, the Show more button is hidden. Markup changes, authentication, consent screens or missing data can prevent home or related-feed extraction. The results may differ from the already open YouTube tab. This is not an official YouTube API integration.

Only the selected video's media URLs are extracted; cards do not preload every stream. Home refresh is limited to once a minute and cached for five minutes; search results are cached for three minutes; pagination is limited to one uncached page request every five seconds. Related lists are cached for five minutes. A cooldown is applied after detected HTTP 429 or bot-verification failures; it does not guarantee the restriction has expired afterward.

Viewing is not reported to YouTube watch history. New personalized recommendations are not guaranteed after every LightTube view.

## Player and network limitations

- One active stream per server. Opening another video replaces the previous one.
- No client authentication: connected home-network devices can change settings and stop the stream. Do not expose the server with router port forwarding.
- Streams start after initial HLS segments are ready, without waiting for a full download.
- Seeking is limited to prepared seekable ranges. The gray timeline is data buffered in the browser.
- Prepared server duration does not prove complete audio.
- Up to six old session folders are retained during operation; a long active video may use considerable disk space.
- Channel avatars are used only when present in metadata; otherwise initials remain. Image cache is limited to 8 MiB; Firefox/account cookies are not forwarded to image hosts.
- Live streams and upcoming premieres are not supported. A real legacy TV still requires compatibility testing.
- Never share or commit browser cookies. Account restrictions remain possible when using yt-dlp with an account.

## Verification

Automated tests use controlled HTML/API responses and mock player events. They cover parsing, continuation handling, session authentication headers, browser/quality settings, history reset, local image proxy behavior and UI interactions.

They do not prove that your real browser session, YouTube feeds or every media stream will work.

On your PC test: home cards and Show more, Up next below a video, audio past 1:08, minimize/restore, partial-view history, a server restart clearing history, browser selection and both quality actions. Test the laptop and phone as clients again before committing.

## Search autocomplete

The search bar has a single rounded focus border and up to eight query suggestions after two characters (300 ms debounce). Use Up/Down and Enter, click, or tap; Escape closes the list. Typing a URL skips suggestions. This is query autocomplete, not a numeric T9 keyboard.

`GET /api/suggest?q=...` uses Google's public, undocumented YouTube suggestion service without browser cookies. Queries are sent to Google; results are cached in server memory for ten minutes, failures for 30 seconds. If unavailable, normal search still works. No account-specific autocomplete is promised. Restart the server and hard-refresh after replacing the files; keep your existing `static/hls.min.js`.

## Profiles and immediate player feedback

Click the **LT** profile button to choose a server browser and one of its detected local profiles. Chrome/Edge/Brave/Chromium/Vivaldi standard profile folders and Firefox profiles.ini are discovered; Opera standard folders are also supported. Safari uses automatic selection. The list uses neutral folder labels, never account emails or Google account metadata. If chrome://version has the same profile path in two windows, those windows use the same on-disk profile; the picker lists folders, not individual Google accounts within a profile.

**Ask when opening LightTube** is on initially. Turn it off and click **Done** to use the selected profile automatically on future page loads. Done commits the choice; history remains temporary. Any client can change the shared server profile. Switching clears the shared temporary history and caches and stops playback. This does not circumvent Chrome cookie encryption or database locks.

Preferences are stored outside the project in `%LOCALAPPDATA%\LightTube\settings.json` on Windows (or `~/.config/LightTube/settings.json` elsewhere). No cookies are saved in this file. Override its location with `LIGHTTUBE_SETTINGS_FILE`; for a nonstandard browser profile path use `LIGHTTUBE_CHROME_PROFILE`, `LIGHTTUBE_FIREFOX_PROFILE` or the corresponding browser name, then choose the discovered profile or Automatic. Existing saved preferences take precedence over the browser startup default.

Opening a video immediately shows the player, a loading indicator and the server's current preparation message, with Cancel. Ready shows a Play button; failure shows Retry. This is a preparation indicator, not a download-to-device button or a fabricated percentage. History refreshes now redraw active filters; Unwatched excludes local session-history entries and YouTube watched markers when present in the returned card metadata; it does not download the full account watch history. Filter selection resets to All when navigating between Home, Search and History.

## In-memory cookies

LightTube reads the chosen browser session once when first needed and reuses a YouTube-only cookie jar in server memory. It does not export cookies.txt, save cookies in preferences, send them to frontend clients, or pass a Cookie header to FFmpeg's command line. Cookies for unrelated browser sites are discarded from the imported jar. Switching browser/profile clears the jar; normal server shutdown clears it as well. Restart LightTube to reread a browser session after logging in/out. Changing quality keeps the same jar.

This limits application persistence; it is not a guarantee of physical RAM-only storage. Original cookies remain in the browser profile; yt-dlp may create a temporary database copy while importing; OS paging, hibernation and crash dumps can also capture process memory. Python cannot guarantee secure memory erasure. A separate browser profile used only for YouTube reduces the scope of browser data read during import. No cookie file or account data is included in this ZIP.

## Browsing state, history and keyboard controls

The LightTube logo now returns Home without reloading the page. Profile confirmation, the last submitted search query, the active feed/channel view and filter are remembered in browser localStorage, tagged with the server session ID and browser/profile identity. Refreshing the page restores them while the same server session is running. Profile confirmation can also be remembered for 30 days in the `lighttube-profile` preference cookie. It stores only the browser name and opaque profile ID, never YouTube cookies, email, or a browser profile path. The cookie can be disabled in the LT dialog. It skips the chooser only when its identity matches the current server selection, including after a server restart. It is a UI preference, not authentication. The LT button always allows an explicit switch. The search X button clears the submitted query and returns Home. This local record contains UI state, not Google cookies or credentials; stale data is discarded when the browser next connects to a different server session. Merely closing a tab does not stop the PC server.

Viewing history remains shared **server RAM**, capped at 100 videos, cleared by a server restart or a browser/profile switch. Progress is recorded after viewing begins, periodically during playback and on close/end. It records started videos as well as completed ones; clicking a history item starts it from the beginning in this beta. It is not a downloaded-video archive and is not sent to YouTube watch history. Likes, liking videos, and a separate account-login tab are deliberately not implemented.

**Unwatched** removes any video recorded in LightTube history and any card explicitly marked watched by YouTube in the HTML response. **Watched** includes either source. If a video was watched only on YouTube and the returned card has no watched marker, LightTube cannot know that fact and will still include it under Unwatched. Visible date/view counts are the metadata returned by YouTube, not live counters; missing data is left absent.

Channel names are clickable when a valid YouTube channel ID is available. LightTube loads that channel's Videos page with the existing server browser session, caches it for three minutes and supports Show more when continuation data is present. Channel-only video feeds do not include community posts. If YouTube omits a channel ID, that card's channel label remains non-clickable.

The player attempts playback after the stream manifest is ready. Browser autoplay restrictions may require clicking the compact Play icon once. The loading magnifier animates while feed/search/channel data is being fetched; it stops on completion or error, including an empty result. No indefinite spinner is used to hide a failure.

Keyboard shortcuts while a video is attached: **F** fullscreen, **K / Space** play/pause, **M** mute, **J / L** back/forward 10 seconds, **I** mini-player. With focus in the video area, Left/Right seek ten seconds and Up/Down adjust volume. Text inputs, selectors, editable fields and the settings dialog are excluded from player shortcuts. Playback seeking remains limited to prepared ranges. Card navigation with a TV remote still requires a real-device check.

Firefox is the recommended browser-session source on Windows and worked in the user's tests. LightTube itself may be opened in Chrome. Browser/profile choices also include Chrome, Edge, Brave, Opera, Vivaldi, Chromium and Safari (macOS, automatic selection), plus no browser session; browser-cookie access is not guaranteed. Chrome DPAPI/app-bound decryption failures cannot be solved by RAM storage. Cookie-file import and a native application installer are not included in this version.

## Remaining real-TV checks

Use the same home network, start the PC server with `--host 0.0.0.0`, and open `http://SERVER_IP:8000` on the TV. Check that the homepage and thumbnails load, then play a short known video with audio through the end. Test remote focus, card activation, pause/play, fullscreen, return Home, channel browsing, search autocomplete and Unwatched after starting a video. Repeat after a page refresh and a server restart to verify UI-state lifetime. Test 360p first, then 720p; browser MSE/HLS support, H.264 profile support and TLS capabilities differ on old televisions. Laptop/phone success does not establish compatibility with a particular old TV. No real television, Firefox account or live authenticated YouTube connection was available in the author's test environment.

## Fast Start Beta

The diagnostic panel now offers **Auto (ready MP4 or HLS)** and **HLS only**. This choice applies to the next video; it is remembered with the other browser UI state for the current server session. Auto looks for an existing HTTPS MP4 containing H.264 video and AAC audio. It uses that format only if its height and known frame rate are not below the otherwise-selected H.264 video, and its known video bitrate is not lower when the baseline video bitrate is available. Unknown candidate bitrate/FPS is rejected when required for this comparison. These checks avoid deliberate downgrades; they cannot prove identical visual quality between encodes. Higher-resolution formats are never synthesized, and a progressive 720p/1080p format is not promised.

When eligible, MP4 is relayed through **the PC**, not redirected to YouTube. The server streams bytes without launching FFmpeg or writing a media file; it supports GET/HEAD and a single byte Range for browser seeking. Media addresses are validated and retained privately in RAM, not sent in job-status JSON. Browser cookies are not forwarded to the media source or client. Connections are limited to four active media requests and are closed on completion/disconnect. HTTPS redirects from the upstream are not followed in this beta.

If no suitable MP4 exists, playback uses the existing HLS path. A native MP4 error or lack of initial decoded data for 12 seconds requests HLS; **Switch to HLS** in Diagnostics does the same manually. This is a one-way fallback within the video session, not seamless quality adaptation: it starts from the beginning. An upstream 403/410 marks media addresses for a fresh extraction during fallback. Normal HLS errors still use the existing recovery/error handling. FFmpeg remains required for the fallback and is checked at server startup.

**Prepare selected-card addresses in advance** is enabled initially and can be disabled in Diagnostics. Holding mouse hover or remote/keyboard focus on one video card for 650 ms submits one speculative extraction, no media download. There is no automatic prefetch of all recommendation cards. The frontend and server limit attempts to once per ten seconds, with at most one speculative task. Speculation is skipped while another foreground extraction/stream-preparation task or the shared network lock is busy, and never queues itself ahead of pending playback. A request already executing inside yt-dlp cannot be forcibly interrupted safely; choosing another video during that request may still have to wait. Speculative network operations use shorter five-second socket timeouts and no retries, not a five-second total deadline. Disable the option to compare or if additional YouTube requests cause restrictions.

The same RAM metadata cache is used by prefetch and playback. It holds at most 24 entries, normally for three minutes, bounded by known selected-URL expiry with a 30-second margin. Browser/profile switching clears it. Cache reuse avoids repeated metadata extraction; it does not remove media-network latency, decoder setup or browser buffering. HTTP/3/QUIC, multiple adaptive quality variants, and a guaranteed subsecond startup are not implemented or promised.

Diagnostics reports the delivery mode, cache hit, source format ID, video/audio codecs, FPS and available source video or total bitrate. Unknown bitrate is left absent. Extraction time measures obtaining addresses; MP4 preparation time means the URL was ready, not that bytes or frames arrived. **Click-to-player-start** is measured in the browser using its `playing` event, so it is an approximate playback-start indicator, not an instrumented display-frame timestamp. HLS startup time continues to measure first prepared segments. Video remains un-reencoded; the HLS path still converts audio as before.

For comparison, use the same video, selected quality, device and network. First turn prefetch off and open in HLS-only mode; record delivery mode, extraction/startup times, click-to-player-start and source format/bitrate. Then compare Auto. To test a warm start, enable prefetch, rest hover/focus on a card, allow extraction to finish and open that same video; inspect **Addresses from cache**. Restart the server between cold trials (which also clears the RAM cookie jar), and repeat measurements instead of relying on one run. A missing comparable progressive format will correctly keep Auto on HLS. Compare image quality at the same timestamp and displayed size.

This beta was checked with controlled metadata/HTTP responses and mocked player events. Real Google media delivery, authenticated YouTube access, cookies from the user's browser, old-TV decoding and actual startup speed still require testing on the user's devices. Existing history, channel browsing, thumbnails, session restoration and keyboard controls are retained.


## Player beta: preparation, preferences and quality

The player uses a familiar spinning ring during preparation, buffering and a pending source switch. There is no packet-route diagram or artificial percentage. The spinner stops on playback, cancellation or error; reduced-motion preferences disable rotation.

The **LT** button opens browser/profile preferences. The **player gear** opens quality and audio-language controls. The **top/sidebar gear** opens playback preferences, including the low-quality startup switch. Choosing a profile is remembered locally for 30 days by default; uncheck the remember option to remove this preference cookie. YouTube authentication stays on the server, separate from this harmless UI preference. Different IP addresses or client browsers have separate preference storage.

With **low-quality startup** enabled (default), the server extracts the selected quality once and checks the returned format list for a compatible, ready H.264/AAC MP4 up to 360p. If found, playback starts with that preview. As soon as the preview is ready, target preparation starts immediately from the same extracted metadata, without an extra 2.5-second delay or a second extraction. Low-quality playback is capped at approximately three seconds. If the target is still preparing at that point, the preview pauses and a loading indicator waits for it. A faster target switches sooner. This caps low-quality viewing time; it does not promise a three-second total startup. Without such a preview, playback begins directly at the requested quality. This does not guarantee faster extraction or instant playback.

When the target stream is ready at the current playback position, LightTube switches sources, restores the position and preserves play/pause state. During preparation, both renditions may consume bandwidth; HLS can temporarily use two FFmpeg workers. A short pause during the switch is possible. Cancelling or selecting a different video stops its pending rendition. Unused stale source metadata is re-extracted rather than reused indefinitely.

The **Up next** section is expanded when a video is opened and loads recommendations from that video's watch page. It includes loading feedback and a retry action for empty/error responses. YouTube may return no cards because of authentication, consent, markup changes or availability; LightTube does not substitute the home feed as related recommendations.

Maintainer validation: 62 automated Python tests plus UI interaction checks with mocked media/API responses passed. They cover optional preview selection, trusted source URLs, reuse of extraction, promotion/cancellation, separate settings dialogs, cookie persistence and removal, automatic upgrade and position preservation at 68 seconds. Additional tests cover audio selection, missing-language fallback, persisted quality/audio defaults across server restarts, immediate target preparation, the three-second preview cap, and retries without a preview. Live YouTube, real decoding and old-TV playback must still be tested on your setup.


## Remembered quality and audio language

The player gear offers **Quality and audio**. Save a maximum quality and an audio-language preference once; subsequent videos use them automatically until you change them. Apply to the current video prepares a new rendition and restores the current position. Both preferences are stored in the server's `settings.json` alongside the browser choice, survive server restart, and are shared by clients using this one server. No additional per-video chooser is displayed.

Audio choices include Auto, Original and languages returned in that video's format metadata. Before metadata is available, common language preferences can be selected. LightTube selects existing YouTube audio tracks; it does not generate a translation, synthesize voices or label an unknown track as a confirmed original. If a preferred language or a marked original track is absent, the currently available audio is used and a notice appears under the video. The saved preference is retained for the next video. The preview must match the selected track's language; otherwise it is skipped to avoid changing voices mid-startup.

On automatic target-preparation failure, low-quality playback pauses and a retry starts directly at the selected quality instead of repeating the preview stage. Network and decoding failures still require a real playback check on your server and client device.


## Source-quality selection

Quality is a maximum source-resolution limit. Compatible H.264 candidates are ranked by resolution, then frame rate up to 60 fps, then known video bitrate. The bitrate is source metadata, not a measurement of the local connection or a guarantee of perceived sharpness. The shorter dimension is used for portrait video, so a 720 × 1280 video is eligible for a 720p limit. DRM, untrusted media URLs, unsupported codecs and known frame rates above 60 remain excluded.

The player now displays the chosen source's actual resolution and its FPS, not merely the requested limit. The player gear also shows available compatible source choices, dimensions and known bitrate. If only a smaller H.264 source is available, that is stated explicitly. Increasing the quality cap never upscales the source. Switching to a higher cap can reuse the full cached format list while it is fresh.

Video is still copied with FFmpeg `-c:v copy`; no video re-encoding, sharpening filter or image upscaling is added. A comparable ready MP4 must not reduce known resolution, FPS, bitrate or the selected audio language just to avoid HLS. The optional three-second low-quality startup preview remains separately controlled in playback settings. H.264 compatibility for legacy TVs remains the priority; this beta does not promise parity with a different source codec used by the official player, or restore detail already missing from the source.

The loading spinner's markup and CSS animation are embedded in `static/index.html`. A page-start indicator is visible before external scripts initialize and dismisses after the first local server response or error. The player keeps its preparation/buffering spinner. No animation library or packet-route diagram is needed.

Additional automated checks cover bitrate/FPS selection, invalid-source rejection, portrait-only extraction, actual resolution labels, fresh-format reuse on quality changes, and loader dismissal on server errors. Live image quality and decoding still require testing on the actual server/client setup. For a comparison, choose 1080p, apply it to the current video, wait for the main source, and inspect the actual displayed dimensions. Compare the same timestamp and display size.
