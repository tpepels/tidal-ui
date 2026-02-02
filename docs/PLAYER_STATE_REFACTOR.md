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

## Milestone 4: Consolidate to Single Source of Truth ⏸️ Deferred

**Goal**: Eliminate `playerStore` duplication; machine context IS the source of truth.

**Status**: Deferred as optional future enhancement. The core issues (artwork changing, "HIGH to HIGH" fallback) are fixed in Milestones 1-3. The current architecture:

- Machine is the source of truth for playback state (via `syncPlayerStoreFromMachine`)
- playerStore retains queue management, persistence, and volume control
- This separation works well and is lower risk than full consolidation

### Milestone 4 Tasks (if resumed)

- [ ] Analyze which playerStore fields can be derived from machine
- [ ] Create derived stores for UI (playerDerived.ts)
- [ ] Migrate queue operations to machine context
- [ ] Update components incrementally
- [ ] Preserve localStorage persistence for queue/volume

### Milestone 4 Acceptance Criteria

- [ ] Only one place defines `currentTrack`
- [ ] FSM state diagram matches runtime exactly
- [ ] All tests pass
- [ ] localStorage persistence still works

---

## Changelog

### 2026-02-02

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
