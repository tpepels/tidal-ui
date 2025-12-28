# State Ownership and Boundaries

This document defines the single source of truth for critical UI domains and the approved mutation paths.

## Playback

- **Source of truth**: `src/lib/stores/player.ts`
- **UI access**: Components should read from `playerStore` (or derived stores).
- **Mutations**: Use `src/lib/controllers/playbackTransitions.ts` for play/pause/seek/queue transitions.
- **Side effects**: Use controllers in `src/lib/controllers/` for media session, audio element, and track loading.

## Search

- **Source of truth**: `src/lib/stores/searchStoreAdapter.ts`
- **UI access**: Components should read from `searchStore`.
- **Mutations**: Use `searchStoreActions.commit()` for atomic updates; avoid piecemeal updates.

## Persistence

- **Playback**: Persisted in `src/lib/stores/player.ts` (queue, volume, position, replay metadata). Playback quality is sourced from user preferences, not player persistence.
- **User preferences**: Persisted in `src/lib/stores/userPreferences.ts` via `src/lib/utils/persistence.ts`.
- **Search**: Ephemeral by default; do not persist results or queries.
- **Load order**: User preferences load first; player store initializes quality from preferences.

## Invariants

- Playback: cannot be `isPlaying` and `isLoading` simultaneously; `queueIndex` must be valid.
- Search: `isLoading` must match `tabLoading`, and errors must clear loading.

## Forbidden Patterns

- Module-level singleton state for UI domains.
- Multiple sources of truth for the same domain.
- Ad-hoc updates that bypass transition controllers.
