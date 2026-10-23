# Collapsible canvas groups

**Goal:** Fold a color block into a cover card with its name, photo count and up to three thumbnails, and unfold without changing photo positions.
**Architecture:** Persist a boolean on groups with an idempotent existing-database migration. Derive display bounds and ancestor visibility separately from member positions. Use existing group save and layout APIs so collapsed groups remain selectable, nestable and draggable.
**Stack:** React, Express/MySQL, Vitest, Node test and Playwright.
**Spec:** User accepted the proposed fold/unfold feature. Implementation choices: each nested group remembers its own state; buttons explicitly fold/unfold; cover/header drag moves all descendants; saving errors leave the prior state visible.

## Steps
- [x] Write failing layout, API and UI tests for persistence, nested visibility, unchanged positions and failed saves.
- [x] Add collapsed column/migration and partial group updates without overwriting group appearance.
- [x] Derive compact bounds/visibility and render cover cards with accessible fold controls.
- [x] Ensure marquee, overview, selection and drag use visible blocks and retain whole-group semantics.
- [x] Verify unit/API suites, browser persistence/drag/restore/error cases, build and lint; request independent review.

## Review focus
Hidden photos must not be hit by marquee or counted in overview bounds. Parent collapse must preserve child state. Repeated toggles must not move photos. Existing groups default expanded. Partial updates must preserve name/color and reject invalid boolean values.

## Implementation and review
- Partial group PATCH validates an explicit boolean; no fold request writes photo layout or group appearance.
- Existing database migration runs before the older composer marker early return, so existing installations are upgraded idempotently.
- Covers anchor to saved member coordinates, independent of transient decoded image dimensions. Expanded groups reserve at least 320px for header controls.
- Hidden members are excluded from marquee, overview and drop obstacles. Compact covers remain visible drop obstacles and whole-group selection targets.
- Independent review found invisible drop obstacles and cover movement after reload. Both were reproduced with failing tests, fixed, and verified by the reviewer with no remaining actionable findings.

## Verification
- Full unit suite: 55 passed (a resource-related worker failure during a concurrent run was resolved by a sequential rerun).
- Full API suite: 20 passed.
- Production build and changed-file lint passed.
- Fold browser scenario passes persistence, stable cover position after reload, nested state, selection, dragging hidden members, saving failure/retry and unchanged stored coordinates.
- Visual screenshot reviewed: compact cover displays name, explicit expand/edit controls, three thumbnails and counts.

- Full browser run: 9 passed, 1 skipped, 4 failed during a run with connection refusal, renderer interaction timeouts and screenshot capture failure. Sequential retry of those four: 3 passed; the personal-journal end-to-end flow still timed out at the upload/composer interaction (tests/e2e/journal.spec.js:31). Cause remains unconfirmed and is reported rather than claiming a fully green browser suite. The nested/fold browser test passed against the final build.
- Final independent review verified the collision and stable-anchor fixes, with no remaining actionable findings.
