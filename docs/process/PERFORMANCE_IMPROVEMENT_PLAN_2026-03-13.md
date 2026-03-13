# Performance Improvement Plan 2026-03-13

## Summary

There is still clear room to improve runtime performance.

The main current problem is not one expensive render. It is accumulated background work:

1. Multiple fixed-interval pollers continue running while the tab is hidden.
2. Queue/status refresh loops use constant timing instead of adaptive timing.
3. Cover prefetch is useful, but it is still more aggressive than necessary for hidden tabs and low-performance mode.

This pass focuses on reducing unnecessary work without changing core product behavior.

There is a second, separate runtime issue as well:

6. Large result surfaces still ask the browser to fully lay out, paint, and animate offscreen rows/cards.

## Audit Findings

### Highest-impact hotspots

1. `serverQueue` polls every 500ms continuously.
2. `StatusPageContent` refreshes diagnostics every 5s continuously.
3. `SettingsPageContent` refreshes API target state every 15s continuously.
4. `DownloadManager` refreshes queue-job details every 5s while open/page-mounted.
5. Cover prefetch runs immediately even when the document is hidden and does not currently adapt to low-performance mode.

### Design principle

Prefer adaptive background work over feature removal:

1. Keep data fresh while visible.
2. Pause or slow polling while hidden.
3. Keep image warming, but defer and shrink it when performance mode is low.

## Execution TODO

### Phase 1: Shared infra

- [x] Add a shared adaptive polling utility that supports:
  - visible interval
  - hidden interval or hidden pause
  - immediate refresh on resume
  - schedule metadata callback

### Phase 2: Polling convergence

- [x] Move `serverQueue` to adaptive polling.
- [x] Move status-page diagnostics polling to adaptive polling.
- [x] Move settings API target polling to adaptive polling.
- [x] Move download-manager job refresh polling to adaptive polling.
- [x] Reduce countdown-only timer frequency where sub-second precision is unnecessary.

### Phase 3: Background media work

- [x] Make cover prefetch skip hidden documents.
- [x] Make cover prefetch more conservative in low-performance mode.
- [x] Defer larger prefetch batches to idle time when possible.

### Phase 4: Validation

- [x] Run `npm run -s check`.
- [x] Add/update targeted tests for adaptive polling and cover prefetch behavior.

### Phase 5: Large-surface rendering

- [x] Add shared containment utilities for offscreen-heavy blocks, rows, cards, and log entries.
- [x] Apply containment to search results, media cards, history/recommendation sections, and download-log entries.
- [x] Cap stagger reveal on very large media grids so only the first visible set animates.
- [x] Add explicit windowing for the heaviest list surfaces instead of rendering full search/log lists at once.

## Implemented result

This pass shipped the following runtime optimizations:

1. Added shared adaptive polling infrastructure and applied it to the highest-churn background pollers.
2. Hidden tabs now pause or materially slow queue/status/settings polling instead of continuing at the foreground cadence.
3. Download-center countdown updates now run at 1s instead of 500ms and pause while hidden.
4. Cover prefetch now:
   - does nothing for hidden documents
   - uses a smaller budget in low-performance mode
   - yields to idle time for larger batches
5. Route-level album queue pollers now use the same adaptive hidden-tab behavior instead of raw fixed intervals.
6. Download log auto-scroll now only follows the tail when the user is already near the bottom and the document is visible.
7. Search rows, media cards, recommendation/history blocks, and log entries now use `content-visibility` containment when supported so offscreen content does not fully participate in layout/paint.
8. Large media grids no longer animate every card on initial mount; stagger reveal is capped to the first eight grid items.
9. Added shared explicit windowing via `WindowedList.svelte` and applied it to:
   - album search results
   - artist search results
   - track search results
   - playlist search results
   - download-log event stream
10. The log view now keeps tail-follow behavior while only mounting the visible slice plus overscan instead of the full entry set.

## Remaining follow-up

1. Measure whether search should progressively disclose sections under very large multi-scope result sets instead of rendering all sections immediately.
2. If browser traces still show spikes after windowing, profile image decode/network waterfalls separately from DOM cost.

## Success Criteria

1. Hidden tabs generate materially less polling traffic and timer churn.
2. Visible pages retain current behavior and freshness.
3. Cover prefetch still improves perceived loading, but no longer competes as aggressively with foreground work.
4. Large result/list surfaces perform materially less offscreen layout, paint, and entry-animation work.
