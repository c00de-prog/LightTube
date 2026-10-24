"""Build on Windows: python build_windows.py. Uses an isolated build environment."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent
STATIC_FILES = ["index.html", "style.css", "app.js", "i18n.js", "intro.js", "hls.min.js", "compatibility.html", "lighttube-logo.png", "lighttube.ico"]


def find_tool(name):
    configured = os.environ.get("LIGHTTUBE_" + name.upper())
    candidates = [ROOT / "tools" / (name + ".exe")]
    if configured:
        candidates.insert(0, Path(configured))
    found = shutil.which(name)
    if found:
        candidates.append(Path(found))
    winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/WinGet/Packages"
    if winget.is_dir():
        if name == "deno":
            candidates += list(winget.glob("DenoLand.Deno_*/deno.exe"))
        else:
            candidates += list(winget.glob("Gyan.FFmpeg_*/ffmpeg-*/bin/" + name + ".exe"))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise RuntimeError(name + ".exe not found. Install it or place it in LightTube/tools/.")


def build():
    onefile = "--onedir" not in sys.argv
    if os.name != "nt":
        raise SystemExit("Build this Windows EXE on Windows. No EXE was generated.")
    for name in STATIC_FILES:
        if not (ROOT / "static" / name).is_file():
            raise SystemExit("Missing static/" + name + ". Keep your existing hls.min.js.")
    tools = {name: find_tool(name) for name in ("ffmpeg", "ffprobe", "deno")}
    if "--worker" not in sys.argv:
        target = ROOT / ".build-venv"
        if not (target / "Scripts/python.exe").is_file():
            venv.EnvBuilder(with_pip=True).create(target)
        python = str(target / "Scripts/python.exe")
        subprocess.run([python, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt"),
                        "pyinstaller>=6,<7"], check=True)
        subprocess.run([python, str(Path(__file__).resolve()), "--worker", "--onefile" if onefile else "--onedir"], check=True)
        return
    args = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile" if onefile else "--onedir",
            "--windowed", "--icon", str(ROOT / "static" / "lighttube.ico"), "--noupx", "--name", "LightTube", "--paths", str(ROOT),
            "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"),
            "--specpath", str(ROOT / "build"),
            "--hidden-import", "main", "--hidden-import", "uvicorn.logging",
            "--collect-all", "yt_dlp", "--collect-all", "yt_dlp_ejs",
            "--collect-all", "certifi", "--collect-all", "curl_cffi",
            "--collect-submodules", "uvicorn",
            "--collect-submodules", "bs4",
            "--hidden-import", "pystray._win32",
            "--collect-submodules", "pystray",
            "--copy-metadata", "yt-dlp"]
    for name in STATIC_FILES:
        args += ["--add-data", str(ROOT / "static" / name) + ":static"]
    binaries = set(tools.values())
    for path in tools.values():
        binaries.update(path.parent.glob("*.dll"))
    for path in sorted(binaries):
        args += ["--add-binary", str(path) + ":tools"]
    args.append(str(ROOT / "server_launcher.py"))
    subprocess.run(args, cwd=ROOT, check=True)
    if onefile:
        print("\nBuilt: " + str(ROOT / "dist/LightTube.exe"))
        print("Transfer this single EXE. Dependencies unpack into a temporary directory at startup.")
    else:
        public_static = ROOT / "dist" / "LightTube" / "static"
        public_static.mkdir(parents=True, exist_ok=True)
        for name in STATIC_FILES:
            shutil.copy2(ROOT / "static" / name, public_static / name)
        print("\nBuilt: " + str(ROOT / "dist/LightTube/LightTube.exe"))
        print("Distribute the ENTIRE dist/LightTube folder.")
    print("Browser sign-in is local to each PC; no cookies or personal settings are bundled.")


if __name__ == "__main__":
    try:
        build()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
