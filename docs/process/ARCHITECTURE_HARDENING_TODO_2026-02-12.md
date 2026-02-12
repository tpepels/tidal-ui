# Architecture Hardening TODO (2026-02-12)

Scope: resolve review findings that can cause real-world regressions in future releases.

## P0
- [x] Replace `onMount`-only loading in dynamic route pages with param-reactive loading and stale-request guards.
- [x] Restrict proxy circuit-breaker to upstream/network failures only.

## P1
- [x] Add bounded artist cache policy (entry cap, byte budget, LRU eviction).
- [x] Emit cache telemetry when storage persistence fails (especially quota conditions).
- [x] Introduce separate proxy image body-size cache threshold and wire it into cacheability checks.
- [x] Add regression tests for image-size cacheability above the old 200KB threshold.

## P2
- [x] Add cover-hydration request versioning to prevent stale async writes on artist navigation.
- [x] Add cover-hydration concurrency limiter to prevent burst fan-out.
- [x] Extract shared album scoring utility and remove duplicated scoring logic.

## Validation
- [x] `npm run lint`
- [x] `npm run test -- --run src/lib/server/proxyCache.test.ts src/lib/server/proxyFailureClassifier.test.ts src/lib/stores/artistCache.test.ts src/lib/utils/albumSelection.test.ts`
- [x] `npm run check`

## Notes
- `npm run check` reports one existing CSS compatibility warning in `src/lib/components/DownloadManager.svelte` (no type errors).
