# Notebook flyleaf and ribbon implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in place; preserve the existing dirty checkout.

**Goal:** A quiet opening page and one ribbon bookmark, with the notebook remembering its reading position.
**Architecture:** Prepend a virtual inside-cover/flyleaf spread to the reader without altering stored pages or content numbering. Persist nullable page IDs on the notebook through a dedicated reading-state endpoint; update local state without reloading the entire journal.
**Tech Stack:** Existing React/CSS, Express and MySQL; no new dependencies.
**Spec:** Approved chat: spontaneous recording, simplicity and immersion; reuse name/dedication, allow blank space, one subtle ribbon without a management panel. Start with flyleaf/ribbon; chapter dividers remain a later option.

## Constraints and review focus
- Preserve all existing records and unrelated working changes; no automatic commit.
- Flyleaf is virtual, cannot accept content or become a stored page; adding while viewing it opens the first content spread.
- Resume and bookmark use page IDs so reordering preserves the target. Deleting the target clears its pointer atomically.
- Reject foreign/missing page IDs, invalid fields and missing books without partial saves.
- Persist settled reading position; rapid saves are serialized, demo mode never writes.
- Existing flexible flips, reduced-motion navigation, page editing, numbering and fullscreen layout remain functional.

## Task 1: Reading persistence
Files: server/journal-schema.sql, server/db.js, server/notebooks.js, server/notebooks.test.js, src/lib/api.js, src/journal/useJournal.js.
- [x] Add a real API test for nullable reading/bookmark IDs, reload/reinit, foreign-page rejection, reorder and deletion cleanup; run it and observe failure.
- [x] Add nullable bookmark_page_id and last_read_page_id CHAR(36), idempotent migration, GET fields, and PATCH /notebooks/:id/reading accepting only those nullable IDs. Lock the book/pages to validate ownership and clear targets on page deletion.
- [x] Add saveNotebookReading(id, values) and a serialized optimistic changeNotebookReading callback; verify the API suite on isolated MySQL port3308.

## Task 2: Reader experience
Files: src/journal/NotebookReader.jsx, src/journal/notebook.css, src/journal/JournalPage.jsx, tests/notebook-reader.test.jsx, tests/e2e/notebook-layout.spec.js, README.md.
- [x] Add failing tests for virtual flyleaf, blank dedication, original content numbering, resume by ID, ribbon set/remove/jump, read-only mode and adding from the flyleaf.
- [x] Render the flyleaf with existing name/dedication, integrate its two virtual faces into existing paper turns, resume the stored page, save settled position, and add one ribbon using the reading callback. Keep page count as the only footer.
- [x] Verify unit tests, isolated API tests, mocked browser save/reopen/reorder flows, actual animated flyleaf turns, screenshots in light/dark themes, lint and build.
- [x] Request scoped read-only review, resolve material findings, update documentation, remove temporary test DB and refresh the running local server.

## Verification ledger
- Reading API test first failed 404; reader tests first failed missing flyleaf/ribbon/resume, then passed after implementation.
- 109 unit tests, 31 isolated MySQL API tests, five mocked browser tests and one full real-API composer/reader test passed. Lint/build passed; flyleaf and ribbon screenshots inspected in light/dark themes.
- Independent review was requested but the reviewer could not run because of the account usage limit. Root performed a scoped integration review instead; no independent-review success is claimed.
- Temporary test API, configuration and database were removed. Running application restarted with the additive reading-state migration; health/journal requests and new field presence verified.
