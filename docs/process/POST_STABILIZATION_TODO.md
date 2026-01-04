# Post-Stabilization Refactor Todo

These items were identified in the stabilization sweep as remaining refactor targets.

## Playback Ownership
- [x] Decide whether queue ownership should move into machine-adjacent helpers. (`docs/architecture/decisions/QUEUE_OWNERSHIP.md`)
- [x] Consolidate `playbackTransitions` usage into a single ownership boundary (AudioPlayer remains the boundary).
- [x] Audit all `playerStore` mutations originating in UI components. (`docs/process/PLAYERSTORE_UI_MUTATION_AUDIT.md`)

## Legacy Cleanup
- [x] Plan deprecation window for legacy user preference migration. (Legacy path removed 2026-01-04.)
- [x] Remove legacy preference migration after deprecation window.
- [x] Review any “legacy domain” routing notes for continued necessity. (Kept with clarifying comment.)

## Contracts & Observability
- [x] Add a public, versioned list of allowed test hooks. (`docs/development/E2E_TEST_HOOKS.md`)
- [x] Add an explicit “stability checklist” for feature PRs. (`docs/process/STABILITY_CHECKLIST.md`)
