# UI Further Unification TODO (Standard Elements Everywhere)

Goal: keep all user-visible screens on one shared element grammar that is clear, larger, flatter, and easier to scan.

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
