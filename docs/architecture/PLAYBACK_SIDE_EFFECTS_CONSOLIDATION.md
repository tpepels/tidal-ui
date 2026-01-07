# Playback Side Effects Consolidation (Phase 3)

## Goal
Move stream loading and fallback logic into machine-owned side effects so playback is deterministic and
not coupled to `AudioPlayer` component lifecycle.

## Current State
- `AudioPlayer.svelte` orchestrates:
  - track loading via `trackLoadController`
  - fallback paths via `playbackFallbackController`
  - dispatching `LOAD_COMPLETE`/`LOAD_ERROR` back into the machine
- The playback machine owns intent but depends on UI to complete transitions.

## Problems
- Loading lifecycle is split across machine + component, creating temporal coupling.
- Fallback logic runs outside the state machine, making transitions harder to reason about.
- Stale request handling uses multiple tokens (`loadRequestId` vs controller sequence).

## Proposed Architecture
1. Move stream loading into machine side effects:
   - Introduce a machine effect handler that owns track loading and fallback.
   - `LOAD_TRACK` transition emits a `LOAD_STREAM` side effect that does the actual load.
2. Collapse fallback into machine transitions:
   - Introduce explicit events: `FALLBACK_TO_LOSSLESS`, `FALLBACK_TO_STREAMING`.
   - The machine remains the single source of truth for retries and errors.
3. Unify request tokens:
   - Use `loadRequestId` as the single token; remove controller-level sequence.

## Implementation Steps
1. Extract `trackLoadController` + `playbackFallbackController` logic into a new machine effect handler.
2. Add side-effect handlers to `playbackMachineEffects` for:
   - stream load, manifest fetch, fallback decision
3. Remove `AudioPlayer`-level orchestration for loading/fallback.
4. Update tests:
   - machine transition tests for fallback events
   - effect handler integration tests

## Rollback Plan
Revert the effect-handler extraction commit and restore component-level orchestration if regressions appear.

