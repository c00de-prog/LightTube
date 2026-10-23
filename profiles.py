"""Discover local browser profiles without exposing account names or emails."""
import configparser
import hashlib
import json
import os
from pathlib import Path

BROWSER_IDS = {"none", "firefox", "chrome", "edge", "chromium", "brave", "opera", "vivaldi", "safari"}


def config_path():
    override = os.environ.get("LIGHTTUBE_SETTINGS_FILE")
    if override:
        return Path(override)
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".config")
    return base / "LightTube" / "settings.json"


def load_preferences():
    try:
        data = json.loads(config_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_preferences(browser, profile, quality, ask):
    target = config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps({"browser": browser, "profile": profile, "quality": quality,
                                     "ask_profile": ask}), encoding="utf-8")
    temporary.replace(target)


def browser_profiles(browser):
    found = []
    home = Path.home()
    local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData/Local")
    roaming = Path(os.environ.get("APPDATA") or home / "AppData/Roaming")
    if browser == "firefox":
        roots = [roaming / "Mozilla/Firefox", home / ".mozilla/firefox", home / "Library/Application Support/Firefox"]
        for root in roots:
            ini = configparser.ConfigParser(interpolation=None)
            try:
                ini.read(root / "profiles.ini", encoding="utf-8")
                for name in ini.sections():
                    if not name.startswith("Profile") or not ini.has_option(name, "Path"):
                        continue
                    path = Path(ini.get(name, "Path"))
                    if ini.get(name, "IsRelative", fallback="1") == "1":
                        path = root / path
                    if path.is_dir():
                        found.append(path)
            except (OSError, configparser.Error):
                continue
    else:
        windows = {"chrome": local / "Google/Chrome/User Data", "edge": local / "Microsoft/Edge/User Data",
                   "chromium": local / "Chromium/User Data", "brave": local / "BraveSoftware/Brave-Browser/User Data",
                   "vivaldi": local / "Vivaldi/User Data", "opera": roaming / "Opera Software/Opera Stable"}
        linux = {"chrome": "google-chrome", "edge": "microsoft-edge", "chromium": "chromium",
                 "brave": "BraveSoftware/Brave-Browser", "vivaldi": "vivaldi", "opera": "opera"}
        mac = {"chrome": "Google/Chrome", "edge": "Microsoft Edge", "chromium": "Chromium",
               "brave": "BraveSoftware/Brave-Browser", "vivaldi": "Vivaldi", "opera": "com.operasoftware.Opera"}
        roots = [windows[browser]] if browser in windows else []
        if browser in linux:
            roots += [home / ".config" / linux[browser], home / "Library/Application Support" / mac[browser]]
        for root in roots:
            if browser == "opera" and (root / "Preferences").is_file():
                found.append(root)
            try:
                found.extend(sorted((p for p in root.iterdir() if p.is_dir() and
                                     (p.name == "Default" or p.name.startswith("Profile "))), key=lambda p: p.name))
            except OSError:
                pass
    override = os.environ.get("LIGHTTUBE_" + browser.upper() + "_PROFILE")
    if override and Path(override).is_dir():
        found.insert(0, Path(override))
    result, seen = [], set()
    for path in found:
        path = path.resolve()
        if str(path) in seen:
            continue
        seen.add(str(path))
        identity = hashlib.sha256((browser + ":" + str(path)).encode()).hexdigest()[:24]
        # Never read Chrome Local State names, Google account identifiers or emails.
        label = ("Основной профиль" if path.name == "Default" else path.name) if browser != "firefox" else "Профиль " + str(len(result) + 1)
        if "@" in label:
            label = "Профиль " + str(len(result) + 1)
        result.append({"id": identity, "label": label, "path": str(path)})
    return result


def profile_path(browser, identity):
    if identity == "auto":
        return os.environ.get("LIGHTTUBE_" + browser.upper() + "_PROFILE") or None
    for item in browser_profiles(browser):
        if item["id"] == identity:
            return item["path"]
    raise ValueError("Профиль больше не найден на сервере. Выбери его заново.")
