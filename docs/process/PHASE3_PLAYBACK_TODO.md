# Phase 3 Playback State Machine Todo

Status: completed

## Goals
- Extract AudioPlayer effects into explicit state machine
- Make playback transitions deterministic
- Full test coverage for playback flows

## Work Breakdown

### Audit and Design
- [x] Inventory current playback ownership (AudioPlayer, playerStore, controllers, playbackMachine store).
- [x] Define machine contract and invariants (state, context, events, guards, side effects). (`docs/architecture/PLAYBACK_MACHINE_CONTRACT.md`)
- [x] Map legacy effects/controllers to machine events and side effects. (`docs/architecture/PLAYBACK_MACHINE_MIGRATION.md`)

### Migration (Incremental)
- [x] Wire AudioPlayer audio element events into playbackMachine (ready/playing/paused/waiting/error/end).
- [x] Route load/quality changes through playbackMachine actions.
- [x] Begin stream URL ownership in machine context (AudioPlayer now binds to machine streamUrl).
- [x] Collapse load/play/pause effects into machine side effects (remove duplicated $effect logic).
- [x] Replace direct playerStore mutations with machine-driven state updates (play/pause/loading/seek now routed through machine; queue/volume remain in playerStore).
- [x] Integrate fallback logic into machine (DASH/lossless/streaming).
- [x] Reduce AudioPlayer to view + event wiring only.

### Tests
- [x] Expand playbackMachine unit tests for guard behavior and side effects.
- [x] Add unit tests covering playbackMachine store side effects (load/play/pause/seek).
- [x] Add integration tests for rapid track/quality switches and fallback paths.
- [x] Add Playwright flow for playback stability (play/pause coverage in place; expand seek/quality/end later).

### Cleanup
- [x] Remove legacy $effect blocks once machine is authoritative.
- [x] Update docs/ADRs with machine contract and migration notes.
- [x] Re-run full regression suite and update stabilization plan.
