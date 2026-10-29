# Atlas single-scene perspective trial

User approved trying a single scene containing all located photos. Wheel zoom should progressively tilt the larger map while photos face the viewer. Connector lines must be distinct from green land and province boundaries.

Execute inline in the existing workspace. Preserve all journal data and existing local placements where they still fit. No new dependencies.

- [x] Add failing tests for unlimited layout, map clearance and projected pin geometry; update pagination assertions to the approved all-photo behavior.
- [x] Add shared scene geometry, compact province groups on an expanding canvas and a bounded perspective projection.
- [x] Split transformed geographic surfaces from upright pins and photo cards, keeping connector endpoints synchronized with projected pins.
- [x] Replace pagination with all-photo rendering, enlarge the map, link tilt to wheel zoom and preserve fit/focus/keyboard navigation.
- [x] Give photo connectors their corresponding PIN color and a background halo; highlight the active connection.
- [x] Verify unit tests, lint, build, and light/dark browser interaction using fixtures with 20 and 80 photos, including pin alignment and no photo overlap.

Review focus: actual CSS and numerical projection must agree; all photos remain accessible when focusing one place; map transforms must not alter drag coordinates; reduced-motion and mobile interactions remain usable.

## Verification

- Full suite: 45 files, 253 tests passed using the existing Vitest config with a single fork worker and a 256 MB Node heap.
- Lint, diff whitespace checks and production build passed; existing large-bundle advisory remains.
- Browser fixtures: dark/light desktop20, dark desktop80, mobile20; verified no pagination, no photo collisions, pin/surface alignment below1px, matching PIN/connector colors, province keyboard activation, place focus/return, fit reset and stable camera after dragging.
- Geometry cases also cover200 photos. This trial makes no claim about unlimited-scale performance; images remain lazily decoded.
- Independent review found automatic camera rescaling after dropping an outermost photo. A browser assertion reproduced the jump, then passed after freezing fitted bounds until explicit fit or photo membership changes.
- Small trackpad deltas now accumulate proportionally; the regression reproduced a300% jump before the fix and110% afterwards.
- Design choices for this trial: map scale1.65, perspective1400px, tilt0–58degrees, compact geographic province groups, PIN-colored dashed connectors with matching dashed background halos. Photos remain screen-facing.


## Province placement follow-up

- Default layout now plans each province as a compact grid, trying several aspect ratios and balancing proximity to its projected geographic center against group size. Groups reserve rotated card footprints and avoid the enlarged map and other groups.
- Photo order and safe manually saved positions remain intact. Manual placement has priority over automatic clustering.
- All connectors keep the corresponding PIN color during normal display and hover/focus highlighting; existing background halos remain.
- New regression cases reproduce scattered interleaved province photos and verify compact non-interleaved groups plus matching west/east placement. Browser tests verify every connector, across provinces and themes, including active stroke color.
- Independent review found no important follow-up issues.

## Orientation correction

- CSS rotateX is now 58 degrees at overview, decreases during zoom-in and reaches 0 degrees at 220% zoom. A 0-degree plane is parallel to the screen; the previous increasing angle incorrectly foreshortened the map on zoom-in.
- The angle indicator now says 正视 at the parallel endpoint and 倾斜 otherwise. Geographic pins and connectors use the same corrected projection.
- Targeted tests passed (24), and browser fixtures confirmed the actual transform is parallel at 242%, including matching horizontal/vertical scale and zero Z rotation component. Intermediate pin alignment and dark/light/mobile coverage passed.
- Full regression: 254 tests passed initially; the bundle-performance test hit host memory exhaustion, then passed when rerun with a constrained child heap. Production build, independent bundle graph check and lint passed.

## Initial presentation and cold-load navigation

- Initial map angle reduced to a mild 20 degrees, still converging to screen-parallel at 220% zoom.
- Shared view-switch styles moved from deferred place-atlas.css into journal.css. The initial production dependency graph now verifies both desktop and mobile switch styles without loading atlas geography.
- Regression tests first reproduced the 58-degree initial map and missing initial CSS. Targeted geometry/UI tests (24), independent bundle checks, build and lint passed.
- Browser checks cover a full reload before ever opening the atlas, correct flex navigation on desktop/mobile, a 20-degree initial surface and a parallel enlarged surface. Dark/light20, dark80 and mobile20 cases passed; captured cold-load header and overview inspected visually.

