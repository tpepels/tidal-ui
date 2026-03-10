# UI Integration + Improvements TODO (2026-03-10)

## Scope
- Finish route-first UI integration so navigation pages are first-class and not mixed into layout conditionals.
- Improve observability UX for queue/status/maintenance operations.
- Standardize interaction patterns, accessibility, and responsive behavior across the app shell.

## Current Snapshot
- Sidebar navigation exists and includes `Settings`, `Download Center`, `Download Log`, `Status`, and `History`.
- `Download Center` is now a real route (`/download-center`) and supports page mode.
- `Settings` and `Status` are route-owned pages and no longer render from layout conditionals.
- Status and target polling are route-owned to avoid global layout polling side-effects.

## TODO (High -> Low Priority)

## P0 - Route Ownership + Stability
- [x] Move `Settings` UI from `+layout.svelte` into `src/routes/settings/+page.svelte`.
  - Keep layout responsible only for global shell/nav/player/toasts.
  - Extract settings sections into smaller components (`SettingsStreaming`, `SettingsMaintenance`, `SettingsQueueActions`, etc.).

- [x] Move `Status` UI from `+layout.svelte` into `src/routes/status/+page.svelte`.
  - Keep diagnostics polling local to the status route.
  - Avoid any route-specific effects in layout.

- [x] Remove path-conditional page rendering from layout.
  - Delete `if ($page.url.pathname === '/settings' || '/status')` branches.
  - Render `{@render children?.()}` as the single page outlet.

- [x] Add a page integration regression test set.
  - Verify `/settings`, `/status`, `/download-center`, `/download-log`, `/history` render independently.
  - Verify no repeated background polling after route changes.
  - Implemented via: `tests/e2e/sidebar-routes.spec.ts` + route metadata/history regression tests.

## P1 - Download/Status UX Integration
- [x] Add a shared status card component used by both `/status` and `/settings`.
  - Include source (`static` vs `uptime`), last refresh, target count, and error state.

- [x] Add explicit page-level progress/status streams for maintenance operations.
  - Correction sweep, dedupe sweep, repair-all should show progress in one consistent UI pattern.
  - Keep updates visible in Download Log and in-page banners.

- [x] Add deep links between operational pages.
  - From Status -> Download Center, Download Log, Settings.
  - From Download Center -> related failed job diagnostics in Status.

- [x] Add a sticky operation summary strip in Download Center.
  - Running/Queued/Paused/Failed + backend mode + stale indicator.
  - Keep compact + desktop variants consistent.

## P2 - Navigation + Information Architecture
- [x] Add route metadata registry (title, subtitle, breadcrumb label, nav grouping).
  - Replace duplicated label/title literals across layout/pages.
  - Ensure page title + breadcrumb + sidebar names stay in sync.

- [x] Add keyboard-first sidebar navigation behavior.
  - Arrow key navigation, Enter activation, visible focus ring, `aria-current` verification.

- [x] Add recent context widgets to history page.
  - “Resume last album”, “Resume last artist”, and quick clear by type.

- [x] Add route-level loading/empty/error templates.
  - Standardize skeleton/empty/error visual language across album/artist/playlist/system pages.

## P3 - Visual + Interaction Consistency
- [x] Standardize component primitives used across all route pages.
  - Buttons, chips, sections, notices, cards, tables/lists, JSON blocks.
  - Remove one-off style drift in page-specific components.

- [x] Unify monochrome design tokens in one source.
  - Keep black/white theme strict and eliminate residual blue/yellow accents where not semantic.
  - Define semantic colors only for success/warning/error states.

- [x] Improve responsive behavior for operations pages.
  - Mobile-first layout pass for `/download-center`, `/status`, `/settings`, `/download-log`.
  - Keep action controls usable on <= 640px without hidden critical text.

- [x] Improve motion and transitions consistency.
  - Keep lightweight transitions only where state changes benefit clarity.
  - Remove jarring panel/page animation mismatches.

## P4 - Accessibility + Quality Gates
- [x] Run accessibility pass on all sidebar pages.
  - Landmarks, heading hierarchy, color contrast, screen-reader labels, live regions.

- [x] Add automated UI checks for critical routes.
  - Basic render test + navigation test + key controls for each page.
  - Implemented via: `tests/e2e/sidebar-routes.spec.ts`, `src/lib/config/routeMeta.test.ts`, `src/lib/stores/navigationHistory.test.ts`.

- [x] Add log/diagnostics copy UX hardening.
  - Confirm copy actions expose success/error feedback and preserve formatting.

- [x] Add a “UI smoke checklist” for release.
  - Route navigation, polling behavior, queue actions, mobile layout sanity.

## Definition of Done
- [x] Layout is shell-only (no page-specific bodies).
- [x] `/settings` and `/status` are fully owned by their route files.
- [x] Download Center, Download Log, Status, Settings, and History are all navigable as first-class pages.
- [x] No polling leaks when navigating between operational pages.
- [x] Accessibility and mobile checks pass for operational pages.

## Execution Order Recommendation
1. Route extraction (`Settings`, `Status`) and layout cleanup.
2. Shared status/progress components and deep-linking.
3. Navigation/metadata consolidation.
4. Visual consistency + responsive polish.
5. Accessibility and regression test hardening.
