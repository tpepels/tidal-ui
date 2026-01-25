# Download/Upload Tech-Debt Migration Tracker

**Purpose:** Track incremental refactors to reduce coupling and harden download/upload flows without regressions.
**Scope:** Download orchestration, server uploads, UI state store, and related helpers.

## Principles
- Preserve behavior at each step (compat layer + adapter pattern)
- Keep test coverage green after every phase
- Prefer pure helpers/reducers for predictability and testability

## Phases
1) **Domain interfaces + coordinator skeleton**
   - Add download domain interfaces/types and a minimal coordinator factory
   - No integration yet; compile-only additions

2) **Orchestrator helper extraction**
   - Move pure option-resolution and progress math into small modules
   - Add unit tests for helpers

3) **Upload service wrapper**
   - Route server uploads through a dedicated upload service
   - Keep existing API signature in `downloadTrackServerSide`

4) **Download state store split**
   - Introduce a pure download state module
   - `downloadUiStore` becomes a thin wrapper (compat layer)

5) **Download cache + session recovery**
   - Add a download cache module to persist terminal states
   - On startup, reconcile stale "running" entries to avoid stuck sessions
   - Wire cache updates from `downloadUiStore` with minimal side effects

6) **Download error mapping**
   - Add a pure error-mapping module for consistent user messaging
   - Cover network/storage/conversion/server/unknown cases with tests

7) **Download adapters + coordinator implementation**
   - Implement domain adapters for source/sink/transcoder using existing APIs
   - Build a coordinator that composes adapters (not wired yet)

8) **Coordinator toggle in orchestrator**
   - Add a feature-flagged path to use the coordinator
   - Keep existing behavior as default path; add toggle tests

9) **Error mapping integration**
   - Use error mapper in coordinator path to normalize UI errors
   - Keep legacy path unchanged; ensure parity tests

Status: Phases 1-9 complete.

## Verification Gate (after each phase)
- `npm run lint`
- `npm run test:run`

## Notes
- Regressions: roll back only the current phase, keep previous phases intact
- Keep migration diffs small; avoid cross-cutting refactors
