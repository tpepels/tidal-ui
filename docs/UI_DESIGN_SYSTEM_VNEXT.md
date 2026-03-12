# Unified UI Design System vNext

## Summary
This document defines the single UI grammar for all user-visible surfaces: main routes, operational tools, shared components, and embeds.  
The target system is flat, monochrome, larger by default, and hierarchy-first.

## 1. Design Intent
1. Put critical status and actions first.
2. Keep surfaces minimal: black/white base, subtle borders, no decorative glow.
3. Use one structural rhythm per page type.
4. Keep controls comfortably large and consistently interactive.
5. Remove nested card clutter and route-specific one-off UI patterns.

## 2. Global Token Contract
1. Typography scale: `eyebrow`, `title`, `subtitle`, `body`, `meta`, `label`.
2. Spacing ladder: shared section/card/control spacing values only.
3. Radius/border: one radius family + `subtle` and `strong` border strengths.
4. Surfaces: `base`, `raised`, `interactive`.
5. Motion: `fast`, `medium`, `lift`, `press`, plus one staggered reveal pattern.
6. Colors: monochrome semantic roles (`text-*`, `surface-*`, `border-*`) with neutral status tones.

## 3. Page Archetypes
1. Tool pages: `PageHeader -> KeySummary -> PrimaryActions -> MainSections`.
2. Detail pages: `BackNav -> EntityHero -> PrimaryActions -> ContextMetadata -> MainContent -> SecondaryContent`.
3. Collection pages: `PageHeader -> Filters/Actions -> Results -> StateFeedback`.
4. Embed pages: same hierarchy, compact density.
5. Archetype structure is mandatory and enforced with `data-ui-archetype` and `data-ui-block`.

## 4. Standard Element Grammar
1. Page chrome: `ui-page`, `ui-page__header`, `ui-page__title-group`, `ui-page__actions`.
2. Panels: `ToolPanel` (`ui-tool-panel`) and `ActionPanel` (`ui-action-panel`).
3. Cards: `ui-surface-card`, `ui-media-card`, `ui-link-card`.
4. Data facts: `DataGrid` (`ui-data-grid`) + `ui-data-point`.
5. Feedback blocks: `StateBlock` (`loading`, `empty`, `error`, `success`) for route/component states.
6. Controls: one family for button/chip/select sizing, focus, and disabled behavior.
7. Lists/rows: summary-first rows with optional disclosure details.

## 5. Information Architecture Rules
1. Every section exposes primary state immediately.
2. Primary actions appear once per section and are visually dominant.
3. Diagnostics/raw payloads are behind explicit disclosure.
4. Duplicate metadata is removed from headers/cards.
5. Recommendation rails and secondary context are smaller and visually separated.

## 6. Motion and Reduced Motion
1. Entry: section/card stagger reveals only.
2. Interaction: subtle hover lift + press reset.
3. Reduced motion: no hidden state behind animation; content visible immediately.
4. Performance-low mode: no blur-heavy rendering paths.

## 7. Accessibility and Performance
1. Minimum touch target + visible keyboard focus for all controls.
2. Consistent heading order and landmarks across archetypes.
3. Monochrome and status contrast remains legible.
4. Avoid expensive blur/shadow on primary surfaces.

## 8. Deprecated Patterns
1. Legacy `glass-*` naming is deprecated for new work.
2. Route-specific structural inventions are disallowed when primitives exist.
3. Nested card-in-card compositions on primary surfaces are disallowed.
