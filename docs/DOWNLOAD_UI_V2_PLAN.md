# Download UI V2 Plan

Date: 2026-02-11  
Branch: `server-side-download-queue`

## Goals
- Make download status readable at a glance (what is running, queued, failed, completed).
- Reduce ambiguous states (explicit queue backend, last update time, and polling health).
- Improve interaction without changing queue semantics.
- Keep rollout reversible with small scoped commits.

## Non-Negotiable UX Invariants
- [ ] Queue state shown in UI must come from `GET /api/download-queue/stats` (`serverQueue` store).
- [ ] Queue source (`redis`/`memory`) must always be visible in the manager panel.
- [ ] Polling errors must be visible in-panel (not console-only).
- [ ] Completed summary must show both albums and files.
- [ ] No action in UI may mutate queue state silently; destructive actions require user intent.

## Stepwise Delivery Checklist

### Step 1 — Information hierarchy + readability
- [x] Add a top status strip with: running, queued, failed, queue source, last updated.
- [x] Increase panel readability (title/subtitle clarity, larger key values, cleaner section labels).
- [x] Keep current behavior unchanged (same polling/store wiring).
- Touch points:
- `src/lib/components/DownloadManager.svelte`
- Definition of done:
- Core states are understandable without expanding cards.
- Last update timestamp is visible.
- Existing queue interactions still work.
- Rollback:
- Revert `src/lib/components/DownloadManager.svelte`.

### Step 2 — Interaction improvements
- [x] Add section-level collapse/expand for Active/Queue/Failed.
- [x] Add quick filters for job types (`all`/`albums`/`tracks`) in queue and completed view.
- [x] Add visible empty-state CTA hints for how to enqueue downloads.
- Touch points:
- `src/lib/components/DownloadManager.svelte`
- Definition of done:
- Power users can scan large queues with fewer clicks.
- Rollback:
- Revert section/filter UI blocks only.

### Step 3 — Polling and resilience UX
- [x] Show "polling stale" state when `lastUpdated` is older than threshold.
- [x] Add retry countdown indicator for next poll cycle.
- [x] Surface backend warnings distinctly from transport errors.
- Touch points:
- `src/lib/stores/serverQueue.svelte.ts`
- `src/lib/components/DownloadManager.svelte`
- Definition of done:
- Users can distinguish stale UI vs worker failure vs Redis fallback.
- Rollback:
- Revert stale/retry indicator logic and restore previous polling view.

### Step 4 — Dense mode + mobile fit
- [x] Add compact row mode for smaller screens.
- [x] Improve tap targets and reduce overflow clipping on mobile.
- [x] Keep footer controls visible while scrolling.
- Touch points:
- `src/lib/components/DownloadManager.svelte`
- Definition of done:
- Manager is usable at <=640px without horizontal clipping.
- Rollback:
- Revert compact/mobile style blocks.

## Validation Gates (each step)
- [x] `npm run lint`
- [x] Manual smoke check (2026-02-11):
- [x] open panel with no jobs
- [x] enqueue one track and one album
- [x] verify active/queued/completed/failed counters
- [x] verify queue source and last updated are visible

## Progress Log
- [x] Plan file created
- [x] Step 1 implemented
- [x] Step 1 lint gate passed
- [x] Step 2 implemented
- [x] Step 2 lint gate passed
- [x] Step 3 implemented
- [x] Step 3 lint gate passed
- [x] Step 4 implemented
- [x] Step 4 lint gate passed
