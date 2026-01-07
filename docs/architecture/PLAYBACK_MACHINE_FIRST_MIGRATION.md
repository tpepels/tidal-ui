# Playback Machine-First Migration

## Goal
Make the playback state machine the single source of truth for playback intent and state transitions.
All UI and orchestration should route playback actions through the machine, and the player store should
become a UI projection rather than an owner of playback logic.

## Target API Surface
Use a facade that owns all playback intent:

```ts
playbackFacade.loadQueue(tracks, startIndex);
playbackFacade.play();
playbackFacade.pause();
playbackFacade.toggle();
playbackFacade.seek(seconds);
playbackFacade.next();
playbackFacade.previous();
```

## Migration Steps
1. Add facade wrapper that:
   - Calls playbackMachine actions for intent.
   - Updates playerStore only for UI state that is not owned by the machine.
2. Switch low-risk components to use the facade (TrackList/TopTracksGrid).
3. Convert route-level play handlers to use the facade.
4. Remove store→machine sync path in AudioPlayer once facade coverage is in place.
5. Remove direct `playerStore.play/pause/setQueue` usage.
6. Consolidate loading + fallback side effects inside the playback machine.
7. AudioPlayer owns only UI callbacks and audio element wiring; no direct load/fallback controllers.
8. Gate queue sync (`VITE_PLAYBACK_MACHINE_QUEUE_SOT`) and dual-write from facade.
9. Route embed controls + streaming URL playback through the facade.
10. Route playbackTransitions play/pause/queue mutations through the facade.
11. Rollback: revert the removal commit if regressions appear.

## Invariants
- Playback intent originates only from the facade.
- Player store does not set playback flags outside machine sync.
- Machine-driven transitions own isPlaying/isLoading.
- Loading/fallback side effects are executed by the machine side-effect handler.
- Playback controls do not call `playerStore.play/pause/next/previous/setQueue` directly.
