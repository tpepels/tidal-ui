# UI Standardization Plan + Execution TODO

## 1) Standardized UX System Plan

### 1.1 Layout System
- Full-width workspace with consistent outer spacing (`app shell`, `sidebar`, `content`).
- One panel grammar for all operational pages: `header -> summary/meta -> actions -> content`.
- Shared page chrome across routes:
  - `ui-page`, `ui-page__header`, `ui-page__title-group`, `ui-page__actions`
  - `ui-tool-panel` for tools/status sections
  - `ui-surface-card`, `ui-link-card`, `ui-media-card`
- Responsive behavior:
  - Desktop: multi-column cards/grids
  - Tablet/mobile: single-column flow, no overlap, no hidden critical controls

### 1.2 Element System
- Typography:
  - Unified font stack
  - Larger baseline text for readability
  - Predictable scale for headings/subheadings/body/meta
- Controls:
  - One button/chip style family, consistent corner radius, border, and motion
  - Unified focus-visible outline across all interactive elements
  - Disabled state consistency (opacity/cursor/no-lift)
- Data surfaces:
  - Unified card/list/table row appearance (flat surfaces, subtle borders)
  - Monospace blocks only for logs/json/diagnostics
- Feedback:
  - Unified states for `loading`, `empty`, `error`, `success`
  - Toasts and inline status text aligned to same visual rhythm

### 1.3 Graphics System
- Visual direction: black/white minimal, low ornament, low glow.
- Backgrounds:
  - Prefer flat or very subtle gradients only
  - Remove decorative overlays/blobs unless functionally useful
- Shadows:
  - Default to none; use borders for separation
  - Only keep shadows where layering is necessary (e.g., fixed floating controls)
- Iconography:
  - Single icon weight/tone across page contexts
  - Avoid decorative color semantics; rely on structure/text first
- Media:
  - Consistent artwork framing, aspect ratio, placeholder style, loading behavior

### 1.4 Animation + Motion System
- Motion tokens:
  - Fast + medium durations
  - Standard + emphasis easing
  - Shared lift/press distances
- Interaction motion:
  - Hover lift: subtle and consistent
  - Press state reset: immediate and consistent
- Entry motion:
  - Staggered reveal for page/grid/card sections
  - No over-animated per-item effects
- Reduced motion:
  - All transforms/animation disabled or minimized
  - No shimmer/pulse required to understand state
  - Keep layout stable with no hidden content behind animation

### 1.5 Accessibility + Performance Rules
- Keyboard-first navigation and visible focus ring.
- Color contrast preserved in monochrome theme.
- Motion and blur should degrade cleanly in low/perf modes and reduced-motion mode.
- Avoid expensive backdrop/box-shadow effects by default.

## 2) Execution TODO (All User-Visible Elements)

Legend:
- `[x]` done
- `[~]` started/in progress
- `[ ]` pending

### Phase A: Core System
- [x] Global tokens for typography/radius/surfaces/motion in `app.css`
- [x] Unified focus-visible behavior and scrollbar treatment
- [x] Shared hover/press motion grammar for chips/buttons/cards/links
- [x] Global staggered reveals for page/grid/card sections
- [x] Reduced-motion global fallback for reveal/motion transforms

### Phase B: Shell + Navigation
- [x] `src/routes/+layout.svelte` flattened background and shell surfaces
- [x] Sidebar/button motion standardized with shared motion tokens
- [x] Layout reduced-motion fallback (disable shell/nav transform effects)
- [ ] Mobile shell refinement pass (spacing + hit targets audit)

### Phase C: Operational Pages
- [x] `src/routes/settings/+page.svelte` + `SettingsPageContent.svelte` panel/typography cleanup
- [x] `src/routes/status/+page.svelte` + `StatusPageContent.svelte` panel readability cleanup
- [x] `src/routes/download-center/+page.svelte` + `DownloadManager.svelte` modernization pass
- [x] `src/routes/download-log/+page.svelte` + `DownloadLog.svelte` flatten/motion cleanup

### Phase D: Content Pages
- [x] `src/routes/+page.svelte` + `SearchInterface.svelte` flatten/motion cleanup
- [x] `src/lib/components/TrackList.svelte` list row/action standardization
- [x] `src/routes/album/[id]/+page.svelte` panel + typography + actions audit
- [x] `src/routes/artist/[id]/+page.svelte` panel + discography consistency audit
- [x] `src/routes/playlist/[id]/+page.svelte` panel/list consistency audit
- [x] `src/routes/track/[id]/+page.svelte` metadata/actions consistency audit
- [x] `src/routes/history/+page.svelte` card/list consistency audit
- [x] `src/routes/library-suggestions/+page.svelte` panel/card consistency pass

### Phase E: Shared Components (Must Cover All Visible UI)
- [x] `AudioPlayer.svelte` flatten/motion/reduced-motion cleanup
- [x] `Breadcrumb.svelte` alignment with shared spacing/typography
- [x] `DiagnosticsOverlay.svelte` visual simplification + reduced motion
- [x] `ToastContainer.svelte` monochrome consistency
- [x] `DownloadProgress.svelte` flatten and motion consistency
- [x] `LyricsPopup.svelte` monochrome consistency baseline
- [x] `TopTracksGrid.svelte` card spacing/flat styling audit
- [x] `TrackDownloadButton.svelte` control consistency audit
- [x] `ShareButton.svelte` control consistency audit
- [x] `EntityMediaCard.svelte` shared card baseline
- [x] `PageState.svelte` state messaging baseline
- [x] `ApiTargetsStatusCard.svelte` operational panel baseline
- [x] `ToolNavGrid.svelte` nav-card consistency audit
- [x] `CoverArt.svelte` placeholder/loading consistency audit
- [x] `LazyImage.svelte` placeholder/loading consistency audit

### Phase F: Embed Pages
- [x] `src/routes/embed/album/[id]/+page.svelte` flatten + typography pass
- [x] `src/routes/embed/artist/[id]/+page.svelte` flatten + typography pass
- [x] `src/routes/embed/playlist/[id]/+page.svelte` flatten + typography pass
- [x] `src/routes/embed/track/[id]/+page.svelte` flatten + typography pass

### Phase G: Final QA
- [ ] Route-by-route visual sweep (desktop + mobile)
- [ ] Reduced-motion QA sweep (all interaction paths)
- [ ] Performance mode (`data-performance=low`) QA sweep
- [x] `npm run check -- --fail-on-warnings`
- [ ] Manual accessibility pass (focus order, keyboard, contrast)

## 3) Current Execution Focus (Started Now)
- Search + results surfaces
- Track rows/actions
- Audio player surfaces + reduced-motion handling
- Download log surfaces/actions
- Toast + breadcrumb control polish

## 4) Follow-up Unification
- Detailed next-pass TODO and execution tracking lives in:
  - `docs/UI_UNIFICATION_FURTHER_TODO.md`
