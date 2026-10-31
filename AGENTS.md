# EbookStudio Repository Instructions

These instructions apply to the entire repository. Keep this file concise and durable. Put project facts and session handoffs in `PROJECT_CONTEXT.md`, not here.

## Start here

Before making changes:

1. Read `PROJECT_CONTEXT.md` for architecture, persistence, constraints, and current work.
2. Read the relevant parts of `README.md` for supported behavior and operating instructions.
3. Inspect the files directly related to the request. Treat the live code and tests as the source of truth when documentation is stale.
4. Check for existing user changes and preserve all unrelated work.

Do not create extra planning documents unless the task is large enough to need them or the user requests them.

## Project boundaries

- Preserve the build-free architecture: Python standard library backend plus vanilla HTML, CSS, and JavaScript modules.
- Preserve the intentional `Libaries` directory spelling unless the work includes an explicit data migration.
- Treat `Libaries/` as irreplaceable runtime/user data. Never delete, clean, overwrite, or include its PDFs and generated JSON in routine source changes.
- Do not edit `public/vendor/` or large dictionary datasets during ordinary application work.
- Preserve license and attribution files for vendored code and data.
- Preserve UTF-8 and the existing Vietnamese UI language. A terminal displaying mojibake is not proof that source text should be rewritten.
- Do not weaken filename/path validation, PDF signature checks, atomic JSON writes, or reader-data revision conflict handling.
- Keep the server bound to localhost unless the task explicitly includes authentication, HTTPS, and public-deployment security.
- Do not add dependencies, frameworks, build systems, databases, or external services without a clear requirement.

## Where changes belong

- `server.py`: static serving, PDF library APIs, validation, and JSON persistence.
- `index.html`: application shell and UI markup.
- `src/app.js`: reader state, PDF rendering interactions, lookup, notes, and primary UI behavior.
- `src/library.js`: frontend library and layout API calls.
- `src/reader-data.js`: notes/vocabulary loading, saving, recovery, and conflict behavior.
- `src/pronunciation.js`: word normalization and IPA lookup.
- `src/glossary.js`: small built-in dictionary fallback.
- `src/*.css`: presentation; keep responsibilities aligned with the map in `PROJECT_CONTEXT.md`.
- `tests/`: automated coverage. Add or update focused tests with behavior changes when practical.

Avoid editing generated/runtime data to simulate a code fix.

## Implementation expectations

- Make the smallest coherent change that solves the requested problem.
- Follow existing patterns before introducing new abstractions.
- Preserve compatibility with direct `python server.py` startup and native browser ES modules.
- For persistence changes, consider validation, concurrent tabs, atomicity, corruption, backup/recovery, and backward compatibility.
- For reader changes, consider long PDFs, text selection, continuous and two-page modes, zoom/pan behavior, and browser-local state.
- For library changes, consider duplicate filenames, layout references, recoverable deletion, and missing/corrupt JSON.
- Do not silently broaden the task into deployment, data migration, destructive cleanup, or unrelated refactoring.

## Verification

Run checks proportional to the change:

- JavaScript behavior: `npm test`
- Backend persistence: `python -m unittest discover -s tests -p test_reader_data.py`
- Pronunciation only: `node tests/pronunciation.test.mjs`
- Reader store only: `node tests/reader-data.test.mjs`

For UI work, also perform a focused browser check when browser automation is available. Verify the affected workflow at `http://127.0.0.1:1997` without modifying real library data unnecessarily.

Never claim a check passed unless it was actually run. Report failures and unavailable tools clearly. Documentation-only changes generally require inspection rather than application tests.

## Completion and handoff

Before finishing substantial work:

1. Review the change for accidental edits and contradictions with existing behavior.
2. Run the relevant verification commands.
3. Update `README.md` when user-facing setup, features, deployment, or limitations change.
4. Update `PROJECT_CONTEXT.md` when structure, architecture, APIs, persistence, commands, constraints, current state, or unfinished work change.
5. Record only material decisions and follow-up work; do not turn the context file into a verbose activity diary.
6. Summarize files changed, behavior delivered, verification performed, and any remaining risk or follow-up.

Do not commit, push, deploy, permanently delete data, or modify external systems unless the user explicitly requests it.
