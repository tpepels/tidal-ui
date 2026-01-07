# Stability Checklist for Feature PRs

Use this checklist before shipping feature changes that touch core flows.

## State Ownership
- [ ] UI changes do not mutate playback state directly without documented ownership.
- [ ] Any new store state has a single source of truth.
- [ ] Playback intent goes through `playbackFacade` (no direct `playerStore.play/pause/next/previous/setQueue`).

## Determinism
- [ ] New async flows have cancellation or request token guards.
- [ ] UI updates are idempotent across rapid interactions.

## Error Handling
- [ ] Errors are surfaced via toasts/error tracker (no raw alerts).
- [ ] Error states are observable in logs or diagnostics.

## Testing
- [ ] Updated unit tests cover new invariants or transitions.
- [ ] Relevant Playwright flow(s) added or updated.
- [ ] E2E test hooks registry updated if new hooks were introduced.

## CI Guardrails
- [ ] Stabilization Playwright suite remains in CI (`npm run test:e2e:stabilization`).
- [ ] CI coverage changes are documented if suites are removed or replaced.

## Regression
- [ ] Run `npm run test:run` or targeted unit suite.
- [ ] Run `npm run test:e2e` when UI behavior changed.
- [ ] UI consistency rules reviewed (`docs/process/UI_CONSISTENCY_RULES.md`).
