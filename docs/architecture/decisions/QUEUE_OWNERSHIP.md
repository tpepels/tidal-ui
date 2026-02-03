# Decision: Playback Queue Ownership

## Status
Superseded (2026-02-02)

## Decision
Queue ownership now lives in `playbackMachine` as part of the single source of truth.

## Rationale
- Queue operations are used across many UI entry points (tracks, albums, playlists, embeds).
- Migration completed with machine-first derived stores and queue coordinator helpers.

## Consequences
- UI components call queue mutations via playbackFacade/playbackQueueCoordinator.
- playbackMachine context is the canonical queue state.
