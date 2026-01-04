# Decision: Playback Queue Ownership

## Status
Accepted (2026-01-04)

## Decision
Keep queue ownership in `playerStore` for now. The playback machine remains focused on
playback state, stream loading, and fallback handling.

## Rationale
- Queue operations are used across many UI entry points (tracks, albums, playlists, embeds).
- Moving queue ownership into the machine would require a broad migration with high risk.
- Current stability goals are met with machine-driven play/pause/loading sync.

## Consequences
- UI components may continue to call queue mutations on `playerStore`.
- Future migration to machine-adjacent helpers should be planned and versioned.
