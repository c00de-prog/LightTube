# LightTube — Watch & Cache Beta

A lightweight local viewer for TVs, laptops and phones. A PC reads YouTube metadata and prepares compatible media; clients open a small browser interface on the home network.

## Update and run

Back up the working project and copy the contents of the archive's `LightTube` folder into the project. Keep your `.venv`, `.gitignore` and existing `static/hls.min.js`. The archive contains application source and this README; it does not include cookies, local preferences or a commit-message file.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

FFmpeg must be in PATH. Deno is used by yt-dlp for JavaScript challenges. Python 3.11+ is recommended.

On the PC open http://127.0.0.1:8000. Other devices use http://SERVER_IP:8000; find the current server IPv4 address with `ipconfig`. Reload after updating; the CSS and app script also have a new cache version.

If the local HLS library is missing:

```powershell
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js" -OutFile ".\static\hls.min.js"
```

## Watching and browsing

- The player gear opens a compact menu inside the video frame, including fullscreen. Quality, audio-language and playback-speed submenus have working controls; unavailable unrelated YouTube features are not imitated.
- Quality and audio choices are saved on the server and apply to subsequent videos until changed. Applying to the current video prepares another rendition and restores the playback position; a short pause is possible. A choice made during an existing switch is queued.
- The top/sidebar gear opens general playback preferences. The LT button opens the server-browser/profile selector.
- The description contains view/date metadata when available and a three-line preview. Use More/Collapse to expand it. Technical source details remain in settings/diagnostics.
- The separate test buffer strip is removed. The timeline inside the video still shows playback and buffered ranges.
- Rotating loading indicators and the page-start animation are removed. Preparation, buffering and errors use readable status text and cancel/retry controls.
- Related tabs include All, Author and Unwatched. Author loads the selected channel's Videos page, with pagination where YouTube supplies it. It does not merely filter the home feed.
- Search has All and Channels tabs. Channel results open their channel's videos rather than preparing a media stream. Channel names on video cards and under the player are also clickable when a channel ID is available.
- The full watch view hides the previous home/search grid. Opening Home, Search, History or a channel keeps an attached video in the mini-player, allowing browsing without losing playback.

Keyboard controls: F fullscreen, K/Space play/pause, M mute, J/L seek ten seconds and I mini-player. With focus in the video area, arrows seek/change volume. Input fields and open settings menus do not trigger player shortcuts. Player menus support arrows, Enter and Escape.

## Compression, storage and repeat playback

Video is copied with FFmpeg `-c:v copy`; it is not re-encoded, sharpened or upscaled after loading. HLS preparation converts audio to AAC-LC 128 kbps, 48 kHz stereo. Replaying completed cached HLS does not repeat that conversion or change the stored video bytes.

A fully prepared HLS rendition can be reopened from its existing server files without running yt-dlp/FFmpeg again. Reuse requires matching video ID, quality limit, audio preference and browser/profile context. Its playlist must have an end marker and all referenced segment files must still exist and contain data. This validates cache completeness, not the quality or integrity of every decoded packet.

The cache is bounded to **six session entries**, including quality variants and temporary preview sessions. Recently reused entries move to the end of the retention order. Older entries can be evicted before shutdown. These files use the server disk, not an unlimited RAM video archive.

Incomplete preparation is not presented as a complete cached video. If the stream was stopped early, a segment is missing, the rendition has been evicted or the browser/profile context changed, preparation starts again. Resuming a partially generated HLS file is not implemented.

Ready MP4 proxy mode does not save a complete video to disk. Repeat playback in that mode can request media again from YouTube. Media-address metadata is cached separately in memory for up to three minutes, bounded by known URL expiry.

Normal server shutdown deletes its temporary session folder, history and media cache. An abrupt crash may leave temporary files behind. Preferences and the harmless profile-confirmation cookie survive restart; YouTube/browser cookies are not deleted.

## Source quality and audio

The player reports the actual selected source dimensions and FPS where known. Detailed source bitrate and compatible choices are available in settings/diagnostics; the quality cap is not passed off as the actual source resolution.

Compatible H.264 sources are ranked by resolution, then FPS up to 60, then known video bitrate. The shorter dimension is used for portrait video. A ready combined MP4 must not reduce known resolution, FPS, bitrate or the selected audio language simply to avoid HLS. Source-reported bitrate is not a measurement of the current Wi-Fi connection or a guarantee of perceived sharpness.

Auto is currently capped at 1080p. Legacy-TV compatibility remains the priority; VP9/AV1 is not passed to unsupported clients. Missing detail in an already compressed source cannot be restored by stream copying.

The optional low-quality startup preview uses a compatible H.264/AAC MP4 up to 360p in the selected audio language, if one exists. Target preparation starts immediately; preview playback is capped at about three seconds. If the target is not ready then, the preview pauses and status text waits for it. This caps time spent watching low quality, not total startup time. Disable the preview in general settings for direct selected-quality testing.

Audio choices select existing YouTube tracks, not generated voice-over or translation. Auto, Original and available language preferences are supported. If a saved language is absent, a compatible available track is used while the preference remains saved for the next video. Not all formats identify their language or mark an original track.

## Browser session and preferences

Use LT to choose a browser installed on the **server PC**. Firefox, Chrome, Edge, Brave, Opera, Vivaldi, Chromium and Safari (where supported) are listed, along with no browser session. Install support does not guarantee permission to decrypt cookies; Chrome-family browsers on Windows can block it. Firefox is the practical alternative used in earlier tests.

Open YouTube in the selected server browser, sign in if needed and resolve any consent/check page. Clients can use another browser and do not need Python, FFmpeg, Deno or a local YouTube login.

Detected profiles use neutral labels without emails. Preferences are saved in the server's LightTube settings file, outside application source by default. Changing browser/profile stops the current stream and clears recommendation/history context.

The optional `lighttube-profile` client cookie remembers profile confirmation for 30 days. It contains only browser name and opaque profile ID, not YouTube cookies, passwords, email or a profile path. Turn it off in LT to remove it. It is a UI preference, not authentication.

Imported YouTube cookies are reused in server memory. LightTube does not export a cookies.txt file or send those cookies to frontend clients. Browser-reading internals may use temporary database copies, and the OS may page memory; this is not a guarantee that no authentication data ever touches disk. Restart the server to reread the browser session after signing in/out.

Optional server overrides:

```powershell
$env:LIGHTTUBE_COOKIE_BROWSER = "firefox"
$env:LIGHTTUBE_FIREFOX_PROFILE = "C:\path\to\firefox\profile"
$env:LIGHTTUBE_DENO = "C:\path\to\deno.exe"
```

## Recommendations, history and network scope

BeautifulSoup locates YouTube page scripts; JSON is parsed without executing page JavaScript. Home, watch-related, channel and search responses are parsed separately. Continuation data is followed where available. Markup changes, missing metadata, authentication or rate limiting can prevent results; the lists can differ from the open YouTube browser tab.

Search autocomplete uses Google's public suggestion endpoint without account cookies. Home refresh is limited to once a minute, normal search and channel-only search have separate five-second request limits, and pagination is rate-limited. Detected bot checks/429 errors trigger a five-minute application cooldown, not a guarantee that an upstream restriction expires then.

History is shared server RAM, capped at 100 entries and cleared on restart or browser/profile change. Unwatched uses this history and explicit watched markers supplied on YouTube cards; it cannot infer the full account history. LightTube playback is not sent to YouTube watch history. Likes, subscriptions and YouTube-account management are not implemented.

One viewing session is active on the server, with a second rendition possible during a quality/audio switch. Connected home-network clients share server settings and can interrupt each other's stream. This beta has no client authentication: use it on your home network without router port forwarding. Traffic to YouTube uses HTTPS; the default local server URL uses HTTP.

## Validation

67 automated Python checks passed using controlled HTML/API/media fixtures. Checks cover channel search parsing/filtering, completed-HLS replay without another worker, rejection of partial/missing/proxy caches, bounded retention, profile isolation, source quality, audio preferences, safe URLs and existing API behavior.

Mock-browser interaction checks passed for in-player menus, quality/audio persistence with position restoration, playback speed, author/unwatched tabs, channel navigation, description expansion, removed indicators/debug strip, keyboard controls and earlier playback behavior. These do not verify actual decoding, live YouTube markup, visual rendering on an old TV or real-network playback reliability.

On your setup, test the provided long video through the previous stopping point, switch quality/audio in fullscreen, open Author, search Channels, expand/collapse the description and reopen a completely prepared HLS video. Diagnostics should identify a completed media-cache hit on replay. Then test the actual TV and phone.


## Disk budget

The temporary media cache now has a 3 GB (3,000,000,000 byte) budget in addition to its six-session limit. Old stopped entries are removed first; reusing an entry moves it to the end of the retention order. Cleanup runs on playback preparation, after stopped workers release their files, and every ten seconds. Active playback and a pending quality rendition are protected, so total temporary disk use can exceed 3 GB while they are active. Closing or replacing an oversized stream allows cleanup. This bounds retained disk media, not RAM usage. No lossy recompression is introduced.


## Author display fix

A visible Open channel button is provided under the player and in the Author tab. Channel headers and author cards use the channel profile image when YouTube returns it. Missing author labels on channel video listings are filled with the channel name; a subscriber/view count is not used as the avatar initial. Missing images use a generic placeholder. Common audio-language codes such as cs, hu, id, it, pl and ro now have readable language names.


## Mobile landscape and TV diagnosis

Fullscreen now requests landscape after fullscreen succeeds when supported, unlocks on exit, and falls back to native video fullscreen on browsers that expose it. Orientation permission and OS auto-rotate still depend on the real device/browser. Compact touch landscape layouts hide the sidebar and fit the video to the viewport. Use the Compatibility link or `/static/compatibility.html` on the TV after a playback failure. It reports browser API/codec declarations and the last 20 local HLS error summaries from that tab; it does not prove actual decoding or send diagnostics to a remote service. No TV-specific playback fix is claimed yet.


## Native HLS diagnostic test

Open `/?native_hls=1` to test native browser HLS playback instead of hls.js when the selected delivery mode is HLS. This is opt-in and requires the browser to report native HLS support. Ready MP4 playback remains unchanged. Media-element error codes are saved in the same local diagnostic summary. This test distinguishes playback paths and is not a confirmed TV fix.


## Clean player beta
The author quality badge and separate channel buttons are hidden. Click the author avatar or name to open the channel. Click the video surface to pause/resume.
General settings now apply quality/audio preferences to the current video as well as future videos (a short preparation pause is possible). Only tracks provided by YouTube are available.
Developer options hide diagnostics and the server sidebar note by default. Developer mode, next-video autoplay (off by default), and partial Russian/English UI translations are stored in this browser's localStorage and survive a server restart.
Next-video autoplay selects the first unviewed related video already loaded for the current video. If there is no candidate, playback ends normally. Browser autoplay restrictions still apply.
1440p and 2160p are accepted quality caps. This beta still requires H.264 video and AAC audio: many YouTube 2K/4K variants use other codecs and therefore will not be selected. Auto remains capped at 1080p. There is no upscaling or AV1/VP9 transcoding in this update.
This archive updates the web client and Python server; it is not an Android APK and does not resolve the TV Chrome decoder issue.
Chrome session access uses yt-dlp's browser reader; Windows cookie encryption may prevent reading. No Chrome exporter extension or cookie-file importer has been added here.

The browser-session selector now offers Firefox and no cookies only. Other browser integrations remain legacy API options, not supported choices in the beta UI. Opening the LightTube website in Chrome is independent of reading Chrome cookies. Firefox is recommended, not guaranteed error-free.


## Playback stability test beta
Settings open as a full-page dialog. Nickname and optional autoplay are browser-local preferences. A greeting appears once per server session in this tab. Loading transitions respect reduced motion.
An offline/retry screen works in an already loaded page. A first visit while the server is off still shows the browser connection error; no offline shell or APK is included.
Playback position is saved per tab and restored only while server session and settings context match. Reload recovery prepares the video again and may require Play after seeking. History supports returning to incomplete videos during the server session.
The HLS manifest endpoint reads a byte snapshot with bounded PermissionError retries, avoiding deferred FileResponse reads of a changing playlist on Windows. Persistent locks return retryable 503.
Quality menu filters standard resolutions against actual extracted H.264 formats, now including formats up to 2160p. This is not a browser decoder capability guarantee. No new 4K codec/transcoder support is added.
Buffer memory is bounded more conservatively. SourceBuffer append/reset failures no longer trigger repeated media recovery loops. Actual failing YouTube streams need device testing; this is not a verified universal bufferAppendError fix.
Unavailable audio generates a visible warning. Existing language selection and source replacement remain in use; this build cannot create a missing Russian audio track.
Channel banners/popular/playlists/For You are not implemented in this package. Live streams remain explicitly unsupported, and no live YouTube playback was tested.


## Profile and settings UI revision
The account button shows a local nickname and opens its dedicated dialog. Browser-session selection is in Settings. Settings lock background scrolling. Next-video autoplay is a compact switch inside player controls; the duplicate setting and Unwatched tabs are hidden. The network badge is hidden.
A separate i18n.js translates common controls, dialogs and settings into English/Russian; source video/channel titles and some backend diagnostic messages remain untranslated. This is not complete localization.
The quality menu is built from extracted H.264 resolutions, including nonstandard dimensions. API quality caps accept integers from 0 through 2160; 0 remains Auto up to 1080p. This does not add unsupported codec playback.
Validation: 71 backend tests, UI checks for nickname persistence, dialog scroll lock, English labels, autoplay placement, and native HLS opt-in. No real TV/browser playback test was performed here.


## Intro and visual refresh
The supplied intro has been integrated as static/intro.js, with English greeting and hints, optional browser-permitted Web Audio, click/keyboard skip and a reduced-motion static fallback. It runs on each document load and bfcache return without waiting for the server response. Recommendation loading proceeds independently. An offline first visit still requires a running server.
Navigating away from watch clears the active-watch reload snapshot. Subsequent mini-player time updates cannot restore it. Returning to a video through history still supports its saved playback position.
The visual refresh uses cool violet/cyan accents, clearer surfaces, rounded cards and unified settings/player controls. No remote fonts or third-party assets were added.
Validation includes intro/feed concurrency and navigation versus mini-player snapshot behavior in jsdom. Real browser animation rendering, audio output and TV playback remain device checks.


## Up-next and channel tabs beta
Next-video autoplay now opens an 8-second overlay with thumbnail, title, channel, Continue and Cancel. No prepare request for the next stream is sent until the timer expires or Continue is selected. Leaving the view or disabling autoplay cancels the timer.
The switch shows a pause mark when disabled. A Filters button reveals the remaining All/Watched controls.
Channel pages have Home, Videos, Live and Playlists tabs. Playlists load up to 60 flat entries through yt-dlp and open up to 60 videos. There is no playlist pagination, automatic playlist queue, or guarantee that all YouTube layouts return items. The Live tab lists videos only; actual live playback remains unsupported. No live account or playlist network test was run in this environment.
Additional English UI messages were added. Unexpected raw upstream errors may remain in their original language.
A static English welcome is present in HTML as a fallback when intro.js cannot load. Full animation still depends on browser APIs and motion preferences.
Validation: 71 backend tests plus UI checks for countdown cancellation, filters, channel tabs, intro/feed concurrency, nickname dialog and navigation restore behavior. Real browser rendering and YouTube network access require device testing.


## English startup and avatar correction
English is selected once when upgrading to this locale revision, even if an earlier default saved Russian; users may explicitly select Russian again afterward. More upstream error and empty-state strings are translated. This does not fix an underlying YouTube account/network failure, and arbitrary upstream diagnostics are not fully localized.
The account avatar shows the first and last non-space nickname characters (uppercase). A random palette color is generated once and saved in this browser.
Settings include Replay intro. Intro exceptions are logged and show a simple English fallback instead of silently hiding the intro. Browsers without Web Animations use a CSS entrance; reduced-motion mode remains static. Full animation scheduling was tested with a mocked Web Animations API, not visually rendered on the user's browser.
Validation: 71 backend tests and UI checks for English startup, nickname initials, persistent random color, full animation scheduling and intro/navigation behavior.

## Translation crash hotfix
Fixed multiline text handling in the translation observer. Nonfatal HLS events log at debug level only with Developer mode; fatal errors remain visible. An inline favicon avoids a missing favicon request. Other 404s still need their request URL to diagnose. Multiline/observer regression check passed.


## Date/channel filters and actual browser verification
Filters now include upload date for video search (any time/hour/today/week/month/year) and an author selector for already loaded cards. Date is disabled outside video search; channel-only search does not apply an upload-date filter. Date preference is retained with the search in the same server session. YouTube search filter encoding is unofficial and live result filtering was not verified against an account here.
Instant audio-language switching is NOT implemented: the current muxed HLS contains one audio track, and changing language still prepares another rendition. Seamless switching requires a multi-audio delivery pipeline and device tests.
Validation: 71 backend tests, existing UI regressions, plus actual headless Chromium rendering with local mocked API responses. The intro displayed with 32 active animations, completed and closed; the filter panel opened; no JavaScript page exceptions were reported. This verifies local animation/UI behavior, not account access, audio output or TV decoding.
