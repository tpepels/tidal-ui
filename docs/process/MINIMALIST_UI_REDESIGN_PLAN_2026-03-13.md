# Minimalist UI Redesign Plan 2026-03-13

## Summary

The UI is more consistent than it was, but it is still not minimal in the Spotify/TIDAL sense.

The current system is still built around boxed primitives:

1. `ui-tool-panel`
2. `ui-action-panel`
3. `ui-media-card`
4. `ui-shell-surface`

Those are reusable, but they still create a "panel inside panel inside panel" experience. The result is structurally cleaner code with the wrong visual grammar.

This pass should not be another polish layer. It should be a design-system reset:

1. One flat app shell.
2. One dominant page canvas.
3. A small set of reusable section/list primitives.
4. Color used as accent, not as background fill.
5. Card grids used only when artwork is the primary content.

## Current Assessment

### Why the UI still does not feel minimal

1. The shell is still container-heavy.
   - `+layout.svelte` wraps both sidebar and main content in `ui-shell-surface`.
   - The app still reads like a framed dashboard rather than a media-first workspace.
2. The primitive set is reusable but visually over-specified.
   - `ui-tool-panel`, `ui-action-panel`, and `ui-media-card` all carry their own border, radius, background, hover, and tone logic.
   - This guarantees chrome accumulation.
3. Accent colors are applied to surfaces instead of state.
   - Secondary and tertiary tones currently tint full panels/cards.
   - Minimal interfaces use accent mostly for active state, emphasis, or metadata grouping.
4. Search and discography still default to card collections where rows would scan better.
   - Minimal music apps use cover-led rows/lists for most dense browsing tasks.
   - Grid cards should be the exception, not the default.
5. Section content is still too self-contained.
   - Each section looks like its own mini-app instead of part of one continuous page.
6. Motion and hover behavior still add presentation weight.
   - Hover lifts, hidden-on-hover links, and per-surface transitions make the interface feel busier than it should.

### Concrete examples in the current code

1. [src/app.css](/home/tom/Projects/tidal-ui/src/app.css)
   - `ui-tool-panel`, `ui-action-panel`, and `ui-media-card` all use raised boxed styling.
   - `data-tone='secondary'` and `data-tone='tertiary'` currently tint whole surfaces.
2. [ActionPanel.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/ActionPanel.svelte)
   - Useful structurally, but it currently implies a visible container, not just an action area.
3. [ToolPanel.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/ToolPanel.svelte)
   - Same issue: good API, too much visual ownership.
4. [EntityMediaCard.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/EntityMediaCard.svelte)
   - Still optimized around card presentation instead of adaptable row/tile presentation.
5. [SearchInterface.svelte](/home/tom/Projects/tidal-ui/src/lib/components/SearchInterface.svelte)
   - Improved structurally, but the result surface still reads as separate blocks rather than one layered search canvas.
6. [ArtistDiscographySection.svelte](/home/tom/Projects/tidal-ui/src/lib/components/artist/ArtistDiscographySection.svelte)
   - Functionally better, visually still too panelized.

## Design Goal

The target is not "more polished cards". The target is:

1. Flat.
2. Quiet.
3. Immediate.
4. Media-first.
5. Section-driven instead of card-driven.

The user should feel they are moving through one continuous music workspace, not opening nested modules.

## Framework Decision

### Recommendation

Do **not** adopt a full visual UI framework for this redesign.

### Why

1. The app already has a partial design system and many custom route-specific surfaces.
2. A full framework would introduce a second visual grammar and increase migration cost.
3. Most of the current problem is not lack of components. It is the styling and hierarchy encoded into the current components.

### Allowed external help

If we need framework help, use it only for headless accessible primitives:

1. dialog
2. dropdown/menu
3. select
4. popover
5. tooltip

That means a headless Svelte primitive library is acceptable. A full styled component kit is not the right move here.

### Default direction

Keep:

1. Svelte
2. Tailwind
3. existing custom component ownership

Refactor the visual system in-house so the UI stays coherent.

## Target Visual System

### 1. App Shell

The shell should become a flat two-layer system:

1. Navigation rail
2. Main canvas

Rules:

1. Remove the framed "dashboard shell" feel.
2. Sidebar should read as a rail, not a card.
3. Main area should read as the page canvas, not a floating panel.
4. Browser width should be used intentionally; no re-centering.

### 2. Surface Model

Reduce the whole app to only three visible surface behaviors:

1. `canvas`
   - the page background and main content flow
2. `section`
   - a lightweight content grouping with spacing and optional divider
3. `tile`
   - only for cover-led entities or compact summaries

What should disappear:

1. full-surface gradients on standard containers
2. multiple nested borders for one logical section
3. hover-lift on most structural elements
4. action blocks that look heavier than the content they control

### 3. Color Model

Primary look:

1. black
2. off-black
3. white
4. off-white

Accent colors:

1. secondary accent
2. tertiary accent

Accent usage must be narrow:

1. active tab / active selection
2. metadata category marker
3. inline badge or status
4. section keyline
5. focused control

Accent colors must **not** tint large default panels.

### 4. Typography

Typography should carry more hierarchy so containers can carry less.

Rules:

1. Bigger titles
2. clearer section headers
3. smaller, quieter metadata
4. fewer all-caps labels
5. fewer explanatory subtitles when the heading already says enough

Font direction:

1. Prefer a more refined grotesk/geometric family than the current fallback-heavy stack.
2. Keep only one primary UI typeface.
3. Use weight and spacing, not decorative styling, to create rhythm.

## Target Reusable Component Set

This redesign should converge on a smaller component grammar.

### Core page primitives

1. `AppShell`
   - rail + canvas only
2. `PageHeader`
   - title, context, primary action
3. `SectionNav`
   - already present, visually simplified
4. `SectionBlock`
   - spacing/divider wrapper, not a visible card by default
5. `InlineActionBar`
   - compact action row without panel chrome
6. `MetaStrip`
   - compact metadata facts in one line or dense strip
7. `StateNotice`
   - inline loading/empty/error/success treatment

### Content primitives

1. `MediaRow`
   - default entity presentation for search, discography, history, recommendations
2. `MediaTile`
   - used only where artwork-first browsing matters
3. `MediaList`
   - dense vertical list using `MediaRow`
4. `ResultColumns`
   - clean multi-column search layout with shared rules
5. `StatRow`
   - operational and status summaries

### Control primitives

1. `PrimaryButton`
2. `SecondaryButton`
3. `TextButton`
4. `SegmentedControl`
5. `FilterChip`
6. `SelectField`
7. `SearchField`

### Components to deprecate or visually hollow out

1. `ActionPanel`
   - keep API, reduce to spacing wrapper unless explicitly elevated
2. `ToolPanel`
   - keep API, reduce to section wrapper
3. `EntityMediaCard`
   - split into `MediaRow` and `MediaTile`; stop forcing all entities into a card model

## Layout Rules

### Global rules

1. One page should usually have one dominant canvas.
2. A section should be separated by spacing and alignment first, border second.
3. Only one strong container per viewport zone.
4. If two adjacent blocks both need borders/backgrounds, the design is probably wrong.

### Search

Search should move closest to a true streaming-app model.

Rules:

1. Search bar and filters stay compact and fixed near the top.
2. Results appear in one shared canvas.
3. Albums, artists, tracks, playlists are distinct sections inside that canvas.
4. On wide screens, two-column split is fine, but it must still feel like one surface.
5. Default result presentation should be rows, not boxed cards.

### Artist / Discography

Rules:

1. Artist identity stays visible.
2. Discography is the main event.
3. Recommendations and secondary metadata are quieter and smaller.
4. Release browsing should move toward row/tile hybrid presentation:
   - row by default for dense scan
   - tile only when visual browsing is the point

### Album

Rules:

1. Cover, title, artist, year, track count, and primary actions should be visible immediately.
2. MusicBrainz data should be present but quiet.
3. Track list should dominate the page, not boxed metadata.
4. Download/library state must be obvious without adding another heavy panel.

### Operational pages

Rules:

1. Key numbers first
2. controls second
3. logs/details third

Operational pages should not look like debug dashboards. They should look like clean control screens.

## Motion Rules

The current UI still has too much per-surface motion.

Target:

1. keep page/section reveal
2. keep clear focus states
3. remove most hover lift from structural blocks
4. remove hidden-on-hover controls for critical actions
5. keep transitions short and nearly invisible

Minimal motion should support orientation, not personality.

## Execution TODO

### Phase 1: Token and Surface Reset

- [x] Flatten the shell:
  - reduce or remove `ui-shell-surface`
  - make sidebar a rail
  - make main content a true canvas
- [x] Replace gradient/tinted container backgrounds with flat surfaces.
- [x] Reassign accent colors to state, not panel backgrounds.
- [x] Reduce box-shadow and hover-lift to near-zero.
- [x] Tighten typography scale and remove redundant uppercase labels.

### Phase 2: Primitive Reset

- [x] Introduce or refactor shared section/list primitives:
  - `SectionBlock`
  - flat list/row surface grammar for dense media browsing
- [x] Keep `ActionPanel` and `ToolPanel` only as compatibility wrappers during migration.
- [ ] Split `EntityMediaCard` into row/tile variants and stop using it as the default for everything.

### Phase 3: Search First

- [x] Rebuild `Browse & Search` as the reference implementation of the new grammar.
- [x] Replace most album/artist/track/playlist cards with rows.
- [x] Keep artwork visible, but make information density cleaner.
- [x] Make result sections read like one continuous search page.

### Phase 4: Detail Pages

- [ ] Migrate `artist`, `album`, `track`, and `playlist` to the new flat section model.
- [ ] Collapse secondary panels into quieter side rails or inline strips.
- [ ] Make metadata informational, not dominant.

### Phase 5: Operational Pages

- [ ] Rework `settings`, `status`, `download-center`, and `download-log` with the same grammar.
- [ ] Remove debug-dashboard framing.
- [ ] Use summary rows and simple section dividers.

### Phase 6: Cleanup

- [ ] Delete or hollow out legacy visual classes no longer needed.
- [ ] Remove route-specific one-off panel styles.
- [ ] Update docs so the minimal grammar becomes the enforced default.

## Migration Order

Recommended order:

1. app shell + tokens
2. buttons / chips / section wrappers
3. search
4. artist + discography
5. album
6. track + playlist
7. settings / status / download center / download log
8. legacy CSS and component cleanup

## Acceptance Criteria

The redesign is successful when:

1. The app reads as one continuous dark workspace, not a dashboard of boxes.
2. Search, artist, and album pages are immediately scannable with less visible chrome.
3. Most browsing surfaces use rows/lists by default, not grids of boxed cards.
4. Accent colors are used for emphasis and state, not to paint entire containers.
5. Primary actions are obvious without heavy panels.
6. Legacy panel styling can be removed without breaking the UI.
7. The reusable component set is smaller than the current one, not larger.

## Recommended Immediate Next Slice

Completed first slice:

1. flatten the shell and core tokens in [src/app.css](/home/tom/Projects/tidal-ui/src/app.css)
2. visually hollow out [ActionPanel.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/ActionPanel.svelte) and [ToolPanel.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/ToolPanel.svelte)
3. introduce `MediaRow` and migrate search results away from default boxed cards

Implemented result so far:

1. Flattened the app shell in [src/routes/+layout.svelte](/home/tom/Projects/tidal-ui/src/routes/+layout.svelte) so the sidebar reads like a rail and the main area reads like a canvas.
2. Reworked core surface grammar in [src/app.css](/home/tom/Projects/tidal-ui/src/app.css):
   - flatter `ui-tool-panel`
   - flatter `ui-action-panel`
   - flatter `ui-surface-card`
   - flatter `ui-media-card`
   - flatter `ui-link-card`
   - reduced hover lift and chrome-heavy motion
3. Added [SectionBlock.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/SectionBlock.svelte) as a reusable section wrapper for the new minimal hierarchy.
4. Rebuilt `Browse & Search` around section headers and flat media rows:
   - [SearchInterface.svelte](/home/tom/Projects/tidal-ui/src/lib/components/SearchInterface.svelte)
   - [SearchToolbar.svelte](/home/tom/Projects/tidal-ui/src/lib/components/search/SearchToolbar.svelte)
   - [SearchAlbumsSection.svelte](/home/tom/Projects/tidal-ui/src/lib/components/search/SearchAlbumsSection.svelte)
   - [SearchArtistsSection.svelte](/home/tom/Projects/tidal-ui/src/lib/components/search/SearchArtistsSection.svelte)
   - [SearchTracksSection.svelte](/home/tom/Projects/tidal-ui/src/lib/components/search/SearchTracksSection.svelte)
   - [SearchPlaylistsSection.svelte](/home/tom/Projects/tidal-ui/src/lib/components/search/SearchPlaylistsSection.svelte)
5. Reworked artist discography from boxed album cards to flat release rows in [ArtistDiscographySection.svelte](/home/tom/Projects/tidal-ui/src/lib/components/artist/ArtistDiscographySection.svelte).
6. Migrated high-traffic detail pages to the same flatter hero/section grammar:
   - [AlbumPageContent.svelte](/home/tom/Projects/tidal-ui/src/lib/components/pages/AlbumPageContent.svelte)
   - [track/[id]/+page.svelte](/home/tom/Projects/tidal-ui/src/routes/track/[id]/+page.svelte)
   - [playlist/[id]/+page.svelte](/home/tom/Projects/tidal-ui/src/routes/playlist/[id]/+page.svelte)
   - [artist/[id]/+page.svelte](/home/tom/Projects/tidal-ui/src/routes/artist/[id]/+page.svelte)
7. Simplified [PageSectionNav.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ui/PageSectionNav.svelte), [TrackDownloadButton.svelte](/home/tom/Projects/tidal-ui/src/lib/components/TrackDownloadButton.svelte), and [ShareButton.svelte](/home/tom/Projects/tidal-ui/src/lib/components/ShareButton.svelte) to match the flatter system.

Next migration priority:

1. replace remaining card-first recommendation/highlight rails where dense rows would scan better
2. flatten `library-suggestions` and `history` overview cards into the same row/list grammar
3. finish operational route cleanup with the same flat section/divider model
