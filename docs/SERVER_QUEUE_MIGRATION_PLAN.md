# Server Queue Stabilization Plan (MAIN Invariants + Migration Steps)

Date: 2026-02-09  
Branch: `server-side-download-queue`

## Non‑Negotiable Invariants (Derived from MAIN)
- **Single authoritative finalize pipeline for server storage.** All server‑side files must be named, conflict‑checked, and finalized via the same logic used by `/api/download-track` (uses `buildServerFilename`, `resolveFileConflict`, `moveFile`, and `embedMetadataToFile`).  
  Sources: `src/routes/api/download-track/_shared.ts`, `src/routes/api/download-track/[uploadId]/chunk/+server.ts`, `src/lib/server/metadataEmbedder.ts`.
- **Atomic finalize for server files.** Files are written to temp and moved via `moveFile` (rename or copy+unlink). No direct write to final path.  
  Source: `src/routes/api/download-track/[uploadId]/chunk/+server.ts`.
- **Deterministic naming (track numbers + multi‑volume).** `buildServerFilename` is the only server naming function.  
  Source: `src/routes/api/download-track/_shared.ts`.
- **Server metadata embedding is authoritative.** For server storage, metadata embedding must happen on the server (ffmpeg), not in the browser.  
  Sources: `src/lib/api.ts` (skip metadata for server), `src/lib/server/metadataEmbedder.ts`.
- **Idempotent retries.** Retrying a job must not create duplicates or corrupt outputs; conflict resolution uses checksum when available.  
  Source: `src/routes/api/download-track/_shared.ts`.
- **Stable error vocabulary.** Server errors must be expressed via `ERROR_CODES` / `DownloadError` and queue categories.  
  Sources: `src/routes/api/download-track/_shared.ts`, `src/lib/server/downloadQueueManager.ts`.

## Migration Plan (Stepwise, Reversible, Tested)

- [x] **Step 0 — Golden invariants tests**  
  Add tests for naming, extension detection, conflict resolution, and atomic finalize behavior.  
  Files: `src/routes/api/download-track/_shared.test.ts`, existing integration tests in `src/routes/api/download-track/*`.

- [x] **Step 1 — Extract shared finalize pipeline**  
  Create `src/lib/server/download/finalizeTrack.ts` and route all `/api/download-track` finalization through it.  
  Files: `src/routes/api/download-track/+server.ts`, `src/routes/api/download-track/[uploadId]/chunk/+server.ts`.

- [x] **Step 2 — Queue worker uses the same finalize pipeline**  
  `serverDownloadAdapter` becomes fetch‑only; worker finalizes via `finalizeTrack`.  
  Files: `src/lib/server/download/serverDownloadAdapter.ts`, `src/lib/server/downloadQueueWorker.ts`.

- [x] **Step 3 — Enforce idempotency for retries**  
  Pass checksum into `resolveFileConflict`; ensure retries skip identical outputs.  
  Files: `src/lib/server/downloadQueueWorker.ts`, `src/lib/server/downloadQueueManager.ts`, `src/routes/api/download-track/_shared.ts`.

- [x] **Step 4 — Unify naming authority everywhere**  
  Remove legacy naming in `/api/download-track/[uploadId]` and `/api/download-check`.  
  Files: `src/routes/api/download-track/[uploadId]/+server.ts`, `src/routes/api/download-check/+server.ts`.

- [x] **Step 5 — Observability + CI gates**  
  Ensure queue path emits metrics and logging; gate merges on invariants tests.  
  Files: `src/lib/observability/downloadMetrics.ts`, `src/lib/server/observability.ts`, CI config.
