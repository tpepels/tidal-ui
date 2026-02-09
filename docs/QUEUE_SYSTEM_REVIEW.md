# Download Queue System - Comprehensive Review & Hardening Plan

## Current State Summary

The server-side download queue system consists of:
- **Queue Manager** (Redis-backed with memory fallback)
- **Background Worker** (processes jobs concurrently, max 4)
- **API Endpoints** (/api/download-queue, /api/download-queue/:jobId, /api/download-queue/stats)
- **Client Store** (serverQueue.svelte.ts, polls every 500ms)
- **UI Component** (DownloadManager.svelte, displays queue status)

## Critical Issues Found

### 🔴 CRITICAL

**1. No Job Timeout Mechanism**
- **Issue**: Worker has no timeout handling. If a network request hangs, job blocks forever
- **Impact**: Job stuck in 'processing' indefinitely, blocking MAX_CONCURRENT slot
- **Severity**: HIGH - Can exhaust all concurrent slots with hangs
- **Location**: `downloadQueueWorker.ts` - `downloadTrack()`, `processAlbumJob()`

**2. Race Condition: Processing Jobs Lost on Server Restart**
- **Issue**: `processingJobs` Set is in-memory, but Redis stores job status
- **Impact**: If server restarts during processing, jobs stuck in Redis with status='processing' forever
- **Severity**: HIGH - Silent job loss
- **Location**: `downloadQueueManager.ts` - `processingJobs` global + `dequeueJob()`

**3. Delete Operation Doesn't Actually Delete**
- **Issue**: DELETE endpoint marks job as failed rather than removing from queue
- **Impact**: Queue grows indefinitely, cleanup is random (1% chance) and only runs 24h+ old
- **Severity**: MEDIUM - Redis memory leak, degrades over time
- **Location**: `/routes/api/download-queue/[jobId]/+server.ts`

**4. No Queue Size Limits**
- **Issue**: POST /api/download-queue has no rate limiting or queue size check
- **Impact**: Malicious actor can queue millions of jobs, exhaust Redis memory
- **Severity**: MEDIUM - DoS vulnerability
- **Location**: `/routes/api/download-queue/+server.ts` - POST handler

**5. Worker Not Awaited in Loop**
- **Issue**: `processJob()` called without await - fire-and-forget pattern
- **Impact**: activeDownloads counter can exceed MAX_CONCURRENT, no error visibility
- **Severity**: MEDIUM - Violates concurrency guarantees
- **Location**: `downloadQueueWorker.ts` - `workerLoop()`

---

### 🟡 HIGH

**6. No Network Retry Logic**
- **Issue**: Single network failure fails entire job (or album)
- **Impact**: Transient network hiccup = permanent job failure
- **Severity**: HIGH - Poor resilience
- **Location**: `downloadQueueWorker.ts` - `downloadTrack()`, `processAlbumJob()`

**7. Album Failure Classification is Confusing**
- **Issue**: Album marked 'completed' even if some tracks failed
- **Impact**: User sees download "succeeded" but tracks are missing
- **Severity**: HIGH - UX confusion and silent data loss
- **Location**: `downloadQueueWorker.ts` - line 216-226

**8. No Disk Space Validation**
- **Issue**: Downloads proceed without checking available disk space
- **Impact**: Partial files left on disk, unclear failure mode
- **Severity**: MEDIUM - Data corruption risk
- **Location**: `/routes/api/internal/download-track/+server.ts` (external)

**9. Job Payload Validation is Minimal**
- **Issue**: No validation of quality enum, IDs not type-checked for valid ranges
- **Impact**: Invalid payloads accepted, cause cryptic failures
- **Severity**: MEDIUM - Poor error handling
- **Location**: `/routes/api/download-queue/+server.ts` - POST validation

**10. Processing Job Deletion Doesn't Cancel In-Flight Work**
- **Issue**: DELETE on processing job marks as failed but doesn't stop actual download
- **Impact**: Orphaned partial files on disk, potential data corruption
- **Severity**: MEDIUM - Wasted resources
- **Location**: `/routes/api/download-queue/[jobId]/+server.ts` - DELETE handler

---

### 🟠 MEDIUM

**11. No Exponential Backoff on API Errors**
- **Issue**: Immediate failure on 429/5xx, no backoff
- **Impact**: Don't cooperate with API rate limiting
- **Severity**: MEDIUM - Could get IP banned
- **Location**: `downloadQueueWorker.ts` - `downloadTrack()` fetch

**12. UI Polling Has No Error Recovery**
- **Issue**: Store doesn't handle polling failures gracefully
- **Impact**: Stale UI if network hiccup during polling
- **Severity**: LOW - UI inconsistency
- **Location**: `serverQueue.svelte.ts` - `poll()`

**13. No Structured Error Logging**
- **Issue**: Console.log/error without correlation IDs or structured format
- **Impact**: Hard to trace issues in production
- **Severity**: MEDIUM - Operability
- **Location**: Throughout queue manager and worker

**14. Worker Fire-and-Forget Pattern**
- **Issue**: Job errors only logged, not propagated
- **Impact**: Silent failures, no alerting possible
- **Severity**: MEDIUM - Observability gap
- **Location**: `downloadQueueWorker.ts` - `workerLoop()`

**15. Development Mode Hides Worker Issues**
- **Issue**: Worker disabled in dev (to avoid hot-reload conflicts)
- **Impact**: Can't easily test/debug worker behavior
- **Severity**: LOW - Developer experience
- **Location**: `hooks.server.ts`

---

## Missing Features

- No job retry mechanism (manual or automatic)
- No batch download operations (album as single logical unit)
- No progress granularity for albums (only aggregate %)
- No job cancellation (proper termination of in-flight work)
- No compression/archiving (still downloading individual files)
- No bandwidth throttling
- No user quota/limits
- No job persistence across restarts in certain failure modes

---

## Edge Cases Not Handled

1. **Worker crashes during download** → Job stuck processing forever
2. **Network timeout on track download** → Album marked failed immediately
3. **Disk fills during download** → Partial file left, unclear error
4. **Redis connection lost mid-operation** → Job state inconsistency
5. **Album with 500+ tracks** → Memory spike during fetch, slow processing
6. **Rapid delete/resubmit of same job** → Race conditions
7. **INTERNAL_API_URL unreachable** → Worker hangs/retries forever (no timeout)

---

## Hardening Plan

### Phase 1: Critical Stability Fixes (Do First)

**P1.1: Add Job Timeout ([downloadQueueWorker.ts](downloadQueueWorker.ts))**
- Add `timeout` parameter to fetch calls (30s default)
- If job in 'processing' state > 5 minutes, auto-mark failed with "timeout" error
- Mark timed-out jobs with specific error message for debugging

**P1.2: Fix Processing Job Recovery ([downloadQueueManager.ts](downloadQueueManager.ts))**
- On startup, scan Redis for jobs with status='processing'
- Reset them to 'queued' or 'failed' with "recovered from crash" message
- Remove in-memory `processingJobs` Set, use Redis as single source of truth

**P1.3: Proper Job Deletion ([routes/api/download-queue/[jobId]/+server.ts](routes/api/download-queue/[jobId]/+server.ts))**
- DELETE endpoint should remove from Redis immediately (not just mark failed)
- For processing jobs: mark as 'cancelled' before removal (for auditing)
- Add optional retention period (default: delete immediately)

**P1.4: Await Job Processing ([downloadQueueWorker.ts](downloadQueueWorker.ts))**
- Change `processJob(job).catch()` to proper async handling
- Use semaphore/queue to ensure activeDownloads ≤ MAX_CONCURRENT
- Track errors without swallowing them

---

### Phase 2: Resilience Improvements

**P2.1: Network Retry Logic ([downloadQueueWorker.ts](downloadQueueWorker.ts))**
- Add retry wrapper with exponential backoff: 1s, 2s, 5s, 10s (max 3 retries)
- Retry on timeout, 429, 5xx only (not 4xx client errors)
- Track retry count in job object for observability

**P2.2: Album Track Failure Handling ([downloadQueueWorker.ts](downloadQueueWorker.ts))**
- Track failed track IDs separately
- Only mark album 'failed' if ALL tracks failed
- For partial failures: completed with error message listing failed tracks
- Store failed track details for manual retry

**P2.3: Fetch Timeout Wrapper ([downloadQueueWorker.ts](downloadQueueWorker.ts))**
```typescript
async function fetchWithTimeout(url, options, timeoutMs = 30000)
```
- Wrapper for all fetch calls with AbortController
- Single source of truth for timeout configuration

---

### Phase 3: Data Validation & Safety

**P3.1: Comprehensive Job Validation ([routes/api/download-queue/+server.ts](routes/api/download-queue/+server.ts))**
- Whitelist quality values: 'LOW', 'HIGH', 'LOSSLESS'
- Validate trackId/albumId are positive integers < 2^31
- Add max queue size check (e.g., 1000 jobs per user IP)
- Add rate limiting: max 10 jobs per 60s per IP

**P3.2: Job Payload Size Limit**
- Set max JSON payload size (e.g., 1KB)
- Reject suspiciously large requests

**P3.3: Disk Space Check (if downloadable)**
- Before job starts: check available disk space
- Fail with clear error if < 100MB free (configurable)

---

### Phase 4: Observability & Monitoring

**P4.1: Structured Logging**
- Add correlation ID to every job (already in jobId)
- Log format: `[Queue] [jobId] [level] [context] message`
- Include timestamps, error stacks

**P4.2: Error Aggregation**
- Collect failed job count + types
- Expose via /api/download-queue/health endpoint
- Track worker health: uptime, jobs processed, error rate

**P4.3: Metrics Export**
- Jobs queued/completed/failed (counters)
- Download duration (histogram)
- Concurrent download count (gauge)
- Queue age (max time in queue)

---

### Phase 5: Operational Safety

**P5.1: Cleanup Mechanism Hardening ([downloadQueueManager.ts](downloadQueueManager.ts))**
- Change random cleanup to scheduled: cleanup every 1 hour
- Make retention period configurable (default: 24h for completed, 7d for failed)
- Log cleanup count for monitoring

**P5.2: Queue Size Monitoring**
- Warn if queue > 100 jobs
- Critical if queue > 500 jobs
- Implement backpressure: reject new jobs if > 500 in queue

**P5.3: Worker Health Heartbeat**
- Worker writes timestamp every minute to Redis
- API checks: if heartbeat missing > 2min, worker is dead
- Return error from GET /api/download-queue/stats if worker unhealthy

---

## Implementation Priority

```
Week 1: P1.1, P1.2, P1.3, P1.4 (Critical stability)
Week 2: P2.1, P2.2, P2.3 (Resilience)
Week 3: P3.1, P3.2 (Validation)
Week 4: P4.1, P4.2 (Observability)
Then: P5.x (Operational polish)
```

---

## Testing Checklist for Each Fix

### P1.1 Timeout
- [ ] Job with network hang times out after 30s
- [ ] Timed-out job marked as failed with "timeout" error
- [ ] Can still process other jobs

### P1.2 Processing Job Recovery
- [ ] Start worker, submit album job
- [ ] Kill process mid-download
- [ ] Restart server
- [ ] Job automatically moved from processing back to queued
- [ ] Check Redis directly to verify state

### P1.3 Proper Deletion
- [ ] Delete queued job → removed from queue list
- [ ] Delete processing job → marked cancelled, removed after timeout
- [ ] Verify Redis doesn't accumulate garbage

### P1.4 Await Processing
- [ ] Submit 10 jobs, watch activeDownloads counter
- [ ] Confirm never exceeds 4
- [ ] Errors are logged and don't crash loop

### P2.1 Retry Logic
- [ ] Simulate flaky API (fails once, then succeeds)
- [ ] Job should retry and eventually succeed
- [ ] Check retry count in job details

### P2.2 Album Partial Failures
- [ ] Album with 5 tracks, 1 fails
- [ ] Job marked 'completed' with error message
- [ ] UI shows which track failed

### P3.1 Validation
- [ ] POST with invalid quality → 400
- [ ] POST with negative trackId → 400
- [ ] POST 11 jobs in 60s → 429
- [ ] Confirm normal jobs still work

### P4.1 Logging
- [ ] Grep logs for jobId, verify correlation across all messages
- [ ] Check timestamp consistency

### P5.1 Cleanup
- [ ] Mark job completed 25h ago
- [ ] Run cleanup
- [ ] Verify old job removed but new job kept

---

## Configuration Recommendations

```typescript
// .env or environment variables
QUEUE_JOB_TIMEOUT_MS=30000        // Timeout per fetch: 30s
QUEUE_PROCESSING_TIMEOUT_MS=300000 // Max time in processing: 5min
QUEUE_MAX_RETRIES=3
QUEUE_RETRY_BACKOFF_MS=1000
QUEUE_MAX_SIZE=1000
QUEUE_RATE_LIMIT_PER_MIN=10
QUEUE_CLEANUP_INTERVAL_MS=3600000 // Hourly
QUEUE_RETENTION_DAYS_SUCCESS=1    // Keep 1 day
QUEUE_RETENTION_DAYS_FAILED=7     // Keep 7 days for debugging
QUEUE_DISK_SPACE_MIN_MB=100
```

---

## Success Criteria

After hardening:
- ✅ No job losses on worker crash
- ✅ Jobs timeout cleanly after 5 minutes max
- ✅ Queue auto-cleans, stays < 100 jobs under normal load
- ✅ Failed jobs removable without orphaned files
- ✅ Transient network failures auto-retry
- ✅ Album failures only if ALL tracks fail
- ✅ Worker health observable via API
- ✅ All errors logged with correlation IDs
- ✅ Can debug production issues from logs
