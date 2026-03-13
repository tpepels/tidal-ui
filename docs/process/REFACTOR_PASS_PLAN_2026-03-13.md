# Refactor Pass Plan (2026-03-13)

## Why This Pass
Several files have crossed into "god-file" territory (mixed concerns, large state surfaces, high change risk).  
This plan breaks them into focused modules without changing user-facing behavior.

## Baseline Hotspots (Current)
- `src/lib/components/DownloadManager.svelte` — 3842 LOC
- `src/routes/artist/[id]/+page.svelte` — 2617 LOC
- `src/lib/api.ts` — 2396 LOC
- `src/routes/+layout.svelte` — 2179 LOC
- `src/lib/components/pages/SettingsPageContent.svelte` — 1927 LOC
- `src/lib/components/SearchInterface.svelte` — 1920 LOC
- `src/lib/components/AudioPlayer.svelte` — 1284 LOC
- `src/routes/album/[id]/+page.svelte` — 1175 LOC

## Progress Snapshot (2026-03-13)
- `src/lib/components/SearchInterface.svelte`: 1920 -> 599 LOC
- `src/routes/artist/[id]/+page.svelte`: 2617 -> 1198 LOC
- `src/routes/+layout.svelte`: 2179 -> 1030 LOC
- `src/lib/components/pages/SettingsPageContent.svelte`: 1927 -> 894 LOC
- `src/lib/components/DownloadManager.svelte`: 3842 -> 918 LOC
- `src/lib/components/AudioPlayer.svelte`: 1284 -> 986 LOC
- `src/lib/api.ts`: 2396 -> 3 LOC (facade only)
- `src/lib/apiClient.ts`: 2396 -> 1199 LOC

## Refactor Objectives
1. Reduce cognitive load by splitting files by responsibility (UI rendering vs orchestration vs IO).
2. Keep behavior stable (no product changes in this pass).
3. Improve testability with extracted pure helpers/controllers.
4. Reduce regression blast radius by enabling smaller diffs.

## Guardrails
1. No behavioral changes unless explicitly documented as bug fixes.
2. Each extraction step must pass `check`, `lint`, and targeted tests before next step.
3. Move code first, then clean up naming/structure; avoid "rewrite in place".
4. Prefer composables/controllers (`*.ts`) for side effects and state logic.

## Target Architecture Shape
1. **Page/Component shell** (`*.svelte`): layout + event wiring only.
2. **Feature controllers** (`src/lib/controllers/*`): async flows, polling, lifecycle effects.
3. **Pure domain helpers** (`src/lib/utils/*` or feature-local `helpers.ts`): scoring, normalization, matching.
4. **Presentational subcomponents** (`src/lib/components/...`): focused render units.

## Phase Plan

### Phase 1: Safety Net + Boundaries
- [x] Add "large-file contract" to CI docs (warning threshold: 1200 LOC route/component, 900 LOC helper).
- [ ] Add/expand focused tests around current behavior for top hotspots:
  - Search aggregation + album artist filtering + MusicBrainz match behavior.
  - Artist discography filtering/grouping + queue/polling transitions.
  - Layout maintenance actions and polling helpers.
- [x] Create feature folders for incremental extraction:
  - `src/lib/features/search/*`
  - `src/lib/features/artist/*`
  - `src/lib/features/settings/*`
- Exit criteria: tests covering current behavior exist before moving large blocks.

### Phase 2: Search Surface Decomposition (`SearchInterface.svelte`)
- [x] Extract search scope/query/url synchronization into `searchQueryController.ts`.
- [x] Extract album queue download state/polling/actions into `albumQueueController.ts`.
- [x] Extract MusicBrainz lookup pipeline into `albumMusicBrainzMatchController.ts`.
- [x] Split rendering into presentational components:
  - [x] `SearchToolbar.svelte`
  - [x] `SearchAlbumsSection.svelte`
  - [x] `SearchArtistsSection.svelte`
  - [x] `SearchTracksSection.svelte`
  - [x] `SearchPlaylistsSection.svelte`
- [x] Keep `SearchInterface.svelte` as composition shell.
- [x] Exit criteria: `SearchInterface.svelte` < 900 LOC with unchanged outputs.

### Phase 3: Artist Page Decomposition (`artist/[id]/+page.svelte`)
- [x] Extract discography shaping/filtering/scoring into `artistDiscographyModel.ts`.
- [x] Extract album cover hydration/recovery queue into `artistCoverHydrationController.ts`.
- [x] Extract album download + queue polling into `artistAlbumDownloadController.ts`.
- [x] Extract MusicBrainz artist lookup/defaulting into `artistMusicBrainzController.ts`.
- [x] Split secondary rails and panels into presentational components:
  - [x] `ArtistRecommendationsRail.svelte`
  - [x] `ArtistDiscographySection.svelte`
  - [x] `ArtistTopTracksSection.svelte`
- Exit criteria: route file < 1200 LOC and no direct polling maps/timers in page shell.

### Phase 4: Layout + Settings Split
- [x] Move maintenance/repair/dedupe workflows from `+layout.svelte` into:
  - [x] `settingsMaintenanceController.ts`
  - [x] `settingsQueueExportController.ts`
- [x] Consolidate polling lifecycle utilities (repair/dedupe/status) under `src/lib/features/settings/polling.ts`.
- [x] Keep `+layout.svelte` for app shell, navigation, global UI wiring only.
- [x] Split/decompose `SettingsPageContent.svelte` into feature modules (polling/controller/style module extraction).
- Exit criteria: `+layout.svelte` < 1300 LOC and `SettingsPageContent.svelte` < 900 LOC.

### Phase 5: Download + Player Focus
- [x] Break `DownloadManager.svelte` into:
  - [x] queue summary/panel component
  - [x] failed/completed reporting component
  - [x] action toolbar component
  - [x] controller for queue operations/logging (started via `model.ts`, `lifecycleTracker.ts`, `queueActions.ts`)
- [x] Break `AudioPlayer.svelte` into:
  - [x] transport controls
  - [x] queue panel
  - [x] overlays/download state
  - [x] playback lifecycle controller
- [x] Exit criteria: no single media UI component > 1000 LOC.

### Phase 6: API Layer Segmentation
- [ ] Split `src/lib/api.ts` into domain modules (catalog, playback, metadata, downloads, playlists).
- [x] Keep `api.ts` as typed facade/re-export layer for compatibility.
- [ ] Align with existing `src/lib/api/catalog.ts` pattern and remove duplicate helper logic.
- [x] Exit criteria: root `api.ts` < 700 LOC, consumers unchanged.
  - [x] Extracted `src/lib/api/coverDownload.ts`, `src/lib/api/metadataEmbedding.ts`, and `src/lib/api/trackBlob.ts` from `apiClient`.
  - [x] Extracted `src/lib/api/streamManifest.ts` and `src/lib/api/streamDownload.ts` from `apiClient`.
  - [x] Stream/download orchestration in `apiClient` reduced under 1200 LOC.

## Work Order (Recommended)
1. Phase 1 (safety net)
2. Phase 2 (Search)
3. Phase 3 (Artist)
4. Phase 4 (Layout/Settings)
5. Phase 5 (Download/Player)
6. Phase 6 (API split)

## Acceptance Criteria (Whole Pass)
1. No behavioral regressions on key routes (`/`, `/artist/[id]`, `/album/[id]`, `/library-suggestions`, `/settings`, `/download-center`).
2. Top 6 hotspot files each reduced by at least 35%.
3. Polling/timer side effects live in controllers, not mixed into large page templates.
4. New code follows shared UI primitives and existing token contract.

## Risks and Mitigations
1. **Risk:** Hidden coupling during extraction.  
   **Mitigation:** Move code with adapter wrappers first, then simplify.
2. **Risk:** Async race regressions (polling + request tokens).  
   **Mitigation:** Keep token semantics unchanged; add focused tests per extracted controller.
3. **Risk:** Long-lived branch drift.  
   **Mitigation:** Merge per phase in small PRs; do not batch all phases in one commit.

## First Execution TODO (Next Actionable Slice)
1. Create `src/lib/features/search/` with controller stubs.
2. Move album queue polling/actions out of `SearchInterface.svelte`.
3. Add tests for:
   - queue state transitions (`queued -> processing -> completed/failed/paused`)
   - cancellation/resume behavior
4. Keep markup unchanged while wiring controller API.
