# User-Facing Usability Improvement Plan 2026-03-13

## Summary
The current UI is visually more unified than before, but major detail pages still hide important actions and metadata inside hero blocks. On long pages this creates two concrete usability problems:

1. Users lose orientation while scrolling because sections are not consistently jumpable.
2. Primary actions are hard to rediscover because they are buried in page-specific layouts instead of living in a stable place.

This pass focuses on structural usability, not another cosmetic redesign.

## Assessment

### Current friction
1. `album/[id]`, `artist/[id]`, `track/[id]`, and `playlist/[id]` mix hero, actions, and metadata into a single top block.
2. Long pages require manual scroll-searching to find tracks, discography, recommendations, or metadata again.
3. Primary actions are not persistent enough on desktop and compete with descriptive content inside the hero.
4. Section hierarchy is inconsistent across detail pages, which makes the app harder to learn.

### Usability target
1. Every detail page follows the same mental model:
   `Back -> Hero -> Section Nav -> Primary Actions -> Context Metadata -> Main Content -> Secondary Content`
2. Important sections are jumpable with one click.
3. Primary actions stay easy to reach on larger screens.
4. Structural improvements use shared primitives, not route-specific one-offs.

## Execution TODO

### Phase 1: Shared primitives
- [x] Define the route-level usability pass.
- [x] Add a shared `PageSectionNav` component for long pages.
- [x] Add sticky-mode support to `ActionPanel`.
- [x] Add shared anchor offset behavior so section links land cleanly.

### Phase 2: Detail page migration
- [x] Move album actions and MusicBrainz metadata out of the album hero.
- [x] Move artist actions and MusicBrainz metadata out of the artist hero.
- [x] Move track actions and MusicBrainz metadata out of the track hero.
- [x] Move playlist actions out of the playlist hero and standardize section order.

### Phase 3: Validation
- [x] Run `npm run -s check`.
- [x] Confirm new structure compiles across the migrated routes.
- [x] Update this document with the implementation result.

## Implemented result
This pass shipped the following user-facing usability changes:

1. Added a shared section jump rail for long detail pages.
2. Added sticky primary action support so core actions remain easy to find on larger screens.
3. Standardized the structure of `album`, `artist`, `track`, and `playlist` detail pages so actions and metadata are no longer embedded inside hero blocks.
4. Added stable section anchors for actions, metadata, main content, and secondary content zones.
5. Extended the same section-navigation pattern to key collection/tool surfaces:
   `history`, `library-suggestions`, `settings`, `status`, `download-log`, and `download-center`.

## Remaining backlog
1. Consider adding active-section deep-link persistence for back/forward restoration if long-form route usage keeps growing.
2. Evaluate whether `Browse & Search` should expose a higher-level results rail above the existing search-section anchors.

## Success criteria
1. Detail pages expose clear jump targets for the user-visible sections.
2. Primary actions are in a consistent post-hero position on all migrated detail pages.
3. No route-specific visual grammar is added; the pass stays inside the existing design system.
