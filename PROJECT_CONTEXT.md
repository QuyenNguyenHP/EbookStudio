# EbookStudio — Project Context

> **Purpose:** This is the handoff file for humans and AI assistants. At the start of a new chat, ask the assistant to read this file before making changes. Keep it current whenever architecture, commands, persistence, or project priorities change.
>
> **Last reviewed:** 2026-10-31

## Quick onboarding prompt

Use this in a new chat:

```text
Read PROJECT_CONTEXT.md and README.md first. Then inspect the files related to my request. Preserve unrelated work and update PROJECT_CONTEXT.md if your changes alter the architecture, commands, persistence model, known issues, or current work notes.
```

## Project summary

EbookStudio is a private, local-first PDF library and reader with a Vietnamese UI. It supports PDF upload and organization, continuous and two-page reading, PDF outlines, lookup/translation, pronunciation, vocabulary, notes, highlights, bookmarks, reading progress, and Markdown export.

The application deliberately has a small stack:

- Backend: Python standard-library `ThreadingHTTPServer` in `server.py`.
- Frontend: vanilla HTML, CSS, and JavaScript ES modules; no build step.
- PDF engine: PDF.js 4.10.38 vendored under `public/vendor/`.
- Runtime content: PDFs and JSON data under `Libaries/` (the spelling is intentional and used in code).
- Online services: MyMemory for English-to-Vietnamese translation and DictionaryAPI as a dictionary fallback.
- Offline pronunciation data: `public/dictionaries/en-US.json`.

The server binds only to `127.0.0.1:1997`. There is no authentication or multi-user isolation.

## Repository map

```text
EbookStudio/
├── AGENTS.md                  # Durable repository instructions for AI agents
├── index.html                 # Entire application shell and UI markup
├── server.py                  # Static server, library API, and JSON persistence API
├── desktop.py                 # Edge app-mode desktop window and server lifecycle
├── start.ps1                  # Windows launcher
├── build-exe.ps1              # Installs build tooling and creates the Windows EXE
├── EbookStudio.spec           # PyInstaller one-file bundle definition
├── requirements.txt           # Python 3.13+ cgi compatibility dependency
├── requirements-build.txt     # Windows packaging dependency
├── package.json               # Node test command; no runtime packages
├── README.md                  # User-facing setup, features, deployment, limitations
├── PROJECT_CONTEXT.md         # This AI/human handoff file
├── src/
│   ├── app.js                 # Main UI state, PDF reader, lookup, notes, interactions
│   ├── library.js             # Frontend wrapper for library/layout HTTP APIs
│   ├── reader-data.js         # Notes/vocabulary persistence and conflict handling
│   ├── pronunciation.js       # Word normalization and IPA lookup
│   ├── glossary.js            # Small built-in English glossary fallback
│   ├── style.css              # General application and library styles
│   ├── reader.css             # PDF reader-specific styles
│   └── theme.css              # Theme tokens/overrides
├── public/
│   ├── logo.png
│   ├── vendor/                # Vendored PDF.js; avoid editing as application code
│   └── dictionaries/          # IPA data, licenses, and attribution
├── tests/
│   ├── test_reader_data.py    # Backend persistence, validation, conflict tests
│   ├── reader-data.test.mjs   # Frontend reader store tests
│   └── pronunciation.test.mjs # Word normalization and pronunciation tests
└── Libaries/                  # Runtime/user data; contents ignored by Git
    ├── *.pdf                  # Uploaded documents
    ├── library.json           # Shelf order and placement (created at runtime)
    ├── reader-data.json       # Shared notes and vocabulary (created at runtime)
    └── .Trash/                # Recoverable deleted PDFs (created at runtime)
```

## How to run

Windows PowerShell:

```powershell
./start.ps1
```

Or directly:

```powershell
python server.py
```

Open <http://127.0.0.1:1997>. Do not use `file://` or `python -m http.server`; uploads and persistence require the APIs in `server.py`.

Python 3.13+ needs the compatibility package in `requirements.txt`. See `README.md` for venv and Linux/systemd setup.

## Tests

Run the JavaScript suite:

```powershell
npm test
```

Run the backend persistence suite:

```powershell
python -m unittest discover -s tests -p test_reader_data.py
```

The JavaScript tests have no npm dependencies and can also be run separately:

```powershell
node tests/pronunciation.test.mjs
node tests/reader-data.test.mjs
```

When changing persistence, run both the Python and reader-data tests. When changing word parsing or IPA behavior, run the pronunciation test.

## Architecture and data flow

1. `server.py` serves repository assets and disables caching for HTML, JavaScript, and CSS.
2. `index.html` loads `src/app.js` as the single module entry point.
3. `app.js` imports the smaller data/API modules and vendored PDF.js.
4. `src/library.js` manages PDF files and shelf layout through `/api/library*`.
5. `src/reader-data.js` loads and saves notes/vocabulary through `/api/reader-data`.
6. PDF.js requests a stored PDF through `/api/library/file?name=...` and renders pages/text layers in the browser.
7. Translation/dictionary requests go directly from the browser to their external services.

### Backend API

| Method | Path | Responsibility |
|---|---|---|
| `GET` | `/api/library` | List top-level PDFs in `Libaries/` |
| `POST` | `/api/library` | Upload one or more multipart PDF files (max request: 1 GiB) |
| `DELETE` | `/api/library?name=...` | Move a PDF to `Libaries/.Trash/` |
| `GET` | `/api/library/file?name=...` | Stream one stored PDF |
| `GET` | `/api/library/layout` | Load shelves, placement, and order |
| `PUT` | `/api/library/layout` | Atomically save shelf layout |
| `GET` | `/api/reader-data` | Load revisioned notes and vocabulary |
| `PUT` | `/api/reader-data` | Validate and atomically save notes/vocabulary |

Uploads are checked for the `%PDF-` signature. Duplicate filenames receive ` (1)`, ` (2)`, etc. Path handling intentionally strips directory components and restricts file access to top-level `.pdf` files in `Libaries/`.

## Persistence rules

- `Libaries/reader-data.json` stores notes and vocabulary in shared backend storage, while every displayed item is scoped by the PDF fingerprint in its `docId`. Writes use a temporary file plus `os.replace`.
- Source runs store data in the repository `Libaries/`. The frozen Windows EXE stores data in `%LOCALAPPDATA%\EbookStudio\Libaries` so one-file extraction and EXE upgrades cannot erase user content.
- Reader data uses optimistic concurrency. A client must send the current `revision`; a stale write gets HTTP `409` rather than overwriting another tab.
- Failed frontend saves create a recovery copy in localStorage under `ebookstudio-reader-recovery`.
- `Libaries/library.json` stores shelf names, document placement, and ordering.
- Reading position, bookmarks, highlights, and some UI state remain browser-local in localStorage.
- PDF fingerprinting ties browser-local reading data to a document.
- `Libaries/` is user data and is Git-ignored except for placeholder/ignore files. Never delete, clean, or overwrite its runtime contents as part of source maintenance.
- Deleted PDFs are moved to `.Trash`; they are not permanently erased by the application.

## Important conventions and constraints

- Keep the project build-free unless a deliberate architectural decision says otherwise.
- Preserve the `Libaries` spelling; renaming it requires a data migration and changes across code/docs.
- Preserve Vietnamese UI copy and UTF-8 encoding. Some terminals may display mojibake even when the files themselves are valid UTF-8.
- Do not edit vendored PDF.js or dictionary datasets for ordinary feature work.
- Keep license and attribution files with all vendored code/data.
- Prefer atomic writes for runtime JSON files.
- Do not weaken reader-data revision checks; they prevent silent cross-tab data loss.
- The server is local-only. Binding publicly requires authentication, HTTPS, and a security review.
- Scanned/image-only PDFs have no OCR. Notes/highlights are application overlays, not embedded into PDFs.
- Online translation is limited to 500 bytes in the UI and depends on third-party availability.
- Back up PDFs together with `reader-data.json`; browser-local progress/bookmarks/highlights require separate browser-profile preservation.

## Current state

- Core library, reading, organization, notes, vocabulary, highlighting, lookup, and export features are implemented.
- Notes and saved vocabulary are shown only for the currently opened PDF. The same word may be saved independently in different PDFs.
- Persistence has backend and frontend automated coverage.
- PDF rendering and reader interactions are mainly browser behavior and do not currently have end-to-end UI tests.
- There is no database, account system, OCR, cloud sync, or production web deployment layer.
- A PyInstaller one-file Windows build is defined by `EbookStudio.spec`; `build-exe.ps1` produces `dist\EbookStudioDesktop.exe`. `desktop.py` hosts the UI in a dedicated Microsoft Edge app-mode window, runs the HTTP API on an ephemeral localhost port, and stops it when the window closes.
- At the time this file was created, Git CLI was not available in the active PowerShell environment, so repository status and the latest commit could not be recorded here.

## Work notes

Use this section for active work that another chat must continue. Keep entries concise; move durable facts into the relevant sections above.

### Active task

- None recorded.

### Decisions pending

- None recorded.

### Recent handoff log

- 2026-10-31: Replaced the normal-browser EXE entry point with a dedicated Microsoft Edge app-mode desktop window. Window-local state persists under `%LOCALAPPDATA%\EbookStudio\DesktopProfileEdge`; closing the window stops the private local server. Edge app mode was selected because the pywebview/pythonnet Windows bridge is incompatible with the ARM64 Python build environment.
- 2026-10-31: Added a single-file Windows EXE build. Bundled assets remain read-only and frozen-app user data is redirected to `%LOCALAPPDATA%\EbookStudio\Libaries`. Translation remains an online-only feature.
- 2026-10-31: Scoped vocabulary display, counts, and duplicate detection to the current PDF fingerprint, matching the existing per-PDF note behavior. Legacy items without `docId` remain stored but are not attached to an arbitrary document.
- 2026-10-31: Added `AGENTS.md` with repository-specific AI workflow, safety boundaries, verification rules, and documentation ownership. Kept the documentation set minimal; no separate goals, plans, or prompt files are currently needed.
- 2026-10-31: Created `PROJECT_CONTEXT.md` as the canonical cross-chat project handoff file based on the current repository and README.

## Maintenance checklist

Update this file when a change affects any of the following:

- file/folder structure or module ownership;
- run, install, test, or deployment commands;
- API routes or external services;
- persistence formats, storage locations, or migration behavior;
- architectural decisions, security boundaries, or important constraints;
- active work, blockers, pending decisions, or non-obvious follow-up tasks.

Before ending a substantial work session:

1. Record unfinished work under **Active task**.
2. Record consequential choices under **Recent handoff log**.
3. Update **Current state** and other durable sections if reality changed.
4. Run the relevant tests and note any failures or tests that could not run.
5. Remove stale notes so this remains a reliable source of truth rather than a chronological diary.
