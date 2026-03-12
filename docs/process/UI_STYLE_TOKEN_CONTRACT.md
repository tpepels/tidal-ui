# UI Style Token Contract

## Purpose
Defines the allowed semantic token interface for user-visible UI styling.

## Token Families

### Text
1. `--ui-text-primary`
2. `--ui-text-secondary`
3. `--ui-text-muted`

### Surface
1. `--ui-surface-base`
2. `--ui-surface-raised`
3. `--ui-surface-interactive`

### Border
1. `--ui-border-subtle-semantic`
2. `--ui-border-strong-semantic`

### Status
1. `--ui-status-success`
2. `--ui-status-warning`
3. `--ui-status-error`
4. `--ui-status-info`

### Motion
1. `--ui-motion-fast`
2. `--ui-motion-medium`
3. `--ui-lift-y`
4. `--ui-press-y`
5. `--ui-reveal-duration`
6. `--ui-stagger-step`

## Usage Rules
1. New UI code must use semantic tokens, not direct color literals.
2. Status surfaces/messages must use status tokens.
3. New components must not introduce parallel visual token families.
4. Typography and spacing must use the shared scale and spacing ladder.

## Compatibility / Deprecation
1. Legacy class names under `glass-*` are compatibility-only and deprecated.
2. New surfaces must use `ui-*` grammar and semantic tokens.
3. PRs touching user-visible UI should include token-contract compliance checks.
