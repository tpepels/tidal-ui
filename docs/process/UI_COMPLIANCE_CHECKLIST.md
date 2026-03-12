# UI Compliance Checklist

Use this checklist for any PR that changes user-visible UI.

## Archetype and Structure
- [ ] Route has correct `data-ui-archetype`.
- [ ] Required `data-ui-block` markers exist for the route archetype.
- [ ] Page follows the standard archetype order (tool/detail/collection/embed).

## Shared Primitives
- [ ] Uses shared primitives (`ToolPanel`, `ActionPanel`, `DataGrid`, `StateBlock`) or approved `ui-*` classes.
- [ ] Avoids route-specific one-off structural wrappers when shared primitives exist.
- [ ] Avoids nested card-in-card primary surfaces.

## Tokens and Styling
- [ ] Uses semantic UI tokens (text/surface/border/status) instead of ad-hoc literals.
- [ ] Maintains monochrome minimal visual direction.
- [ ] No new legacy `glass-*` usage introduced.

## Interaction and Motion
- [ ] Primary actions are visible without expansion.
- [ ] Hover/press/focus states follow shared control behavior.
- [ ] Reduced-motion behavior does not hide meaning or state.

## Accessibility and Performance
- [ ] Keyboard navigation and focus ring behavior remain correct.
- [ ] Touch targets are comfortably sized on mobile.
- [ ] Contrast remains acceptable for text and states.
- [ ] No expensive blur-heavy effects added to primary surfaces.

## Verification
- [ ] `npm run check -- --fail-on-warnings`
- [ ] Relevant unit/e2e tests run (including route compliance test)
- [ ] Manual sanity check on affected routes (desktop + mobile)
