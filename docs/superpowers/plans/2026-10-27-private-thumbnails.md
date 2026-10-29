# Private thumbnails implementation plan

> Execute inline using test-driven-development. User approved the thumbnail proposal and requested implementation.

**Goal:** Small journal images use private 512px WebP thumbnails; explicit photo and print previews load the existing full display images.

**Architecture:** Add a fixed thumbnail variant to the existing authenticated upload URL. Generate derivatives on demand into a versioned, source-fingerprinted private cache. Shared JournalImage selects the variant; original URLs in data and backups stay unchanged.

**Stack:** Existing Express, Sharp, React, Vitest, Playwright; no new dependencies or schema changes.

## Constraints and review focus

- Every request authorizes ownership before cache access; private responses remain no-store.
- Strict filename validation, fixed output dimensions/format, bounded generation concurrency and queue, same-source request deduplication, atomic cache writes.
- Missing or failed thumbnails never trigger automatic full-image downloads.
- Source deletion removes derivatives; maintenance prunes orphan/stale derivatives. Derived files are reproducible and excluded from backups and user asset accounting.
- Public/demo/blob images retain their URLs. Printing uses full display images. Photo dimensions retain aspect ratios.

## Task 1: Backend derivative cache and lifecycle

- [x] Add failing tests for bounded output, unchanged source, cache reuse/deduplication, invalid and missing sources, authorization before cache hits, invalid variants and derivative removal.
- [x] Implement server/thumbnails.js, integrate authenticated media handling in server/app.js, and extend asset cleanup and maintenance.
- [x] Run backend unit tests and real private-image integration where available.

## Task 2: Shared image loading and preview

- [x] Add failing UI tests for private thumbnails by default, original requests only in explicit previews, failed thumbnail handling and progressive display.
- [x] Update JournalImage, PhotoViewer and print image consumers; preserve upload URLs and layouts.
- [x] Verify full tests, lint, production build and browser network requests before and after clicking preview.
- [x] Review changes and document cache lifecycle and operation.

## Completion evidence

- Full regression: 47 test files, 269 passed, zero failed or pending (test-results/thumbnail-suite.json).
- Real isolated-database API security suite: 15 passed, including unauthenticated/foreign-account thumbnail denial, owned WebP delivery and warm-cache ownership checks. Recovery drill passed.
- Production build, lint and whitespace checks passed.
- Browser network check: canvas and atlas request only 512px thumbnails; explicit preview fetches only the selected 2048px fixture original, and navigation fetches the next original on demand. Sample bytes550805 ->28060 (about95% reduction).
- Independent review identified a warm-cache overload/retry issue. Added failing regressions, allowed existing cache hits through the full generation queue, and implemented at most two thumbnail retries without original-image fallback. Tests passed.
- Implementation choices: thumbnail generation is limited to one decoder and64 pending jobs; input buffers are bounded to10MB to prevent Windows libvips file-handle retention; private no-store responses and authenticated ownership checks are retained. Print previews use full display images to preserve print quality.
- Thumbnail caches are excluded explicitly from system snapshots, with source images and strict directory/symlink checks preserved; backups recreate thumbnails on demand.

