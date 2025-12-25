# TDD_TODO_V4: Version 4.0.0 Planning

## Version Goals

- Achieve full GOVERNANCE.md compliance
- Implement comprehensive test coverage (>80% line/branch coverage)
- Add semantic invariant tests for critical behaviors
- Improve API reliability with better fallback handling
- Enhance UI/UX with better error handling and loading states

## Explicit Non-Goals

- Major UI redesign
- New audio formats beyond Tidal's offerings
- Third-party integrations beyond Tidal

## Allowed New Concepts

- Test utilities and coverage tooling
- Error boundary components
- API response caching improvements

## Definition of Done (DoD)

- [ ] All Tier 0 gates green (lint, format, typecheck)
- [ ] All Tier 1 gates green (tests, coverage >80%)
- [ ] Audit V3 findings resolved
- [ ] Semantic invariant tests for audio fallback and download logic
- [ ] No critical-path placeholders
- [ ] Documentation updated and accurate

## Scope Budget

- New modules: 2 (test utilities, error handling)
- New abstractions: 3 (coverage policy, invariant testers, cache layer)

## Critical Path Items

### Coverage Implementation

- [ ] Install and configure @vitest/coverage-v8 (resolve version conflicts)
- [ ] Set coverage thresholds: lines >80%, branches >75%
- [ ] Add coverage gate to CI (fail if below threshold)
- [ ] Exclude non-production files from coverage

### Semantic Tests

- [ ] Test audio quality fallback logic (Firefox MP4 enforcement)
- [ ] Test download conflict resolution
- [ ] Test API fallback chains
- [ ] Add invariant assertions with failure explanations

### Governance Compliance

- [ ] Enforce linting automatically (pre-commit hooks or CI)
- [ ] Add test taxonomy markers (@network, @offline)
- [ ] Review and remove unused abstractions
- [ ] Update GOVERNANCE.md if needed

### Reliability Improvements

- [ ] Better error messages for API failures
- [ ] Retry logic for transient network errors
- [ ] Graceful degradation for missing Tidal data

## Wiring Coverage Gates

- [ ] AudioPlayer.svelte: >90% coverage (critical playback logic)
- [ ] downloads.ts: >85% coverage (download flows)
- [ ] proxy/+server.ts: >80% coverage (API handling)
- [ ] download-track routes: >75% coverage

## Placeholder Tracking

None - V3 placeholders resolved.

## Risk Acceptance

- External API dependencies: Accepted with fallback chains
- Browser compatibility: Firefox enforced to MP4
- File system access: Server-side with sanitization
