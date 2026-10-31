from __future__ import annotations

import os
import json
import subprocess
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from threading import Thread

from server import EbookStudioHandler, LIBRARY, ThreadingHTTPServer


def app_data_directory() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base / "EbookStudio"


def find_edge() -> Path:
    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Edge/Application/msedge.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("Microsoft Edge is required to open the EbookStudio desktop window.")


def wait_for_app_window(profile: Path, url: str) -> None:
    endpoint_file = profile / "DevToolsActivePort"
    deadline = time.monotonic() + 20
    debugging_port = None
    while time.monotonic() < deadline and debugging_port is None:
        try:
            debugging_port = int(endpoint_file.read_text(encoding="utf-8").splitlines()[0])
        except (FileNotFoundError, ValueError, IndexError, OSError):
            time.sleep(0.2)
    if debugging_port is None:
        raise RuntimeError("The EbookStudio desktop window did not start.")

    appeared = False
    missing_checks = 0
    while True:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{debugging_port}/json", timeout=2) as response:
                pages = json.load(response)
            present = any(page.get("url", "").startswith(url) for page in pages)
        except (OSError, ValueError, urllib.error.URLError):
            present = False
        if present:
            appeared = True
            missing_checks = 0
        elif appeared:
            missing_checks += 1
            if missing_checks >= 3:
                return
        elif time.monotonic() >= deadline:
            raise RuntimeError("The EbookStudio page did not open in its desktop window.")
        time.sleep(0.5)


def main() -> None:
    LIBRARY.mkdir(parents=True, exist_ok=True)
    profile = app_data_directory() / "DesktopProfileEdge"
    profile.mkdir(parents=True, exist_ok=True)

    requested_port = int(os.environ.get("EBOOKSTUDIO_PORT", "0"))
    httpd = ThreadingHTTPServer(("127.0.0.1", requested_port), EbookStudioHandler)
    port = httpd.server_address[1]
    thread = Thread(target=httpd.serve_forever, name="ebookstudio-server", daemon=True)
    thread.start()

    try:
        endpoint_file = profile / "DevToolsActivePort"
        endpoint_file.unlink(missing_ok=True)
        url = f"http://127.0.0.1:{port}"
        subprocess.Popen([
            str(find_edge()),
            f"--app={url}",
            f"--user-data-dir={profile}",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--disable-background-mode",
        ])
        wait_for_app_window(profile, url)
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        error_log = app_data_directory() / "desktop-error.log"
        error_log.parent.mkdir(parents=True, exist_ok=True)
        error_log.write_text(traceback.format_exc(), encoding="utf-8")
        raise
