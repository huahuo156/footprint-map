# Nested canvas groups implementation plan

**Goal:** Group existing color blocks repeatedly, automatically selecting a whole outer block when any member is selected.
**Architecture:** Keep direct photo ownership and add child-to-parent group edges. Expand descendant photos for rendering, selection and dragging. Dissolving a group promotes its children and direct photos to its parent.
**Tech Stack:** React, shared JavaScript helpers, Express, MySQL, Vitest, Node test, Playwright.
**Spec:** Agreed in chat: preserve inner colors/layout, move descendants together, dissolve one layer at a time, select the whole block automatically.

## Constraints and review focus
- Preserve existing groups and unrelated working tree changes; add an idempotent schema table.
- Never split selected groups at the 500-item limit; report selection limits.
- Reject stale partial memberships on the server, including simultaneous grouping.
- Parent bounds must contain child headings; moving a child must resize ancestors.
- Deleting inner/outer groups or member photos must leave surviving descendants accessible.

### Task 1: Hierarchy and persistence
- [x] Add failing helper and API tests for repeated nesting, partial selection rejection, promotion on dissolution and missing photos.
- [x] Add shared hierarchy/selection helpers and child edge table; update group read/create/delete transactions.
- [x] Run helper and API tests until green.

### Task 2: Canvas interaction
- [x] Add failing selection/layout tests for outer selection, atomic limits, nesting bounds and group creation through the canvas.
- [x] Use expanded memberships in canvas, expand point/marquee/select-all operations atomically, enable grouping existing groups, draw parents behind children and move descendant backgrounds.
- [x] Refresh group state on create/delete and explain nesting in editor.

### Task 3: Verification
- [x] Run full unit/API suite, build, lint changed files and browser checks of nesting, selection, drag and dissolution.
- [x] Review diff for the five risks above; record results here.

## Verification results
- Unit suite: 50 passed.
- API suite: 19 passed, including concurrent overlapping creation, repeated nesting, direct photo promotion and deleted membership.
- Playwright suite: 13 passed, 1 skipped because the personal journal is not empty (existing demo-entry prerequisite).
- Production build and lint of changed JavaScript/JSX files passed.
- Browser screenshot inspected: parent backgrounds wrap child headings and photos; existing sibling positions are preserved.
- Independent review found stale deleted IDs consuming the atomic selection limit. Fixed by filtering group ownership against live canvas items before expansion; regression reproduced red, then green. Follow-up review found no remaining actionable issues.
- Existing unrelated working tree changes preserved; no commit or publication performed.
