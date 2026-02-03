# Playback Single Source of Truth TODO

Status: complete

## Goal
Make playbackMachine the single source of truth for playback state.

## Phase A: Quality Ownership
- [x] Sync user preferences quality into playbackMachine.
- [x] Verify quality change reloads through machine when a track is loaded.

### Test Strategy (Phase A)
- E2E: update `tidal-ui:user-preferences` and dispatch `storage` to force quality change,
  then assert machine `loadRequestId` increments and `quality` updates.
- Unit: rely on playback machine transition tests for `CHANGE_QUALITY` effects.

## Phase B: Queue Ownership
- [x] Move queue mutation into playbackMachine context (SET_QUEUE event).
- [x] Update playbackFacade to mutate machine queue (no gate required).
- [x] Add regression tests for queue index + next/previous behavior.
- [x] Add E2E queue index sync coverage under the gate.

### Test Strategy (Phase B)
- Unit: verify `SET_QUEUE` updates context; verify gated sync on next/previous in `playbackFacade`.
- E2E: verify machine `queueIndex` increments after clicking next with a 2-track result set.

## Phase C: Store Projection Cleanup
- [x] Remove direct playback flags from legacy store updates.
- [x] Audit any residual store writes from UI components.
- [x] Route streaming URL + embed play toggles through playbackFacade.
- [x] Update migration docs and stabilization checklist.
- [x] Persist queue/track state directly from playbackMachine.
- [x] Remove legacy store + sync contract entirely.
