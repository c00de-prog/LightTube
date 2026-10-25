"""Small local Windows server controller. No account data is bundled."""
import os
import logging
import hashlib
import queue
import io
import json
import tempfile
from pathlib import Path
import socket
import sys
import threading
import webbrowser

VERSION = "0.4.0"


class TrayController:
    """Tray callbacks send events; only the Tk loop changes the window."""
    def __init__(self, image_path):
        self.image_path = image_path
        self.events = queue.Queue()
        self.icon = None
        self.thread = None
        self.ready = False
        self.language = "en"
        self.stopped = False

    def hide(self):
        if self.stopped:
            return
        if self.ready:
            try:
                self.icon.visible = True
                self.events.put(("hide", None))
            except Exception as error:
                self.events.put(("error", str(error)))
            return
        if self.thread and self.thread.is_alive():
            return
        try:
            import pystray
            from PIL import Image
            with Image.open(self.image_path) as image:
                picture = image.convert("RGBA")
                picture.thumbnail((64, 64))
            self.icon = pystray.Icon("LightTube", picture, "LightTube Server",
                menu=pystray.Menu(
                    pystray.MenuItem(lambda item: "Показать LightTube" if self.language == "ru" else "Show LightTube", lambda icon, item: self.events.put(("show", None)), default=True),
                    pystray.MenuItem(lambda item: "Завершить LightTube" if self.language == "ru" else "Quit LightTube", lambda icon, item: self.events.put(("quit", None)))))
            self.thread = threading.Thread(target=self._run, name="lighttube-tray", daemon=True)
            self.thread.start()
        except Exception as error:
            self.events.put(("error", str(error)))

    def _run(self):
        try:
            self.icon.run(setup=self._setup)
        except Exception as error:
            self.events.put(("error", str(error)))
        finally:
            self.events.put(("ended", None))

    def _setup(self, icon):
        try:
            icon.visible = True
            self.events.put(("ready", None))
        except Exception as error:
            self.events.put(("error", str(error)))
            icon.stop()

    def stop(self):
        self.stopped = True
        self.ready = False
        if self.icon:
            self.icon.stop()



class ConsoleStream(io.TextIOBase):
    """Thread-safe, bounded output channel; workers never access Tk."""
    def __init__(self, messages):
        self.messages = messages

    @property
    def encoding(self):
        return "utf-8"

    def writable(self):
        return True

    def isatty(self):
        return False

    def write(self, text):
        if not isinstance(text, str):
            text = str(text)
        if text:
            # Bound each entry and avoid blocking the server on a slow GUI.
            try:
                self.messages.put_nowait(text[-16000:])
            except queue.Full:
                try:
                    self.messages.get_nowait()
                except queue.Empty:
                    pass
                try:
                    self.messages.put_nowait(text[-16000:])
                except queue.Full:
                    pass
        return len(text)

    def flush(self):
        pass


def configure_tools():
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    tools = root / "tools"
    os.environ["PATH"] = str(tools) + os.pathsep + os.environ.get("PATH", "")
    if (tools / "deno.exe").is_file():
        os.environ["LIGHTTUBE_DENO"] = str(tools / "deno.exe")



def host_settings_file():
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".config") / "LightTube" / "host-settings.json"


def load_cache_folder():
    try:
        data = json.loads(host_settings_file().read_text(encoding="utf-8"))
        return data.get("cache_dir", "") if isinstance(data.get("cache_dir", ""), str) else ""
    except (OSError, ValueError, AttributeError):
        return ""


def save_cache_folder(folder):
    target = host_settings_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict): data = {}
    data["cache_dir"] = folder
    temporary.write_text(json.dumps(data), encoding="utf-8")
    temporary.replace(target)


def local_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.3)
            sock.connect(("192.0.2.1", 9))
            return sock.getsockname()[0]
    except OSError:
        return None


def main():
    configure_tools()
    messages = queue.Queue(maxsize=1000)
    original_stdout, original_stderr = sys.stdout, sys.stderr
    output = ConsoleStream(messages)
    sys.stdout = sys.stderr = output
    handler = logging.StreamHandler(output)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s",
                                           datefmt="%H:%M:%S"))
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)
    logging.info("LightTube Server %s · embedded console", VERSION)
    import tkinter as tk
    from tkinter import ttk, filedialog
    from tkinter.scrolledtext import ScrolledText
    root = tk.Tk()
    root.title("LightTube Server " + VERSION)
    root.geometry("860x760")
    root.minsize(660, 620)
    root.configure(bg="#10131c")
    resource_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    if getattr(sys, "frozen", False) and (Path(sys.executable).parent / "static" / "lighttube.ico").is_file():
        resource_root = Path(sys.executable).parent
    try:
        root.iconbitmap(str(resource_root / "static" / "lighttube.ico"))
    except tk.TclError:
        pass
    logo = None
    try:
        logo = tk.PhotoImage(file=str(resource_root / "static" / "lighttube-logo.png")).subsample(18)
        root.iconphoto(True, logo)
    except tk.TclError:
        pass
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("TNotebook", background="#10131c", borderwidth=0)
    style.configure("TNotebook.Tab", background="#1b2235", foreground="#cbd5e7", padding=(18, 10))
    style.map("TNotebook.Tab", background=[("selected", "#303c60")], foreground=[("selected", "white")])
    style.configure("TFrame", background="#10131c")
    style.configure("TLabel", background="#10131c", foreground="#eef0fa", font=("Segoe UI", 11))
    style.configure("TButton", font=("Segoe UI", 10), padding=10, background="#283651", foreground="white")
    style.map("TButton", background=[("active", "#354a75")])
    notebook = ttk.Notebook(root)
    notebook.pack(fill="both", expand=True, padx=16, pady=16)
    frame = ttk.Frame(notebook, padding=22)
    console_frame = ttk.Frame(notebook, padding=18)
    settings_frame = ttk.Frame(notebook, padding=22)
    notebook.add(frame, text="Server")
    notebook.add(console_frame, text="Console")
    notebook.add(settings_frame, text="Settings")
    if logo is not None:
        ttk.Label(frame, image=logo).pack(anchor="w")
    ttk.Label(frame, text="LightTube", font=("Segoe UI", 27, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Your PC is the server. You can hide this window to the tray.").pack(anchor="w", pady=(4, 20))
    status = tk.StringVar(value="Stopped")
    ttk.Label(frame, textvariable=status).pack(anchor="w")
    ip = local_address()
    address = "http://" + ip + ":8000" if ip else ""
    ttk.Label(frame, text="TV / phone address (same home network):").pack(anchor="w", pady=(15, 5))
    entry = ttk.Entry(frame, font=("Segoe UI", 14))
    entry.insert(0, address or "No LAN address found. Check your network.")
    entry.configure(state="readonly")
    entry.pack(fill="x")
    controls = ttk.Frame(frame)
    controls.pack(fill="x", pady=18)
    server = None
    worker = None
    failure = []
    closing = False
    stopping = False
    tray = TrayController(resource_root / "static" / "lighttube.ico")
    selected_cache = load_cache_folder() or os.environ.get("LIGHTTUBE_CACHE_DIR", "")
    cache_text = tk.StringVar(value=selected_cache or "System temporary folder")

    def select_cache():
        nonlocal selected_cache
        chosen = filedialog.askdirectory(parent=root, title=translated("Choose temporary video folder"),
                                          initialdir=selected_cache or str(Path.home()))
        if not chosen:
            return
        try:
            with tempfile.TemporaryFile(dir=chosen):
                pass
            save_cache_folder(chosen)
        except OSError as error:
            logging.error("Cannot use cache folder: %s", error)
            status.set("Cannot use this folder: " + str(error))
            return
        selected_cache = chosen
        cache_text.set(chosen)
        logging.info("Video cache folder selected: %s", chosen)
        status.set("Folder saved. Stop and Start to apply." if worker and worker.is_alive()
                   else "Folder saved. Press Start server.")

    def run():
        try:
            server.run()
            if not server.started and not server.should_exit:
                failure.append("Server startup failed. Check FFmpeg and port 8000.")
        except BaseException as error:
            logging.exception("Server failed")
            failure.append(str(error))

    def start():
        nonlocal server, worker, stopping
        if worker and worker.is_alive():
            return
        # Bind before starting Uvicorn, avoiding a false Ready state when port is occupied.
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                probe.bind(("0.0.0.0", 8000))
            finally:
                probe.close()
            if selected_cache:
                os.environ["LIGHTTUBE_CACHE_DIR"] = selected_cache
            else:
                os.environ.pop("LIGHTTUBE_CACHE_DIR", None)
            import uvicorn
            from main import app, BASE
            logging.info("Serving interface from: %s", BASE / "static")
            for filename in ("index.html", "intro.js"):
                asset = BASE / "static" / filename
                digest = hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
                logging.info("UI asset %s SHA256=%s", filename, digest)
            server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=8000,
                log_config=None, access_log=True, loop="asyncio", http="h11",
                ws="none", timeout_graceful_shutdown=10))
        except Exception as error:
            logging.exception("Could not start server")
            status.set("Could not start: " + str(error))
            return
        failure.clear()
        stopping = False
        worker = threading.Thread(target=run, name="lighttube-server", daemon=False)
        worker.start()
        status.set("Starting…")
        start_button.configure(state="disabled")

    def stop():
        nonlocal stopping
        if server:
            stopping = True
            server.should_exit = True
            status.set("Stopping… waiting for stream cleanup.")
        stop_button.configure(state="disabled")

    def close():
        nonlocal closing
        if closing:
            return
        closing = True
        root.deiconify()
        stop()
        if not worker or not worker.is_alive():
            root.destroy()

    def drain_console():
        chunks = []
        for _ in range(160):
            try:
                chunks.append(messages.get_nowait())
            except queue.Empty:
                break
        if chunks:
            at_bottom = console.yview()[1] >= 0.98
            console.configure(state="normal")
            console.insert("end", "".join(chunks))
            lines = int(console.index("end-1c").split(".")[0])
            if lines > 2000:
                console.delete("1.0", str(lines - 2000) + ".0")
            if int(console.count("1.0", "end-1c", "chars")[0]) > 300000:
                console.delete("1.0", "end-200000c")
            console.configure(state="disabled")
            if at_bottom:
                console.see("end")

    def tick():
        for _ in range(20):
            try:
                event, detail = tray.events.get_nowait()
            except queue.Empty:
                break
            if event == "ready":
                tray.ready = True
            if event in ("ready", "hide") and not closing:
                root.withdraw()
            elif event == "show" and not closing:
                root.deiconify()
                root.lift()
                root.focus_force()
            elif event == "quit":
                close()
                if not worker or not worker.is_alive():
                    return
            elif event in ("error", "ended"):
                tray.ready = False
                if not closing:
                    root.deiconify()
                if event == "error":
                    logging.error("System tray unavailable: %s", detail)
        if closing and (not worker or not worker.is_alive()):
            root.destroy()
            return
        drain_console()
        if worker and worker.is_alive():
            if not stopping and server and server.started:
                status.set("Running · port 8000")
                stop_button.configure(state="normal")
                open_button.configure(state="normal")
        else:
            if closing:
                root.destroy()
                return
            start_button.configure(state="normal")
            stop_button.configure(state="disabled")
            open_button.configure(state="disabled")
            if worker:
                status.set(("Startup failed: " + failure[-1]) if failure else "Stopped")
        root.after(250, tick)

    start_button = ttk.Button(controls, text="Start server", command=start)
    start_button.pack(side="left", padx=(0, 8))
    stop_button = ttk.Button(controls, text="Stop", command=stop, state="disabled")
    stop_button.pack(side="left", padx=(0, 8))
    open_button = ttk.Button(controls, text="Open LightTube", state="disabled",
                            command=lambda: webbrowser.open("http://127.0.0.1:8000"))
    open_button.pack(side="left")
    ttk.Label(frame, text="If Windows asks, allow access on your private home network.",
              wraplength=540).pack(anchor="w")
    ttk.Button(controls, text="Minimize to tray", command=tray.hide).pack(side="left", padx=8)
    cache_controls = ttk.Frame(settings_frame)
    cache_controls.pack(fill="x", pady=(12, 0))
    ttk.Label(cache_controls, text="Temporary video folder").pack(side="left")
    ttk.Button(cache_controls, text="Choose folder…", command=select_cache).pack(side="right")
    ttk.Label(settings_frame, textvariable=cache_text, wraplength=760).pack(anchor="w", pady=(5, 0))
    ttk.Label(settings_frame, text="Changes apply after Stop → Start. Temporary videos are removed on normal shutdown.",
              wraplength=760).pack(anchor="w", pady=(4, 0))
    console_heading = ttk.Frame(console_frame)
    console_heading.pack(fill="x", pady=(18, 6))
    ttk.Label(console_heading, text="Server console").pack(side="left")

    def clear_console():
        console.configure(state="normal")
        console.delete("1.0", "end")
        console.configure(state="disabled")

    def copy_console():
        root.clipboard_clear()
        root.clipboard_append(console.get("1.0", "end-1c"))

    ttk.Button(console_heading, text="Clear", command=clear_console).pack(side="right")
    ttk.Button(console_heading, text="Copy log", command=copy_console).pack(side="right", padx=8)
    console = ScrolledText(console_frame, height=14, bg="#080b12", fg="#cbd5e7",
                           insertbackground="#ffffff", font=("Consolas", 10),
                           relief="flat", borderwidth=8, wrap="word", state="disabled")
    console.pack(fill="both", expand=True)
    translations = {
        "Server":"Сервер", "Console":"Консоль", "Settings":"Настройки",
        "Start server":"Запустить сервер", "Stop":"Остановить", "Open LightTube":"Открыть LightTube",
        "Minimize to tray":"Свернуть в трей", "Choose folder…":"Выбрать папку…",
        "Temporary video folder":"Папка временных видео", "Server console":"Консоль сервера",
        "Clear":"Очистить", "Copy log":"Копировать журнал", "Language":"Язык",
        "Stopped":"Остановлен", "Starting…":"Запуск…", "Running · port 8000":"Работает · порт 8000",
        "System temporary folder":"Системная временная папка",
        "Stopping… waiting for stream cleanup.":"Остановка… очистка временных видео.",
        "Your PC is the server. You can hide this window to the tray.":"Этот ПК — сервер. Окно можно свернуть в трей.",
        "TV / phone address (same home network):":"Адрес для ТВ / телефона в домашней сети:",
        "If Windows asks, allow access on your private home network.":"При запросе Windows разреши доступ в частной домашней сети.",
        "Changes apply after Stop → Start. Temporary videos are removed on normal shutdown.":"Изменения применяются после остановки и запуска. Временные видео удаляются при штатном выходе.",
        "Folder saved. Stop and Start to apply.":"Папка сохранена. Останови и запусти сервер.",
        "Folder saved. Press Start server.":"Папка сохранена. Нажми «Запустить сервер».",
        "Choose temporary video folder":"Выбери папку временных видео",
        "Show LightTube":"Показать LightTube", "Quit LightTube":"Завершить LightTube",
    }
    try:
        saved_language = json.loads(host_settings_file().read_text(encoding="utf-8")).get("language", "en")
    except (OSError, ValueError):
        saved_language = "en"
    language = tk.StringVar(value="Русский" if saved_language == "ru" else "English")
    def translated(text):
        return translations.get(text, text) if language.get() == "Русский" else text
    original_status_set = status.set
    def status_set(text):
        original_status_set(translated(text))
    status.set = status_set
    ttk.Label(settings_frame, text="Language").pack(anchor="w", pady=(24, 8))
    language_select = ttk.Combobox(settings_frame, textvariable=language, values=("English", "Русский"), state="readonly")
    language_select.pack(anchor="w")
    original_texts = {}
    def apply_language(event=None):
        def visit(widget):
            try:
                text = widget.cget("text")
                if text:
                    original = original_texts.setdefault(widget, text)
                    widget.configure(text=translated(original))
            except (tk.TclError, KeyError):
                pass
            for child in widget.winfo_children(): visit(child)
        visit(root)
        for i, title in enumerate(("Server", "Console", "Settings")):
            notebook.tab(i, text=translated(title))
        if not selected_cache: cache_text.set(translated("System temporary folder"))
        current = status.get()
        reverse = {v:k for k,v in translations.items()}
        status.set(reverse.get(current, current))
        # Change tray menu text without modifying the running tray loop.
        tray.language = "ru" if language.get() == "Русский" else "en"
        root.title(("Сервер LightTube " if tray.language == "ru" else "LightTube Server ") + VERSION)
        if tray.icon and tray.ready:
            try: tray.icon.update_menu()
            except Exception: logging.exception("Could not refresh tray menu")
        try:
            data = json.loads(host_settings_file().read_text(encoding="utf-8")) if host_settings_file().exists() else {}
            if not isinstance(data, dict): data = {}
            data["language"] = tray.language
            host_settings_file().parent.mkdir(parents=True, exist_ok=True)
            host_settings_file().write_text(json.dumps(data), encoding="utf-8")
        except (OSError, ValueError): logging.exception("Could not save language")
    language_select.bind("<<ComboboxSelected>>", apply_language)
    apply_language()
    def tk_exception(kind, value, traceback):
        logging.error("Interface error", exc_info=(kind, value, traceback))
    root.report_callback_exception = tk_exception
    root.protocol("WM_DELETE_WINDOW", close)
    root.after(100, tick)
    root.after(200, start)
    try:
        root.mainloop()
    finally:
        try:
            tray.stop()
        except Exception:
            logging.exception("Could not stop system tray")
        root_logger.removeHandler(handler)
        handler.close()
        sys.stdout, sys.stderr = original_stdout, original_stderr


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
