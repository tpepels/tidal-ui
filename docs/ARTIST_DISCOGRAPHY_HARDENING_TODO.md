# Artist Discography Hardening TODO

Date: 2026-02-11  
Scope: Artist page discography completeness, enrichment reliability, and debug transparency.

## Priority Order

### P0 — Correctness and determinism
- [x] Make enrichment passes deterministic and bounded (no unbounded query growth).
- [x] Keep strict artist-id filtering for enrichment additions.
- [x] Ensure dedupe/idempotency: reruns do not create duplicate albums.

Definition of done:
- Same artist input produces stable album set ordering and counts.
- Enrichment never adds albums for other artists.
- Enrichment query count stays within a fixed max budget.

### P1 — Hardening and diagnostics
- [x] Add per-pass diagnostics (URL search / artist-name search / title search).
- [x] Add clearer incompleteness reason classification using pass diagnostics.
- [x] Add guardrails for fallback pass triggering to avoid unnecessary load.

Definition of done:
- `discographyInfo` exposes enough data to debug why a page is incomplete.
- Warning reason explicitly states which pass produced the current signal.

### P2 — UI transparency
- [x] Show compact enrichment diagnostics in artist warning block.
- [x] Show when enrichment added albums beyond source payload.

Definition of done:
- User can tell if data came from source payload vs enrichment passes.

### P3 — Regression tests
- [x] Cover pass fallback behavior and query budget.
- [x] Cover artist-id filtering and idempotent merge behavior.
- [x] Cover diagnostics and warning reason text.

Definition of done:
- Tests fail if enrichment regresses into duplicate additions or wrong-artist additions.

## Execution Log
- [x] Plan/TODO created.
- [x] P0 implemented.
- [x] P1 implemented.
- [x] P2 implemented.
- [x] P3 tests implemented.
- [x] Validation gates passed (`vitest`, `lint`, `check`).
