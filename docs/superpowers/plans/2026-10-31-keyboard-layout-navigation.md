# Keyboard Layout and Selection Navigation Implementation Plan

> Use executing-plans inline, TDD, and one final independent review. User confirmed execution of the design on 2026-10-31.

**Goal:** Add exact keyboard nudging and selection framing without bypassing layout persistence.
**Architecture:** Pure selection planners feed JourneyCanvas; existing saveLayouts owns atomic history and transport.
**Tech Stack:** Existing React, Vitest and Playwright, no new dependencies.
**Spec:** `docs/superpowers/specs/2026-10-31-keyboard-layout-navigation-design.md`

## Global Constraints

Keep current codex/publication-v1 workspace and all earlier changes; no automatic commits, pushes, deployments or personal database operations. Tests/builds run serially. One physical keypress = one command; 1/10 world-unit steps, no repeat, no collision jump. Only saved/idle instantaneous persistence state accepts a nudge. Framing changes only camera, 80px padding, scale .08–1. Preserve keyboard scope and existing 500-object limit.

## Review Focus

- Same-render rapid input must not reuse stale geometry: Task 2 immediate snapshot and stale baseline checks.
- Folded/nested selection must stay atomic: Task 1 complete-root validation and visual cover bounds.
- Disconnected selection must not collide via its empty union: Task 1 individual block checks.
- Relative photos/record anchors must use existing persistence coordinates: Tasks 1/2 and real API browser checks.
- Failed/conflicting saves and offscreen selection must remain recoverable: Tasks 2/3.

### Task 1: Pure selection planners

Files: create `src/journal/canvas/selectionLayout.js`, `tests/canvas-selection-layout.test.js`.
Interfaces: `layoutPosition(item, delta={x:0,y:0})` gives API position; `planSelectionMove(scene, ids, delta)` gives validated atomic API positions or throws; `selectionCamera(scene, ids, viewport)` gives `{x,y,scale,detail:true}` or throws. Scene uses existing items/groups/notebooks/headers, ids uses Set/array.

- [x] RED: four directions, 1/10 steps, separated blocks with obstacles in gaps, nested/folded complete roots, sticker exemption, collision rejection, stale/missing/duplicate/oversized selections, API anchors and coordinate bounds; framing actual visual bounds, cover bounds, rotation and small/huge viewports. Run `npm test -- tests/canvas-selection-layout.test.js`, expect missing module then requirement failures.
- [x] GREEN: implement pure planners with existing geometry, collision obstacles and history validation; run the same tests, expect all pass.

### Task 2: Canvas input and UI integration

Files: modify `JourneyCanvas.jsx`, add `tests/canvas-keyboard-layout.test.jsx`, extend `tests/use-journal-persistence.test.jsx` only if integration reveals missing guarantees.
Consumes Task1 exports; produces direction/F keyboard handling, selection button/hint and existing atomic saveLayouts calls.

- [x] RED: 1/10 step, repeat/modifier/editor/dialog isolation, saved/failed/conflict/barrier gating, same-render second press, stale model, pointer/notebook/demo isolation, key scroll prevention, anchor conversion, F/button framing+focus and zero writes. Run `npm test -- tests/canvas-keyboard-layout.test.jsx`, expect new behavior failures.
- [x] GREEN: use current layout.getSnapshot, compare canonical model positions to snapshot, call existing onMoveGroup only once; add button and hint, share framing action. Catch planner/session errors via onError. Run targeted selection/input/persistence tests, expect pass.

### Task 3: Browser and persistence acceptance

Files: extend `scripts/canvas-ui-smoke.mjs`, `tests/e2e-real/journal.spec.js`, verification record and roadmap.

- [x] Add native selection/nudge/undo/redo/framing and collision/keyboard isolation checks without altering earlier fixture expectations; test real conditional persistence and reload in dedicated MySQL container.
- [x] Run full Vitest, lint, build/bundle, canvas four configurations, publication ten states, isolated database E2E (desktop/mobile); inspect outcomes, fix causes. Do not run memory-heavy suites concurrently.
- [x] One independent review of this batch, fix actionable findings with tests; update plan/spec/roadmap and evidence. Close owned temporary runtime resources and inspect residual processes.

Self-review: Spec coverage mapped to all three tasks. Source and target coordinates share `layoutPosition`; visual framing uses actual model, movement uses reserved collision scene. No new implementation approval is requested because the user explicitly confirmed execution.
