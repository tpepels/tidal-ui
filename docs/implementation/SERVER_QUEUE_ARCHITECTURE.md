# Server-Side Background Download Queue

## Overview

This branch implements a background download processing system that allows downloads to continue even after closing the browser or laptop. The system runs entirely on the server and persists its state in Redis (with in-memory fallback).

## Architecture

### Core Components

1. **Queue Manager** (`src/lib/server/downloadQueueManager.ts`)
   - Redis-backed job queue with in-memory fallback
   - Job types: `TrackJob` (single track) and `AlbumJob` (full album)
   - Job lifecycle: queued → processing → completed/failed
   - Automatic cleanup of old jobs (24h+ retention)
   - Queue statistics and monitoring

2. **Background Worker** (`src/lib/server/downloadQueueWorker.ts`)
   - Runs independently in server process
   - Polls queue for new jobs every 2 seconds
   - Processes up to 4 concurrent downloads
   - Handles track and album downloads
   - Automatic retries and error handling
   - Started automatically on server startup (production only)

3. **Internal Download API** (`src/routes/api/internal/download-track/+server.ts`)
   - Server-side track fetching and saving
   - Fetches from TIDAL via /api/tidal proxy
   - Handles metadata embedding and cover downloads
   - File conflict resolution (overwrite/skip/overwrite_if_different)
   - Direct filesystem writes

4. **Queue API Endpoints** (`src/routes/api/download-queue/`)
   - `POST /api/download-queue` - Submit new job
   - `GET /api/download-queue` - List all jobs
   - `GET /api/download-queue/:jobId` - Get job details
   - `DELETE /api/download-queue/:jobId` - Cancel/remove job
   - `GET /api/download-queue/stats` - Queue and worker statistics

## How It Works

### Submitting a Download

```typescript
// Submit a single track
POST /api/download-queue
{
  "job": {
    "type": "track",
    "trackId": 123456,
    "quality": "LOSSLESS",
    "albumTitle": "Optional Album Title",
    "artistName": "Optional Artist",
    "trackTitle": "Optional Track Name"
  }
}

// Submit an album
POST /api/download-queue
{
  "job": {
    "type": "album",
    "albumId": 789,
    "quality": "HI_RES_LOSSLESS",
    "artistName": "Optional Artist"
  }
}
```

### Processing Flow

1. **Job Submission**
   - Client submits job via `POST /api/download-queue`
   - Job added to Redis queue with 'queued' status
   - Returns job ID for tracking

2. **Background Processing**
   - Worker polls queue every 2 seconds
   - Dequeues next job and marks as 'processing'
   - For tracks: Calls `/api/internal/download-track`
   - For albums: Fetches track list, downloads each sequentially
   - Updates job progress in real-time

3. **Server-Side Download**
   - `/api/internal/download-track` fetches track metadata
   - Gets stream URL from TIDAL
   - Downloads audio stream directly on server
   - Saves to organized directory structure
   - Embeds metadata and downloads cover art
   - Returns success/failure status

4. **Completion**
   - Job marked as 'completed' or 'failed'
   - Progress set to 1.0 (100%)
   - Results persist for 24 hours
   - Automatic cleanup removes old jobs

### Monitoring

```bash
# Get queue statistics
curl http://localhost:5173/api/download-queue/stats

Response:
{
  "success": true,
  "queue": {
    "queued": 3,
    "processing": 1,
    "completed": 12,
    "failed": 0
  },
  "worker": {
    "running": true,
    "activeDownloads": 1,
    "maxConcurrent": 4
  }
}

# List all jobs
curl http://localhost:5173/api/download-queue

# Get specific job
curl http://localhost:5173/api/download-queue/job-1234567890-abc123
```

## Benefits

### vs. Client-Side Queue

**Old Approach (Client-Side):**
- Browser must stay open
- Downloads stop if laptop closes
- No persistence across sessions
- Limited to browser network/resources

**New Approach (Server-Side):**
- ✅ Downloads continue independently
- ✅ Close browser/laptop anytime
- ✅ Survives server restarts (Redis persistence)
- ✅ Better performance (server bandwidth)
- ✅ Queue shared across all clients
- ✅ Centralized monitoring
- ✅ Built-in retry logic

## Configuration

### Environment Variables

```bash
# Redis connection (optional, defaults to memory)
REDIS_URL=redis://localhost:6379
REDIS_DISABLED=false  # Set to 'true' to force memory storage

# Server port (used for internal API calls)
PORT=5173

# Download directory (from existing config)
TIDAL_DOWNLOADS=/path/to/downloads
```

### Worker Settings

Edit `downloadQueueWorker.ts` to adjust:
- `MAX_CONCURRENT = 4` - Max simultaneous downloads
- `POLL_INTERVAL_MS = 2000` - How often to check queue

### Job Retention

Edit `downloadQueueManager.ts`:
- `cleanupOldJobs()` - Currently removes jobs older than 24 hours

## Development vs. Production

### Development Mode
- Worker **disabled** to avoid conflicts with hot-reload
- Client-side queue still works for testing
- Can manually start worker for testing

### Production Mode
- Worker **automatically starts** on server launch
- Runs continuously in background
- Handles all server-side downloads

## Next Steps

### Integration with Client

To use the new server queue from the client:

```typescript
// Option 1: Update downloadOrchestrator.ts to submit jobs
async downloadAlbum(albumId: number, quality: AudioQuality) {
  const response = await fetch('/api/download-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job: {
        type: 'album',
        albumId,
        quality
      }
    })
  });
  const { jobId } = await response.json();
  return jobId;
}

// Option 2: Add UI toggle for "background download"
// Let users choose between immediate client download or background queue
```

### UI Enhancements

1. **Queue Status Panel**
   - Show all active jobs
   - Real-time progress updates
   - Cancel/retry buttons
   - Estimated time remaining

2. **Notification System**
   - Desktop notifications when jobs complete
   - Email notifications (optional)
   - Push notifications to mobile

3. **Download History**
   - View completed downloads
   - Filter by date/artist/album
   - Re-download failed items

## Testing

```bash
# Start server
npm run dev  # Worker disabled in dev mode
npm run build && npm run preview  # Worker enabled

# Submit test job
curl -X POST http://localhost:5173/api/download-queue \
  -H "Content-Type: application/json" \
  -d '{"job":{"type":"track","trackId":123,"quality":"LOSSLESS"}}'

# Check status
curl http://localhost:5173/api/download-queue

# Check worker stats
curl http://localhost:5173/api/download-queue/stats
```

## Rollback Plan

If issues arise:

```bash
git checkout main  # Switch back to main branch
npm run build      # Client-side queue still works
```

The new server-side queue is completely isolated on this branch and doesn't affect the existing client-side download flow.

## Files Created

- `src/lib/server/downloadQueueManager.ts` - Job queue management
- `src/lib/server/downloadQueueWorker.ts` - Background worker
- `src/routes/api/download-queue/+server.ts` - Job submission/listing
- `src/routes/api/download-queue/[jobId]/+server.ts` - Job details/cancellation
- `src/routes/api/download-queue/stats/+server.ts` - Statistics
- `src/routes/api/internal/download-track/+server.ts` - Server-side download handler

## Files Modified

- `src/hooks.server.ts` - Worker initialization on server startup
