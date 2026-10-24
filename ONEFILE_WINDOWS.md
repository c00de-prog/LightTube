# LightTube — single Windows EXE

This package contains source and a build script, not a prebuilt executable.

## Build

Close the running old server. Extract into your existing LightTube project, keeping .venv.

Run in PowerShell:

    .\.venv\Scripts\python.exe build_windows.py

Default output:

    dist\LightTube.exe

Transfer only this EXE to another Windows PC. Python, the static interface, FFmpeg, FFprobe and Deno are bundled. Do not copy an old external static directory alongside this EXE unless you intentionally want to override the embedded interface.

The EXE unpacks dependencies into a temporary directory at startup. This can increase startup time and requires writable temporary storage. Keep it running while watching. The server controller includes its own log panel and Minimize button.

Browser cookies/accounts are not bundled. For personalized YouTube access, install Firefox and sign in on the server PC, then select its profile in LightTube. Other clients only need to connect to this PC.

Saved settings and your chosen media-cache directory remain outside the EXE. Temporary runtime dependencies and the temporary video cache are separate things.

## Optional folder build

    .\.venv\Scripts\python.exe build_windows.py --onedir

For that mode only, transfer the ENTIRE dist\LightTube folder.

## Verification on Windows

Test the new single EXE from a new folder with no _internal/static folders beside it. Start/stop the server, open the website, verify intro and playback, then test on a PC without Python/FFmpeg/Deno.

No Windows EXE has been compiled or run in the Linux authoring environment. Python syntax and build-mode argument propagation were checked. One-file support is prepared; successful startup still needs the above Windows test.

The submitted working intro.js is unchanged.
