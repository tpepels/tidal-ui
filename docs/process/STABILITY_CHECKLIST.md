# Stability Checklist for Feature PRs

Use this checklist before shipping feature changes that touch core flows.

## State Ownership
- [ ] UI changes do not mutate playback state directly without documented ownership.
- [ ] Any new store state has a single source of truth.

## Determinism
- [ ] New async flows have cancellation or request token guards.
- [ ] UI updates are idempotent across rapid interactions.

## Error Handling
- [ ] Errors are surfaced via toasts/error tracker (no raw alerts).
- [ ] Error states are observable in logs or diagnostics.

## Testing
- [ ] Updated unit tests cover new invariants or transitions.
- [ ] Relevant Playwright flow(s) added or updated.

## Regression
- [ ] Run `npm run test:run` or targeted unit suite.
- [ ] Run `npm run test:e2e` when UI behavior changed.
