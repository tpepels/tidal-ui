# Stabilization Phase 2 Plan - Race Condition & State Management Fixes

**Status**: 🟡 Planning
**Priority**: Critical
**Estimated Effort**: 2-3 days
**Risk Level**: Medium (touches core flows)

---

## Executive Summary

Audit findings reveal **critical race conditions and state management issues** that make the system fragile:

1. **Search races**: Missing region in cache key + no request versioning = stale results
2. **Playback races**: Split ownership across component/store/controllers = non-deterministic behavior
3. **Download state drift**: Hidden timers/controllers not in store = ghost tasks
4. **Layer violations**: Services/orchestrators mutating UI stores directly
5. **Error handling chaos**: Alerts, console logs, inconsistent tracking

**Root Cause**: No single source of truth, distributed implicit state, temporal coupling.

---

## Critical Issues (Ranked by Impact)

### 🔴 **Critical #1: Playback State Split Ownership**

**Risk**: High blast radius - any store/component change can break playback
**Impact**: Silent failures, UI desyncs, load loops

**Evidence**:
- `AudioPlayer.svelte` lines 1, 62, 301, 333, 361, 438
- Multiple `$effect` blocks mutating `playerStore`
- Local state (`currentTrackId`, `loadSequence`) not in store
- Audio element state not tied to store invariants

**Symptom**: "Small changes produce non-local playback regressions"

---

### 🔴 **Critical #2: Search Race Conditions**

**Risk**: Users see wrong results for their query
**Impact**: Data integrity, user trust

**Evidence**:
- `searchService.ts` line 126: `searchKey = tab:query` (missing region!)
- `searchOrchestrator.ts` line 118: No request ID/version check
- Stale requests can overwrite newer results

**Symptom**: "Quick query changes or region switches render unrelated results"

**Fix Complexity**: Low (add region to key + request tokens)

---

### 🟡 **High #3: Download State Drift**

**Risk**: Ghost tasks, lost progress updates, countdown desyncs
**Impact**: User confusion, unreliable downloads

**Evidence**:
- `downloadUi.ts` lines 63, 64: Hidden `taskControllers`, `ffmpegCountdownTimer`
- `AudioPlayer.svelte` lines 66, 67: Local controllers not in store
- Invariants only throw in DEV (line 143)

**Symptom**: "Store snapshot doesn't describe runtime state"

---

### 🟡 **High #4: Layer Boundary Violations**

**Risk**: Changes cascade unpredictably across layers
**Impact**: Amplified regressions, hard to reason about

**Evidence**:
- `playbackControlService.ts` lines 9, 53, 81: Service mutates `playerStore`
- `searchOrchestrator.ts` lines 282, 286: Orchestrator mutates stores
- `downloadOrchestrator.ts` lines 18, 159: Direct store mutations

**Symptom**: "Business logic coupled to UI"

**Note**: This is somewhat by design (orchestrators call stores directly per Phase 1), but needs clearer boundaries.

---

### 🟢 **Medium #5: Error Handling Chaos**

**Risk**: Hard to diagnose failures
**Impact**: Poor DX, user frustration

**Evidence**:
- `AudioPlayer.svelte` line 324: `alert()` for errors
- `invariants.ts` line 31: Warnings only in prod
- Inconsistent error tracking

**Symptom**: "Failures noisy and hard to diagnose"

---

### 🟢 **Medium #6: Test False Confidence**

**Risk**: Breaks slip through
**Impact**: Delayed bug discovery

**Evidence**:
- `AudioPlayer.test.ts` lines 64, 133: Contract tests don't render
- State machine tests use test-only implementation

**Symptom**: "Real playback flows untested"

---

## Stabilization Roadmap

### **Phase 2a: Quick Wins (Low Risk, High Value)** - Day 1

#### ✅ Fix 1: Add Region to Search Cache Key
**File**: `src/lib/services/search/searchService.ts:126`
**Change**:
```typescript
// Before
const searchKey = `${tab}:${trimmedQuery.toLowerCase()}`;

// After
const searchKey = `${tab}:${trimmedQuery.toLowerCase()}:${region || 'auto'}`;
```
**Impact**: Fixes search result mismatches
**Risk**: Very low
**Testing**: Search same query in different regions

---

#### ✅ Fix 2: Add Request Tokens to Search
**Files**: `searchService.ts`, `searchOrchestrator.ts`
**Approach**:
```typescript
// searchOrchestrator.ts
private currentSearchToken = 0;

async search(query: string, tab: SearchTab, options) {
  const requestToken = ++this.currentSearchToken;

  const result = await searchService.executeTabSearch(query, tab, options.region);

  // Ignore if superseded
  if (requestToken !== this.currentSearchToken) {
    console.log('[Search] Ignoring stale request', { requestToken, current: this.currentSearchToken });
    return;
  }

  // Commit to store
  searchStoreActions.commit({ results: result.data, ... });
}
```
**Impact**: Prevents stale results from overwriting
**Risk**: Low
**Testing**: Rapid query changes, region switches

---

#### ✅ Fix 3: Centralize Error Reporting
**Files**: `AudioPlayer.svelte`, `SearchInterface.svelte`, others using `alert()`
**Approach**:
```typescript
// Before
alert('Failed to download track');

// After
toasts.error('Failed to download track');
errorTracker.trackError('DOWNLOAD_FAILED', error);
```
**Impact**: Consistent error UX, better tracking
**Risk**: Very low
**Testing**: Trigger errors, verify toasts appear

---

### **Phase 2b: Medium-Term Refactors (Higher Risk)** - Days 2-3

#### ⚠️ Refactor 1: Playback Request Tokens
**Files**: `AudioPlayer.svelte`, `playerStore.ts`
**Approach**:
1. Add `loadRequestId` to component state
2. Increment on track/quality change
3. Check token before setting `streamUrl`
4. Ignore stale load completions

**Goal**: Prevent race between quality changes and track loads
**Risk**: Medium (touches core flow)
**Testing**: Rapid track/quality switches

---

#### ⚠️ Refactor 2: Move Download Timers to Store
**Files**: `downloadUi.ts`, `AudioPlayer.svelte`
**Approach**:
1. Move `ffmpegCountdownTimer` and `taskControllers` into store state
2. Export store-managed `cancelTask()` and `clearCountdown()` methods
3. Remove component-local controller management

**Goal**: Single source of truth for download state
**Risk**: Medium (affects download UI)
**Testing**: Downloads, cancellations, countdown behavior

---

#### ⚠️ Refactor 3: Playback State Machine (Phase 3 candidate)
**Files**: Create `src/lib/machines/playbackMachine.ts`
**Approach**:
1. Extract playback state machine from AudioPlayer
2. Make states explicit: `idle`, `loading`, `ready`, `playing`, `paused`, `error`
3. Transitions triggered by intents, not direct mutations
4. Audio element effects driven by machine state

**Goal**: Deterministic playback, testable state transitions
**Risk**: High (major refactor)
**Timeline**: Phase 3 (after Phase 2a/2b stabilize)

---

## Do-Not-Touch Zones (Until Phase 2 Complete)

❌ **AudioPlayer `$effect` blocks** (lines 301, 333, 361)
   → Any edit risks load loops or silent failures
   → Fix search/download races first, then tackle playback

❌ **Download UI timer logic** (`downloadUi.ts` line 82)
   → Hidden state, easy to break
   → Move to store in Phase 2b

❌ **Playback service store mutations** (`playbackControlService.ts` line 9)
   → Layer violation, but changing breaks flow
   → Document as "known issue," refactor in Phase 3

---

## Acceptance Criteria (Phase 2a)

### Search Fixes
- [ ] Same query in different regions returns different results
- [ ] Rapid query typing doesn't show stale results
- [ ] Region switch during search shows correct results
- [ ] Search cache key includes region

### Request Token Implementation
- [ ] Search ignores stale completions (verified in console logs)
- [ ] Playback ignores stale stream URL loads (if implemented)
- [ ] No visual glitches from race conditions

### Error Reporting
- [ ] No `alert()` calls in production code (except edge cases)
- [ ] All user-facing errors use `toasts.error()`
- [ ] Error tracking captures error codes and context

### Regression Testing
- [ ] All existing tests pass
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: search, play, download

---

## Acceptance Criteria (Phase 2b)

### Download State
- [ ] Download cancellation works reliably
- [ ] FFmpeg countdown timer visible in store state
- [ ] No ghost tasks after cancellation
- [ ] Task controllers managed by store, not component

### Playback Stability
- [ ] Quality changes don't trigger load loops
- [ ] Track changes complete reliably
- [ ] Rapid track/quality switches handled gracefully
- [ ] Console shows ignored stale requests (if any)

---

## Testing Strategy

### Unit Tests (Add)
- `searchService.test.ts`: Test cache key includes region
- `searchOrchestrator.test.ts`: Test request token ignores stale results
- `downloadUi.test.ts`: Test timer/controller state management

### Integration Tests (Add)
- Search race scenario: Fire 3 queries rapidly, verify last wins
- Playback race scenario: Change quality mid-load, verify correct stream
- Download cancel scenario: Cancel task, verify cleanup

### Manual Test Plan
1. **Search Race**: Type "test", wait 100ms, type "artist", verify shows "artist" results
2. **Region Race**: Search "test" in US, switch to EU mid-flight, verify EU results
3. **Playback Race**: Play track, change quality twice quickly, verify plays
4. **Download Cancel**: Start download, cancel immediately, verify UI clears

---

## Migration Path

### Step 1: Phase 2a Quick Wins (Day 1)
```bash
# Create feature branch
git checkout -b stabilization-phase2-quick-wins

# Fix search cache key
# Fix search request tokens
# Fix error reporting

# Test thoroughly
npm run test
npm run build
# Manual testing

# Commit
git commit -m "fix: prevent search race conditions and centralize error reporting

- Add region to search cache key to prevent result mismatches
- Implement request tokens to ignore stale search results
- Replace alert() with toasts.error() for consistent UX
- Add error tracking for better diagnostics

Fixes: Critical #2 (Search Races), Medium #5 (Error Handling)"
```

### Step 2: Phase 2b Refactors (Days 2-3)
```bash
# Continue on same branch or new branch
git checkout -b stabilization-phase2-state-management

# Move download timers to store
# Add playback request tokens
# Test edge cases thoroughly

git commit -m "refactor: move hidden state to stores for determinism

- Move download task controllers and timers to downloadUi store
- Add playback load request tokens to prevent quality race
- Make all runtime state visible in store snapshots

Fixes: High #3 (Download State Drift), Critical #1 (partial)"
```

### Step 3: Documentation & Review
```bash
# Update architecture docs
# Add ADR (Architecture Decision Record) for token pattern
# Update PATTERNS_QUICK_REFERENCE.md

git commit -m "docs: document request token pattern and state ownership"
```

---

## Rollback Plan

If Phase 2a/2b introduces regressions:

1. **Immediate**: Revert commit, create hotfix branch
2. **Analyze**: Add repro test case, identify root cause
3. **Fix Forward**: Smaller incremental change with better testing

**Safety Net**: All changes are additive (tokens, keys) or replacements (alert → toast), not deletions, so rollback is low-risk.

---

## Success Metrics

### Pre-Phase 2
- Search race bugs: **Known issue** (audit confirmed)
- Download ghost tasks: **Occasional** (user reports)
- Error UX: **Inconsistent** (alerts + toasts + console)

### Post-Phase 2a
- Search race bugs: **0** (eliminated by tokens)
- Error UX: **Consistent** (toasts only)
- Regression count: **0** (all tests pass)

### Post-Phase 2b
- Download ghost tasks: **0** (state in store)
- Playback race bugs: **Reduced** (tokens mitigate)
- State visibility: **100%** (no hidden controllers)

---

## Next Steps After Phase 2

### Phase 3 (Future): Playback State Machine
- Extract AudioPlayer effects into explicit state machine
- Make playback transitions deterministic
- Full test coverage for playback flows
- **Estimated**: 3-5 days
- **Risk**: High (major refactor)

### Phase 4 (Future): Integration Tests
- Add Playwright tests for race scenarios
- Test search, playback, download flows end-to-end
- **Estimated**: 2-3 days

---

## Open Questions

1. **Playback orchestrator vs state machine?**
   → Decision: Start with request tokens (Phase 2b), evaluate state machine need (Phase 3)

2. **Should orchestrators stop mutating stores?**
   → Decision: No, that's the pattern from Phase 1. Document as "orchestrator → store" flow.

3. **Layer boundary rules?**
   → Decision: Services use callbacks, orchestrators call stores. Document in ARCHITECTURE.md.

4. **Test strategy for $effect blocks?**
   → Decision: Add integration tests in Phase 2b, consider Testing Library for Svelte 5.

---

## References

- **Audit**: Findings document (this plan derived from)
- **Phase 1**: Orchestrator implementation (completed)
- **ARCHITECTURE.md**: Current architecture (docs/architecture/)
- **ADR Template**: For documenting token pattern decision

---

**Plan Author**: Claude Sonnet 4.5
**Review Status**: ⏳ Awaiting user approval
**Last Updated**: 2026-01-03
