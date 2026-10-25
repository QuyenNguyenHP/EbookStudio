from __future__ import annotations

import cgi
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
LIBRARY = ROOT / "Libaries"
SAMPLE_NAME = "Ryden_IntroCosmo.pdf"
MAX_REQUEST = 1024 * 1024 * 1024


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
        if parsed.path == "/api/library":
            LIBRARY.mkdir(exist_ok=True)
            documents = [document_info(path) for path in LIBRARY.glob("*.pdf") if path.name != SAMPLE_NAME]
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


if __name__ == "__main__":
    LIBRARY.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 4173), EbookStudioHandler)
    print(f"EbookStudio: http://127.0.0.1:4173", flush=True)
    print(f"Library: {LIBRARY}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
