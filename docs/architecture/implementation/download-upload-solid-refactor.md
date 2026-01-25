# Download/Upload SOLID Refactor Tracker

**Purpose:** Reduce remaining technical debt in download/upload flows by applying SOLID and port/adapter patterns without regressions.
**Scope:** Download orchestrator, execution paths, UI/log/notification ports, and Songlink conversion.

## Principles
- Keep behavior identical at each phase (compat first)
- Small, reversible diffs
- Tests + lint after every phase

## Phases
1) **UI port extraction** (complete)
   - Introduce `DownloadUiPort` and adapter
   - Orchestrator depends on port, not store

2) **Feedback ports** (complete)
   - Add log + notification ports
   - Remove direct store/toast/error-tracker dependencies

3) **Track resolver extraction** (complete)
   - Move Songlink conversion into `TrackResolver`
   - Orchestrator only coordinates notifications

4) **Execution port** (complete)
   - Wrap coordinator/server/client execution behind a port
   - Orchestrator depends on port, not concrete APIs

5) **Execution strategies** (complete)
   - Split client/server/coordinator into strategy modules
   - Add typed results + shared progress normalization

6) **Unified error mapping** (complete)
   - Apply error mapping to legacy path
   - Standardize error surface across strategies

7) **Orchestrator slimming** (pending)
   - Extract retry bookkeeping and progress wiring to helpers
   - Keep orchestrator as a small facade

8) **Upload hardening** (pending)
   - Isolate upload policy + conflict resolution strategies
   - Add integration tests around server-download workflow

## Verification Gate (each phase)
- `npm run lint`
- `npm run test:run`
