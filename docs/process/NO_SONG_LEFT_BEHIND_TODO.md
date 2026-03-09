# No Song Left Behind TODO

Last updated: 2026-03-09

## P0

- [x] Post-publish album reconciliation:
  - [x] verify published album contains every expected track file
  - [x] auto-enqueue missing tracks before album completion
  - [x] fail album job (not completed) when reconciliation detects missing tracks
- [x] Album-level automatic retry cycles:
  - [x] retry transient album failures with backoff (`rate_limit`, `network`, `server_error`, `unknown`)
  - [x] keep terminal handling for definitive external failures

## P1

- [x] Final decode integrity gate:
  - [x] run `ffmpeg` decode sanity check after `ffprobe` container/duration validation
  - [x] fail strict when `ffmpeg` binary is unavailable or decode fails
- [x] Dynamic target trust hardening:
  - [x] dynamic targets must be HTTPS
  - [x] host allowlist enforced for dynamic uptime targets
  - [x] private/local hostnames blocked
  - [x] server-side DNS trust hook to reject suspicious hosts
- [x] Dead-letter reason codes + dashboard surface:
  - [x] add structured `failureCode` to queued jobs
  - [x] include `failure_by_code` in queue metrics
  - [x] expose queue metrics endpoint for UI/dashboard

## P2

- [x] Add focused resilience tests for new policy logic:
  - [x] missing published track detection logic
  - [x] external error classification and failure-code mapping
  - [x] dynamic target trust filtering behaviors

