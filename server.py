from __future__ import annotations

try:
    import cgi
except ModuleNotFoundError as error:
    if error.name != "cgi":
        raise
    raise SystemExit(
        "Missing upload dependency. Activate your virtual environment, then run: "
        "python -m pip install -r requirements.txt"
    ) from None
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
LIBRARY = ROOT / "Libaries"
TRASH = LIBRARY / ".Trash"
LIBRARY_LAYOUT = LIBRARY / "library.json"
MAX_REQUEST = 1024 * 1024 * 1024
READER_DATA = LIBRARY / "reader-data.json"
READER_LOCK = Lock()


def read_reader_data():
    if not READER_DATA.exists():
        return {"revision": 0, "notes": [], "words": []}
    data = json.loads(READER_DATA.read_text(encoding="utf-8"))
    validate_reader_data(data)
    return data


def validate_reader_data(data):
    if not isinstance(data, dict) or type(data.get("revision")) is not int or data["revision"] < 0:
        raise ValueError("Invalid reader data revision")
    for field in ("notes", "words"):
        items = data.get(field)
        if not isinstance(items, list) or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in items):
            raise ValueError(f"Invalid {field}")
        if len({item["id"] for item in items}) != len(items):
            raise ValueError(f"Duplicate IDs in {field}")


def safe_name(value: str) -> str:
    name = Path(value or "document.pdf").name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name or "document.pdf"


def available_path(name: str) -> Path:
    candidate = LIBRARY / safe_name(name)
    stem, suffix, index = candidate.stem, candidate.suffix, 1
    while candidate.exists():
        candidate = LIBRARY / f"{stem} ({index}){suffix}"
        index += 1
    return candidate


def document_info(path: Path) -> dict:
    stat = path.stat()
    return {
        "id": path.name,
        "name": path.name,
        "size": stat.st_size,
        "addedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


class EbookStudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/") and (path == "/" or Path(path).suffix.lower() in {".html", ".js", ".mjs", ".css"}):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def json_response(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/reader-data":
            try:
                with READER_LOCK:
                    payload = read_reader_data()
                return self.json_response(payload)
            except (OSError, ValueError) as error:
                return self.json_response({"error": str(error)}, 500)
        if parsed.path == "/api/library/layout":
            try:
                payload = json.loads(LIBRARY_LAYOUT.read_text(encoding="utf-8")) if LIBRARY_LAYOUT.exists() else {}
            except (OSError, json.JSONDecodeError):
                payload = {}
            return self.json_response(payload)
        if parsed.path == "/api/library":
            LIBRARY.mkdir(exist_ok=True)
            documents = [document_info(path) for path in LIBRARY.glob("*.pdf")]
            documents.sort(key=lambda item: item["addedAt"], reverse=True)
            return self.json_response({"documents": documents, "directory": str(LIBRARY)})
        if parsed.path == "/api/library/file":
            name = parse_qs(parsed.query).get("name", [""])[0]
            target = (LIBRARY / Path(name).name).resolve()
            if target.parent != LIBRARY.resolve() or not target.is_file() or target.suffix.lower() != ".pdf":
                return self.send_error(404, "PDF not found")
            stat = target.stat()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(stat.st_size))
            self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{quote(target.name)}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with target.open("rb") as source:
                shutil.copyfileobj(source, self.wfile)
            return
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/library":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > MAX_REQUEST:
            return self.json_response({"error": "Kích thước tải lên không hợp lệ."}, 413)
        if not self.headers.get("Content-Type", "").startswith("multipart/form-data"):
            return self.json_response({"error": "Yêu cầu phải dùng multipart/form-data."}, 400)
        LIBRARY.mkdir(exist_ok=True)
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers["Content-Type"], "CONTENT_LENGTH": str(length)})
        items = form["files"] if "files" in form else []
        if not isinstance(items, list):
            items = [items]
        saved, errors = [], []
        for item in items:
            if not getattr(item, "filename", None) or not getattr(item, "file", None):
                continue
            target = available_path(item.filename)
            temporary = None
            try:
                first = item.file.read(5)
                if first != b"%PDF-":
                    errors.append(f"{item.filename}: không phải PDF hợp lệ")
                    continue
                with tempfile.NamedTemporaryFile(dir=LIBRARY, prefix=".upload-", suffix=".tmp", delete=False) as output:
                    temporary = Path(output.name)
                    output.write(first)
                    shutil.copyfileobj(item.file, output)
                os.replace(temporary, target)
                saved.append(document_info(target))
            except OSError as error:
                errors.append(f"{item.filename}: {error}")
                if temporary and temporary.exists():
                    temporary.unlink(missing_ok=True)
        return self.json_response({"saved": saved, "errors": errors}, 201 if saved else 400)

    def do_PUT(self):
        if urlparse(self.path).path == "/api/reader-data":
            temporary = None
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16 * 1024 * 1024:
                    return self.json_response({"error": "Reader data too large or empty"}, 413)
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                validate_reader_data(payload)
                with READER_LOCK:
                    current = read_reader_data()
                    if payload["revision"] != current["revision"]:
                        return self.json_response({"error": "Reader data changed in another tab. Reload before saving."}, 409)
                    payload = {"revision": current["revision"] + 1, "notes": payload["notes"], "words": payload["words"]}
                    LIBRARY.mkdir(exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=LIBRARY, prefix=".reader-", suffix=".tmp", mode="w", encoding="utf-8", delete=False) as output:
                        temporary = Path(output.name)
                        json.dump(payload, output, ensure_ascii=False, indent=2)
                    os.replace(temporary, READER_DATA)
                return self.json_response({"revision": payload["revision"]})
            except (UnicodeDecodeError, ValueError) as error:
                return self.json_response({"error": str(error)}, 400)
            except OSError as error:
                return self.json_response({"error": str(error)}, 500)
            finally:
                if temporary and temporary.exists():
                    temporary.unlink(missing_ok=True)
        if urlparse(self.path).path != "/api/library/layout":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 1024 * 1024:
            return self.json_response({"error": "Dữ liệu thư viện không hợp lệ."}, 413)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload.get("shelves"), list) or not isinstance(payload.get("placement"), dict) or not isinstance(payload.get("order"), list):
                raise ValueError("Invalid library layout")
            LIBRARY.mkdir(exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=LIBRARY, prefix=".library-", suffix=".tmp", mode="w", encoding="utf-8", delete=False) as output:
                temporary = Path(output.name)
                json.dump(payload, output, ensure_ascii=False, indent=2)
            os.replace(temporary, LIBRARY_LAYOUT)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            if 'temporary' in locals() and temporary.exists():
                temporary.unlink(missing_ok=True)
            return self.json_response({"error": str(error)}, 400)
        return self.json_response({"saved": True})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/library":
            return self.send_error(404)
        name = parse_qs(parsed.query).get("name", [""])[0]
        target = (LIBRARY / Path(name).name).resolve()
        if target.parent != LIBRARY.resolve() or not target.is_file() or target.suffix.lower() != ".pdf":
            return self.json_response({"error": "Không tìm thấy tài liệu PDF."}, 404)
        try:
            TRASH.mkdir(exist_ok=True)
            destination = TRASH / target.name
            stem, suffix, index = destination.stem, destination.suffix, 1
            while destination.exists():
                destination = TRASH / f"{stem} ({index}){suffix}"
                index += 1
            os.replace(target, destination)
        except OSError as error:
            return self.json_response({"error": str(error)}, 500)
        return self.json_response({"deleted": target.name, "recoverableFrom": str(destination)})


if __name__ == "__main__":
    LIBRARY.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 1997), EbookStudioHandler)
    print(f"EbookStudio: http://127.0.0.1:1997", flush=True)
    print(f"Library: {LIBRARY}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
