# Playback Single Source of Truth TODO

Status: in progress

## Goal
Make playbackMachine the single source of truth for playback state, with playerStore as a pure UI projection.

## Phase A: Quality Ownership (Gated)
- [x] Gate machine-owned quality sync behind `VITE_PLAYBACK_MACHINE_QUALITY_SOT`.
- [x] Sync playerStore quality changes into playbackMachine.
- [x] Verify quality change reloads through machine when a track is loaded.
- [x] Expand tests to cover quality sync under gate.

### Test Strategy (Phase A)
- E2E: update `tidal-ui:user-preferences` and dispatch `storage` to force playerStore quality change,
  then assert machine `loadRequestId` increments and `quality` updates when gate is enabled.
- Unit: rely on playback machine transition tests for `CHANGE_QUALITY` effects (rune store not unit-testable).

## Phase B: Queue Ownership
- [x] Introduce `VITE_PLAYBACK_MACHINE_QUEUE_SOT` flag (queue sync now default-on).
- [x] Move queue mutation into playbackMachine context (SET_QUEUE event).
- [x] Update playbackFacade to mutate machine queue when flag enabled.
- [x] Add regression tests for queue index + next/previous behavior.
- [x] Add E2E queue index sync coverage under the gate.

### Test Strategy (Phase B)
- Unit: verify `SET_QUEUE` updates context; verify gated sync on next/previous in `playbackFacade`.
- E2E: verify machine `queueIndex` increments after clicking next with a 2-track result set.

## Phase C: Store Projection Cleanup
- [x] Remove direct playback flags from playerStore updates (use playbackFacade for play/pause/queue transitions).
- [x] Audit any residual store writes from UI components.
- [x] Route streaming URL + embed play toggles through playbackFacade.
- [x] Update migration docs and stabilization checklist.
