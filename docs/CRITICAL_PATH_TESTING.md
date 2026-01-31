# Critical Path Testing Strategy

This document describes the testing strategy for hardening the codebase against regressions in playback and download/upload functionality.

## Overview

Two critical systems must always work regardless of other code changes:

1. **Playback System** - Audio playback, quality fallback, error handling
2. **Download/Upload System** - Chunked uploads, session management, error recovery

## Regression Tests Added

### Download/Upload Protection

**File:** `src/routes/api/download-track/chunk-error-handling.test.ts`

**Bug Prevented:** 500→404 session expiry bug

The chunk endpoint previously called `endUpload()` for ANY error, which deleted the session. This caused:
- First chunk failure: 500 error returned
- Retry attempt: 404 "session not found" because session was deleted

**Critical Test:** `should preserve session when error is recoverable`

```typescript
// The key assertion: recoverable errors should NOT delete the session
if (!recoverableError.recoverable) {
    endUpload(uploadId);
}
// Session should still exist for retry
expect(activeUploads.has(testUploadId)).toBe(true);
```

### Playback Protection

**Files:**
- `src/lib/controllers/playbackFallbackController.test.ts` - Fallback guard unit tests
- `src/lib/controllers/playbackInvariants.test.ts` - System invariant tests

**Bugs Prevented:**
1. Duplicate fallback attempts causing state machine corruption
2. AbortErrors being treated as real playback errors
3. Race conditions when rapidly switching tracks

**Critical Invariants Tested:**

1. **Maximum one fallback per track per error type**
   ```typescript
   // First error triggers fallback
   const result1 = controller.handleAudioError(mockEvent);
   expect(result1).not.toBeNull();

   // All subsequent errors ignored
   for (let i = 0; i < 10; i++) {
       expect(controller.handleAudioError(mockEvent)).toBeNull();
   }
   ```

2. **Track change resets fallback guards**
   ```typescript
   controller.resetForTrack(456);
   // New track can trigger fallback
   const result2 = controller.handleAudioError(mockEvent);
   expect(result2).not.toBeNull();
   ```

3. **onFallbackRequested called exactly once**
   ```typescript
   controller.handleAudioError(mockEvent);
   controller.handleAudioError(mockEvent);
   controller.handleAudioError(mockEvent);
   expect(options.onFallbackRequested).toHaveBeenCalledTimes(1);
   ```

## Running Critical Path Tests

```bash
# Run all critical path tests
npm test -- --run \
  src/routes/api/download-track/chunk-error-handling.test.ts \
  src/lib/controllers/playbackFallbackController.test.ts \
  src/lib/controllers/playbackInvariants.test.ts

# Run with coverage
npm test -- --run --coverage \
  src/routes/api/download-track/chunk-error-handling.test.ts \
  src/lib/controllers/playbackFallbackController.test.ts \
  src/lib/controllers/playbackInvariants.test.ts
```

## Adding New Tests

When making changes to playback or download systems:

1. **Before making changes:** Run critical path tests to establish baseline
2. **After making changes:** Run critical path tests to verify no regressions
3. **For new features:** Add tests that verify the new behavior doesn't break invariants

### Key Files to Watch

Changes to these files require extra care:

**Playback:**
- `src/lib/controllers/playbackFallbackController.ts` - Fallback guard logic
- `src/lib/stores/playbackMachineEffects.ts` - Side effect handling
- `src/lib/machines/playbackMachine.ts` - State machine transitions

**Download/Upload:**
- `src/routes/api/download-track/[uploadId]/chunk/+server.ts` - Chunk endpoint
- `src/routes/api/download-track/_shared.ts` - Session management
- `src/lib/server-upload/uploadService.ts` - Client-side upload logic

## Error Classification Rules

### Download Errors

| Error Type | Recoverable | Session Action |
|------------|-------------|----------------|
| Network timeout | Yes | Keep session |
| Connection reset | Yes | Keep session |
| Rate limited | Yes | Keep session |
| Disk full | No | Delete session |
| Permission denied | No | Delete session |

### Playback Errors

| Error Type | Fallback Triggered |
|------------|-------------------|
| MEDIA_ERR_ABORTED | Never |
| MEDIA_ERR_DECODE (lossless) | Once per track |
| MEDIA_ERR_SRC_NOT_SUPPORTED (lossless) | Once per track |
| Any error (streaming quality) | Never |
| AbortError from play() interrupt | Ignored |

## Test Count Summary

| Test File | Test Count | Purpose |
|-----------|------------|---------|
| chunk-error-handling.test.ts | 9 | Download session preservation |
| playbackFallbackController.test.ts | 7 | Fallback guard behavior |
| playbackInvariants.test.ts | 12 | System-wide invariants |
| **Total** | **28** | Critical path coverage |
