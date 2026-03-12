# UI vNext Migration Plan (Current -> Future)

## Summary
This plan moves the existing UI from partial unification to full archetype compliance with shared primitives and semantic tokens.

## Current Assessment Snapshot

### Route Archetype Compliance
| Surface | Archetype | Status | Notes |
|---|---|---|---|
| `/` | collection | pass | `page-header` + `results` in place |
| `/history` | collection | pass | filters and results blocks standardized |
| `/library-suggestions` | collection | pass | recommendation section and overview blocks marked as results |
| `/settings` | tool | pass | page header + key summary + primary actions + main sections |
| `/download-center` | tool | pass | key summary/actions/main sections in DownloadManager |
| `/download-log` | tool | pass | key summary/actions/main sections in DownloadLog |
| `/status` | tool | pass | page header + key summary + actions + main sections |
| `/artist/[id]` | detail | pass | back nav, hero, actions, context, main/secondary zones |
| `/album/[id]` | detail | pass | back nav, hero, actions, context, main/secondary zones |
| `/track/[id]` | detail | pass | back nav, hero, actions, context, main content |
| `/playlist/[id]` | detail | pass | back nav, hero, actions, context, main/secondary zones |
| embed routes | embed | pass | compact entity/action/main sections marked |

### Primitive Convergence
1. Added shared contracts: `ToolPanel`, `ActionPanel`, `DataGrid`, `StateBlock`.
2. Route metadata includes `archetype` and `sectionPriority`.
3. Shared pages now use semantic panels/cards broadly; remaining old style names are compatibility aliases.

## Execution Phases

### Phase 1: Baseline Lock and Gap Map (completed)
1. Route inventory and archetype map established.
2. Legacy/target pattern mapping documented.
3. Compliance matrix seeded and migration order fixed.

### Phase 2: Token and Primitive Convergence (in progress)
1. Semantic token path is active for text/surface/border/status roles.
2. Shared primitives are available and integrated across operational/detail routes.
3. Remaining work: remove legacy-only aliases after final route cleanup.

### Phase 3: Route Migration (in progress)
1. Tool routes: migrated to summary-first structure and section rhythm.
2. Detail routes: migrated to explicit hero/actions/context/main/secondary structure.
3. Collection routes: standardized header/actions/results/state blocks.
4. Embed routes: compact archetype markers and structure blocks added.

### Phase 4: Declutter and Hierarchy Pass (in progress)
1. Secondary rails are visually separated from primary content.
2. Metadata duplication reduced.
3. Remaining work: final small-size text cleanup on residual edge cards.

### Phase 5: QA and Signoff (pending)
1. Run type/lint/unit/e2e route checks.
2. Manual matrix: desktop/mobile/reduced-motion/performance-low.
3. Accessibility sweep: focus order, landmarks, contrast.

## Test Plan
1. Static route compliance test (`uiArchetypeCompliance.test.ts`) validates archetype/block markers.
2. Existing route/e2e tests validate navigation and major workflow stability.
3. Reduced-motion and mobile checks remain part of final manual signoff.

## Remaining Work Queue
1. Final visual declutter pass on residual dense cards/lists.
2. Remove dead/legacy visual aliases once no route depends on them.
3. Capture visual regression baselines for all archetypes.
