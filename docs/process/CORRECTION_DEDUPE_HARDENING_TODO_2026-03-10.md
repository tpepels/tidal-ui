# Correction + Dedupe Hardening TODO (2026-03-10)

## Sweep Summary (Current Implementation)
- `sweep-temporary` exists and removes stale `*.publishing-*` / `*.backup-*` folders.
- Dedupe exists with progress and completion report, and backup of loser files.
- UI has:
  - `Sweep stale publish/backup folders`
  - `Consolidate duplicate album files`
  - `Correction sweep + dedupe` (client-orchestrated chain)
- Worker startup also runs a transient sweep.

## Key Gaps Found
- No global maintenance lock across sweep/dedupe/correction/worker publish operations.
- Sweep can delete actively-used publish/backup folders (no age/active-job protection).
- Correction+sweep+dedupe chain is client-orchestrated only (not atomic server-side).
- Dedupe merge step uses `fs.rename` (no explicit EXDEV fallback in directory merge path).
- Reporting is improved but still lacks skipped/error categories and persisted run history.

## TODO (High -> Low Priority)

## P0 - Safety / Data Integrity
- [x] Add a shared maintenance lock for media-library mutations.
  - Scope: sweep, dedupe, correction+dedupe endpoint, and worker album publish.
  - Behavior: return `409` when another maintenance/publish run holds lock.
  - Implementation target: Redis lease key with heartbeat + timeout fallback.

- [x] Harden transient sweep to never delete active publish state.
  - Add minimum age guard (`MEDIA_LIBRARY_TRANSIENT_SWEEP_MIN_AGE_MS`, default e.g. 30m).
  - Parse job id from folder names and skip if job is `queued|processing|retry_scheduled`.
  - Add `skippedActive`, `skippedTooFresh` counters to sweep summary/report.

- [x] Add server-orchestrated endpoint: `POST /api/media-library/correct-and-deduplicate`.
  - Step 1: sweep-temporary.
  - Step 2: deduplicate.
  - Run under one lock and one run id.
  - Return one structured report with both phase results + duration.

## P1 - Reliability / Failure Handling
- [x] Harden dedupe merge moves with fallback-safe file move semantics.
  - Replace raw `fs.rename` in merge path with helper supporting EXDEV copy+unlink.
  - Continue-on-error per file, record failures, and finish run with warnings.

- [x] Add persisted maintenance run reports.
  - Write JSON reports to `data/media-maintenance/runs/<runId>.json`.
  - Include phase summaries, skipped paths, errors, and backup root.
  - Keep latest N reports via retention policy.

- [x] Expand dedupe/sweep reporting schema.
  - Add: `filesMoveErrors`, `backupErrors`, `albumsSkipped`, `runId`.
  - Add sample lists per action: moved, backed-up, skipped, failed.

## P2 - Matching / Accuracy
- [x] Add optional metadata-based fallback for track key extraction in dedupe.
  - Use embedded tags `discNo/trackNo` when filename key is missing.
  - Keep strict safety gate (do not dedupe when confidence is low).

- [x] Add sanity gate before deleting duplicate candidate.
  - Require winner to pass integrity; if all candidates are uncertain, do not remove.
  - Mark as `manual_review_required` in report.

## P3 - UX / Operability
- [x] Replace client-side chained correction flow with server status polling of new combined endpoint.
  - Show phase-level progress and current album/group.
  - Provide downloadable JSON report link when complete.

- [x] Add "dry-run then execute" workflow in UI.
  - First pass shows proposed actions count.
  - Second pass executes with explicit confirmation.

## Test Plan TODO
- [x] Sweep does not remove fresh publish/backup folders.
- [x] Sweep does not remove folders for active queue jobs.
- [x] Lock conflict returns `409` across concurrent maintenance operations.
- [x] Combined endpoint reports both phases correctly on partial failure.
- [x] Dedupe merge handles EXDEV path without aborting full run.
- [x] Persisted report retention works and does not leak disk.
