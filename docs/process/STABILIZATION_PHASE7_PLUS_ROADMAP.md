# Stabilization Phase 7+ Roadmap

This roadmap captures optional post‑Phase 6 work to keep the system reliable and
reduce long‑term maintenance risk.

## Phase 7: Observability Hardening (1-2 days)
- Add structured error metrics for playback/search/download failures.
- Persist recent error summaries for support diagnostics.
- Add a simple health overlay for QA (toggle in DEV/E2E).

## Phase 8: Playback/Queue Cohesion (2-3 days)
- Move queue mutations into machine-adjacent helpers.
- Add deterministic queue transition tests (next/previous/shuffle).
- Remove remaining implicit assumptions in playerStore consumers.

## Phase 9: Performance/Resilience (2-4 days)
- Reduce large build chunks with explicit code-splitting.
- Add retry/backoff visibility for API operations.
- Introduce test fixtures for slow network and flaky API scenarios.
  - Manual chunking added for shaka/jszip/lucide to reduce bundle warnings.
  - Chunk warning limit raised to 900 KB to acknowledge the shaka-player chunk.
  - Build visualizer available with `VITE_VISUALIZE=true` (outputs `stats/client-stats.json`).
  - Shaka now loads from CDN at runtime to keep it out of the main bundle.

## Phase 10: Maintenance Pack (1-2 days)
- Document stable public test hooks and deprecations.
- Add a “stability checklist” for feature PRs.
- Confirm CI covers all stabilization suites by default.
  - CI currently runs `npm run test:e2e:stabilization` in `.github/workflows/ci.yml`; keep this coverage aligned with the registry.
