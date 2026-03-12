# UI Further Unification TODO (Standard Elements Everywhere)

Goal: keep all user-visible screens on one shared element grammar that is clear, larger, flatter, and easier to scan.

## Current GUI Assessment (Code-Based)
- Baseline unification is now strong on major operational pages (`settings`, `status`, `download-center`), with shared panel/card patterns in place.
- Remaining inconsistency is mostly in shared primitives and secondary UI:
  - Some shared components still used smaller typography than primary panels (notably API status + page state blocks).
  - Sidebar metadata/section labels were visually smaller than the new baseline.
  - Some operational sections still felt visually nested ("card in card in card"), especially in Download Center detail lists and Status metric/detail blocks.
  - Manual visual QA is still needed for edge-case spacing and interaction rhythm across breakpoints and reduced-motion mode.
- Risk level: low for functionality, medium for visual consistency polish.

## Standard Element Rules
- Surfaces: use shared panel/card primitives (`ui-tool-panel`, `ui-surface-card`, unified list cards).
- Controls: use real buttons/links/selects with consistent sizing and motion.
- Typography: avoid tiny meta text on primary workflows; keep hierarchy readable at a glance.
- Information order: show key status/identity/progress immediately; relegate low-priority detail.
- Motion: subtle and consistent; no hidden state behind animation.

## Execution TODO

### Phase 1: High-Impact Operational Declutter (Executed)
- [x] Download Center: keep Active/Queue/Needs Attention expanded in page mode for immediate visibility.
- [x] Download Center: unify queue and attention rows to summary-first cards.
- [x] Download Center: replace pseudo-button row actions with real `button` elements.
- [x] Download Center: increase row text size, action hit targets, and section readability.
- [x] Download Center: reduce repeated detail noise (type/quality duplication removed from expanded details).
- [x] Download Log: increase heading/action/content sizes and improve hierarchy for quick scanning.

### Phase 2: Remaining Standardization (Next)
- [x] Status page: convert raw diagnostic JSON emphasis to summary-first cards with optional detail disclosure.
- [x] Settings page: align all maintenance/action rows to one spacing + control-size rhythm.
- [x] Track-heavy grids/lists: finish card/list typography alignment to the same baseline sizes.
- [x] Mobile touch audit: guarantee primary controls meet clear hit-target sizing on all operational pages.
- [ ] Manual route sweep: desktop + mobile + reduced-motion verification on all major routes.
  - [x] Automated sidebar route pass (`tests/e2e/sidebar-routes.spec.ts`) is green after unification changes.
  - [ ] Visual/manual QA still required for final polish signoff.

### Phase 3: Shared Primitive Polish (In Progress)
- [x] Normalize `ApiTargetsStatusCard` typography + refresh control to standard chip/button rhythm.
- [x] Normalize `PageState` typography + action control sizing.
- [x] Raise sidebar secondary typography/chips to the current baseline readability target.
- [x] Lift secondary route typography (`history`, `library-suggestions`) to match the larger readability baseline.
- [x] Lift legacy detail-header/meta typography on `album` and `playlist` pages to the same baseline.
- [x] Remove remaining ultra-small labels in Download Center status chips/hero/top-strip metadata.

### Phase 4: De-Nesting Pass (In Progress)
- [x] Download Center page mode: flatten section/list surfaces to line-separated rows (remove repeated inner card chrome).
- [x] Status page: flatten metric/detail/error blocks and avoid card-in-card states for in-panel empties/loading.
- [x] Settings page: simplify inner control surfaces and add cleaner section dividers per block.
- [ ] Manual pass on remaining non-operational routes for nested-surface cleanup (`artist`, `album`, `playlist`, `search`).
