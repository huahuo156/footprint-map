# Canvas collision implementation plan

> Execute inline using executing-plans and test-driven-development. User approved the description in chat, with stickers explicitly excluded.

**Goal:** All free canvas content except stickers finds nearby empty space on drop, creation, import and expansion; existing overlaps are repaired and persisted.

**Architecture:** Share collision geometry and obstacle collection across gestures and import. Repair loaded data through the journal hook, excluding notebook page contents. Treat groups as rigid blocks and exclude containing ancestors from obstacles.

**Tech Stack:** Existing React, Vitest, Playwright; no new dependencies.

**Constraints:** Keep stickers at their requested positions and exclude them as obstacles. Preserve group member offsets and rotations. Keep stationary content in place during drag. Use existing authenticated layout APIs, at most 500 items per request. Continue in the clean existing feature branch codex/publication-v1, as the user requested execution in this workspace.

## Review focus

- Folded groups reserve only their visible cover, including hidden descendants in translation.
- Expanded groups reserve their background and heading; ancestors may contain their members.
- Rotations beyond 90 degrees still produce positive bounding rectangles.
- Layout repair must converge after reload and must not write notebook page positions.
- Failed position saves must remain retryable and surface an error.

## Task 1: Shared placement and repair

- [x] Add failing tests in tests/canvas-collision.test.js for cover/group separation, rigid movement, stickers, rotated bounds, large obstacles and repair idempotence.
- [x] Run npm test -- tests/canvas-collision.test.js and confirm failures.
- [x] Implement src/journal/canvasCollision.js and geometry changes in model.js; extend groupExpansion.js for covers and sticker exclusion.
- [x] Run geometry and existing group tests.

## Task 2: Integrate gestures and persistence

- [x] Add failing UI/hook tests for notebook drops and repair persistence/failure.
- [x] Integrate shared obstacles with JourneyCanvas and import planning, and persist repair during useJournal.reload using existing APIs.
- [x] Run npm test, npm run lint and npm run build.
- [x] Exercise drag, folded group movement, reload and sticker overlap in a browser with isolated API fixtures.
- [x] Review final diff and report verified behavior and any limitations.

## Verification record

- Full suite: 44 files, 246 tests passed using a single fork worker with a 256 MB heap to fit available Windows commit memory.
- Static checks: npm run lint and git diff --check passed.
- Production build passed with RAYON_NUM_THREADS=1 and a 256 MB Node heap; existing large-chunk advisory remains.
- Browser fixtures: node scripts/canvas-collision-smoke.mjs passed notebook/photo/text drops, rigid group dragging, sticker overlap, expansion and reload persistence.
- Independent review found inconsistent decoded footprints, ancestor growth collisions and missing heading reservations. All three received failing regression tests and fixes, followed by the green full suite.
- Implementation choices: use a stable 280 by 350 photo reservation across all placement paths; this trades some whitespace for layouts that remain stable after image decoding and reload. Keep group members rigid when translating groups and preserve notebook page placements.

