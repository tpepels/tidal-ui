# Player State Architecture Refactor

## Progress Tracking

### Overview

Refactoring the player state architecture to fix:

1. Artwork changing on navigation without playback
2. Fallback quality transition issues ("HIGH to HIGH")
3. Multiple write paths causing state inconsistency

---

## Milestone 1: Extract Browse State ✅ Complete

**Goal**: Create `browseState` store; migrate route-level selection state away from `playerStore`.

### Milestone 1 Tasks

- [x] Create `src/lib/stores/browseState.ts`
- [x] Update track page to not auto-play on navigation
- [x] Update album page to use browseState for display
- [x] Add tests for browse state isolation (21 tests)

### Milestone 1 Acceptance Criteria

- [x] Navigating to album page does NOT change player state
- [x] Artwork in AudioPlayer does NOT change on navigation
- [x] All existing tests pass (657 total)

---

## Milestone 2: Introduce AttemptId ✅ Complete

**Goal**: Every playback attempt gets a unique `attemptId`. All async handlers validate before mutating.

### Milestone 2 Tasks

- [x] Add `attemptId` to playback machine context
- [x] Generate new ID on LOAD_TRACK event
- [x] Generate new ID on FALLBACK_REQUESTED event
- [x] Generate new ID on PLAY from error state (retry)
- [x] Pass `attemptId` to side effects (CONVERT_SONGLINK, LOAD_STREAM, SET_AUDIO_SRC, HANDLE_AUDIO_ERROR)
- [x] Validate `attemptId` in PlaybackMachineSideEffectHandler
- [x] Add `isStaleAttempt()` helper for validation
- [x] Update tests to account for new attemptId field

### Milestone 2 Acceptance Criteria

- [x] Stale async events are ignored (validated via isStaleAttempt)
- [x] All 657 tests pass
- [x] attemptId included in observability logs

---

## Milestone 3: Unify Quality State ✅ Complete

**Goal**: Clear separation of `requestedQuality` vs `effectiveQuality`.

### Milestone 3 Tasks

- [x] Add `effectiveQuality` to machine context (null when not playing)
- [x] Update LOAD_COMPLETE to set `effectiveQuality` (not overwrite `quality`)
- [x] Update LOAD_TRACK, CHANGE_QUALITY, FALLBACK_REQUESTED to reset `effectiveQuality`
- [x] Expose `effectiveQuality` via playbackMachine getter
- [x] Add `effectiveQuality` to test hooks
- [x] Fixed FALLBACK_REQUESTED: no longer overwrites user's `quality` preference

### Milestone 3 Acceptance Criteria

- [x] `quality` = user preference (unchanged by fallback)
- [x] `effectiveQuality` = actual playback quality (set on LOAD_COMPLETE)
- [x] All 657 tests pass

---

## Milestone 4: Consolidate to Single Source of Truth ✅ Complete

**Goal**: Eliminate `playerStore` duplication; machine context IS the source of truth.

**Status**: Complete. Playback state is fully owned by the playbackMachine; there is no legacy store duplication.

### Milestone 4 Tasks

- [x] Analyze which legacy fields can be derived from machine
- [x] Create derived stores for UI (playerDerived.ts)
- [x] Replace polling with playbackMachine subscriptions
- [x] Sync queue mutations to playbackMachine by default
- [x] Move time/volume updates into playbackMachine context
- [x] Migrate AudioPlayer + embed UI to machine-derived playback state
- [x] Migrate LyricsPopup to machine-derived playback state
- [x] Migrate queue operations to machine context
- [x] Update components incrementally
- [x] Preserve localStorage persistence for queue/volume
- [x] Migrate stream metadata (sample rate/bit depth/replay gain) into machine context
- [x] Remove legacy playerStore + sync contract

### Milestone 4 Acceptance Criteria

- [x] Only one place defines `currentTrack`
- [x] FSM state diagram matches runtime exactly
- [x] All tests pass
- [x] localStorage persistence still works

---

## Changelog

### 2026-02-02

- Completed Milestone 4: Single Source of Truth
  - Added playbackMachine subscriptions to drive playerDerived stores without polling
  - Created initial machine-derived UI stores to enable incremental migrations
  - Migrated TrackList to machine-derived playback state
  - Synced queue updates to playbackMachine (no env gate required)
  - Routed time/volume updates through playbackMachine context + projection sync
  - Migrated AudioPlayer, embed routes, and LyricsPopup to machine-derived stores
  - Migrated +layout and album page playback reads to machine-derived stores
  - Moved queue/track persistence into playbackMachine and removed playerStore queue mutations
  - Removed legacy playerStore + sync plumbing (sample rate/bit depth/replay gain now machine-owned)
- Completed Milestone 3: Unify Quality State
  - Added `effectiveQuality` to PlaybackContext
  - Fixed FALLBACK_REQUESTED to not overwrite user's quality preference
  - Exposed effectiveQuality via playbackMachine getter
- Completed Milestone 2: AttemptId implementation
  - Added `attemptId` field to PlaybackContext
  - Updated transitions (LOAD_TRACK, FALLBACK_REQUESTED, PLAY from error) to generate new attemptId
  - Added attemptId to SideEffect types for async operations
  - Implemented `isStaleAttempt()` validation in effect handler
  - All 657 tests passing

### 2026-02-01

- Created refactor plan document
- Completed Milestone 1: Browse State extraction
