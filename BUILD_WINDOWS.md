# LightTube Windows server — build and test

This package contains source code and a Windows build script. It does not contain a prebuilt or signed EXE.

## Build on your Windows PC

1. Stop the existing Uvicorn server.
2. Extract these files into your existing LightTube project.
3. Open PowerShell in that folder and run:

```powershell
.\.venv\Scripts\python.exe build_windows.py
```

The script creates an isolated .build-venv and installs build dependencies there. Your normal .venv is preserved. Internet access is required during the build.

FFmpeg, FFprobe and Deno must be installed on the build PC. The script searches PATH, the tools folder and common WinGet locations.
If needed, place ffmpeg.exe, ffprobe.exe and deno.exe in tools before building.
For custom paths, set LIGHTTUBE_FFMPEG, LIGHTTUBE_FFPROBE and LIGHTTUBE_DENO environment variables.

Output: dist\LightTube\LightTube.exe.
Distribute the ENTIRE dist\LightTube directory, including _internal. Copying the EXE alone will not work.
After building, Python, FFmpeg and Deno do not need separate installation on the receiving PC.

## Run

Double-click LightTube.exe. The server starts automatically on port 8000.
Use Open LightTube to open the local browser. Enter the displayed LAN URL on your TV/phone.
All clients use the server's selected browser session. Sign in to YouTube in Firefox on the server PC; accounts and cookies are not bundled.

If Windows asks about network access, allow your private home network. No router port forwarding is needed.
A VPN or multiple network adapters can cause the displayed address to select the wrong interface; use ipconfig to verify.

Stop uses Uvicorn's graceful shutdown and waits for stream cleanup. Closing the window does the same.
Keep the application open while watching. Restarting the server clears session history and temporary video cache.

## Windows acceptance check

- Launch from a folder with spaces, without opening a Python terminal.
- Check Start, Stop, restart, Open LightTube and port conflict behavior.
- Open the displayed address from your phone.
- Load Firefox recommendations and play one full video with sound.
- Close the application during playback and confirm port 8000 closes.
- Test a copy on a Windows PC without Python/FFmpeg/Deno.
- Do not publish until these checks pass.

The source was checked in Linux. Windows executable generation, Tk GUI display and playback from the frozen build have NOT been tested here.

## Updates

Close LightTube before replacing dist\LightTube with a new build. Settings remain in %LOCALAPPDATA%\LightTube, outside the application folder.
Build artifacts and source files must not include browser profiles, cookies, venv folders or personal settings.
Dependency licenses still apply to bundled binaries; review their notices before public distribution. Code signing and auto-update are not included.

## Git ignore entries

Add these lines to your existing .gitignore:

    .build-venv/
    build/
    dist/
    *.spec
    tools/


## Console and working intro correction (console-intro-5)

Rebuild after extracting this package:

    .\.venv\Scripts\python.exe build_windows.py

This build uses ONE window with an embedded, scrollable Server console. It prints startup errors, requests, the active static directory and SHA256 prefixes for index.html and intro.js. No separate terminal window is created.
Stop the server with Stop or close the application window. The log is kept in memory and cleared when the application exits. Clear removes the visible log; Copy log copies it to the clipboard.

The build also copies the complete public interface to dist/LightTube/static. The NEW executable prefers that adjacent static directory; the FIRST older executable cannot do this and must be rebuilt.
To update only the interface afterward, replace the complete static directory beside the new executable. Do not mix generations of HTML/JS.
Do not copy the Python source static folder to an unrelated location and expect an already frozen old EXE to use it.

The submitted working search-to-logo intro.js is preserved byte-for-byte. The submitted HTML is preserved except for the cache version query.
HTML/JS/CSS responses are now no-store.

Actual headless Chromium check passed: 48 active intro animations, feed request during the intro, automatic completion and Replay restart, no JavaScript exceptions. This used local API fixtures; Windows EXE execution and real YouTube access were not tested here.


## Embedded console revision

This revision supersedes the external-console build. PyInstaller uses --windowed.
The server controller includes a dark read-only scrollable log, Clear and Copy log buttons.
Worker threads write to a bounded queue; only the Tk UI thread updates the log. The visible text is capped at 2,000 lines / approximately 300,000 characters and the pending queue at 1,000 entries.
The console buffer is not written to disk. Existing temporary FFmpeg logs remain managed by the server as before.
The working submitted intro.js remains unchanged.

Rebuild with:

    .\.venv\Scripts\python.exe build_windows.py

Then run dist\LightTube\LightTube.exe.
Checked: Python syntax, threaded log queue behavior, bounded output, windowed build flag.
Windows GUI layout and the frozen executable still require testing on Windows.
