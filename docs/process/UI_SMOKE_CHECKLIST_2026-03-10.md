# UI Smoke Checklist (2026-03-10)

## Navigation
- [ ] Sidebar route links open correct pages: `Browse`, `History`, `Settings`, `Download Center`, `Download Log`, `Status`.
- [ ] Sidebar keyboard navigation works with `ArrowUp`, `ArrowDown`, `Home`, `End`.
- [ ] Active route highlight tracks current page.

## Route Ownership
- [ ] `/settings` renders from route page, not layout conditional.
- [ ] `/status` renders from route page, not layout conditional.
- [ ] Layout is shell-only (`{@render children?.()}`).

## Download Operations
- [ ] `/download-center` loads queue data and controls update state.
- [ ] `/download-log` receives maintenance and download events.
- [ ] Deep links between Download Center, Download Log, Status, and Settings work.

## Status & Diagnostics
- [ ] `/status` refresh button updates health, target status, and queue metrics.
- [ ] Auto-refresh updates timestamp every poll cycle.
- [ ] Error state shows fallback panel when diagnostics fetch fails.

## Settings & Maintenance
- [ ] Queue export/storage toggles apply and persist.
- [ ] Cache clear action works and shows toast feedback.
- [ ] Library maintenance actions show progress and completion summaries.

## History
- [ ] Last 25 albums and last 10 artists are tracked.
- [ ] Resume links open latest album/artist.
- [ ] `Clear all`, `Clear albums`, and `Clear artists` actions work independently.

## Responsive
- [ ] Settings, Status, Download Center, and Download Log remain usable on <= 640px.
- [ ] Buttons remain reachable and readable without overlap.

## Accessibility
- [ ] Landmark regions and headings are present.
- [ ] Interactive controls have visible focus and usable labels.
- [ ] Status/error blocks are announced (`role="status"`/`role="alert"` where applicable).
