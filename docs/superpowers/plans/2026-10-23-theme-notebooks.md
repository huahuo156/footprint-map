# Theme notebooks implementation plan

> **For agentic workers:** Use subagent-driven-development or executing-plans; complete the tests and integration before delivery.

**Goal:** A themed notebook is an element of the existing canvas. Each bounded page reuses the existing photo, text, sticker and editing system.

**Architecture:** Keep original content records. Store notebook metadata, ordered pages, and unique item-to-page placements separately in MySQL. Extract shared canvas item rendering. The notebook reader displays large logical pages, supports page zoom, bounded free positioning and non-overlapping insertion, and wraps the actual content in a flexible page-turn surface.

**Tech stack:** Existing React/Vite, Express/MySQL, CSS 3D; no new dependencies.

**Spec:** Approved chat design, 2026-10-23: notebooks live on the canvas; named covers; open before moving existing content into a particular page; direct import; no duplicate remaining on canvas; reuse all content components and editors; larger pages; only page count below book; comments instead of movement buttons; flexible paper turning.

## Global constraints
- Preserve all existing uncommitted work and personal records. Work on codex/theme-notebooks in place because existing implementation is uncommitted and would not be present in a new worktree.
- No second content renderer/editor. No photo pixel copies when moving between containers.
- Notebook deletion returns content to canvas, never deletes source photos or marks.
- Pages use a 1200 × 1600 logical surface, fit-to-screen plus zoom; insertion reserves rotated bounds and caption space. Full pages reject insertion explicitly rather than overlap or lose content.
- Read mode has only page count at bottom. Editing/management actions live in a collapsed top menu.

## Review focus
- Mixed content placement, deletion and edits survive refresh and remain unique.
- Grouped canvas photos moved into pages do not leave stale group membership.
- Invalid or full-page moves roll back; failed imports do not strand newly uploaded photos.
- Large/portrait photos and long captions stay visible and avoid adjacent items.
- Page-corner gestures never conflict with dragging/editing content; reduced motion works.

### Task 1: Persistence and API
- [x] Add failing real MySQL tests for creation, metadata, page ordering, unique mixed item placement, rollback, direct import and safe notebook/page deletion.
- [x] Add notebook/page/placement schema with cascading source foreign keys, validation and transactions. Expose notebooks/pages/placements in GET /journal; use existing upload and mark creation with optional notebook_page_id.
- [x] Run API tests; all pass.

### Task 2: Shared canvas content and bounded layout
- [x] Add failing tests for partitioning content without duplicating records, bounded non-overlapping positions, and shared rendering.
- [x] Extract CanvasItem from JourneyCanvas; use it both on canvas and notebook pages. Add notebook geometry helpers and reuse existing image/mark/component models.
- [x] Run frontend suite; all pass.

### Task 3: Integrate notebook reader and canvas
- [x] Add failing UI tests for create/open, shared mixed page content, minimized footer, editing callbacks, placement persistence and management.
- [x] Add covers as draggable canvas elements, reader with big zoomable pages, direct add through existing AddMemory, move drag targets while open, cover/name/page management, and soft page turns.
- [x] Add E2E coverage for actual save/import/move/edit/refresh/flip and two-photo layout; run build/lint/frontend/API/E2E checks.

### Task 4: Review and documentation
- [x] Fresh review of new feature, resolve material findings, rerun affected checks.
- [x] Update README; report validation and material limitations. Do not commit unrelated existing changes.

## Progress
- Baseline: npm test → 55/55 passed.
- Decision: execute approved work without another permission round; preserve dirty checkout on a new feature branch.

## Verification ledger
- Frontend 65 tests pass; lint/build pass.
- Real isolated MySQL API suite 24/24 pass.
- Shared composer two-photo import, page turn, refresh, text addition and canvas sticker move verified in Playwright.
- Independent review found long entry clipping and decode-dependent photo bounds; corrected shared entry sizing and reserved stable photo geometry. Browser regression also caught photo rotation omitted from import preflight; fixed matching server rotations.
- Existing uncommitted changes retained; feature remains on codex/theme-notebooks without committing unrelated files.

## Cover revision (2026-10-23)
- Latest user request supersedes canvas picking: removed “取自画布” and its responsive layout; direct page import stays available through “添加与整理”. Reader actions have three distinct theme-aware background colors.
- Cover picker offers six locally bundled Unsplash photographs with author/source credits, an independent image upload, solid colors with a custom color picker, and text-only typography. Existing journal photos are no longer offered as cover candidates.
- Dedicated uploads validate signatures, MIME and size, save no journal entry, and discard unreferenced uploads on metadata-save failure. New mode/color fields migrate legacy covers without replacing chosen labels or images.
- Verification: 102 unit tests, 30 isolated MySQL integration tests, 3 browser layout/cover tests passed; build and lint passed. Browser screenshots checked for photo, solid, and text covers in light/dark themes. Temporary test database container removed after checks.
