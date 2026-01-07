# E2E Test Hooks (Registry v1)

This document captures app-level hooks intended for Playwright tests. These hooks are
**DEV-only** and should not be relied on in production. In E2E runs, enable them with
`VITE_E2E=true`.

## Hook Registry (v1)

Allowed hooks in tests:

- `window.__tidalSetRegion(region)`
- `window.__tidalSetCurrentTime(time)`
- `window.__tidalSetDuration(duration)`
- `window.__tidalSetQueue(tracks, startIndex?)`
- `window.__tidalShuffleQueue()`
- `window.__tidalResetPlayback()`
- `window.__tidalRehydratePlayback()`
- `window.__tidalResetDownloads()`
- `window.__tidalPlaybackMachineState()`
- `window.__tidalSetPlaybackQuality(quality)`

## Stability Policy

- Only hooks listed above are supported in Playwright tests.
- Any new hook or behavioral change must update this registry and include a short rationale.

## Deprecations

No hooks are currently deprecated. If that changes, list the hook, the replacement, and the planned removal version here.

## Region Switching

### URL param (initial load)

Use `testRegion` to force the initial region on first render:

```text
/?testRegion=auto
/?testRegion=us
/?testRegion=eu
```

### Window hook (runtime)

Use the window hook to switch regions mid-test:

```ts
await page.evaluate(() => window.__tidalSetRegion?.('us'));
```

### Behavior

- Updates `localStorage` key: `tidal-ui.region`
- Works only when `import.meta.env.DEV` is true
- When `VITE_E2E=true`, region validation in the search UI allows non-auto values.

## Playback Time

### Window hooks (runtime)

```ts
await page.evaluate(() => window.__tidalSetDuration?.(120));
await page.evaluate(() => window.__tidalSetCurrentTime?.(42));
```

## Playback Queue

### Window hooks (runtime)

```ts
await page.evaluate(() => window.__tidalSetQueue?.(tracks, 0));
await page.evaluate(() => window.__tidalShuffleQueue?.());
```

## Playback Recovery

### Window hooks (runtime)

```ts
await page.evaluate(() => window.__tidalResetPlayback?.());
await page.evaluate(() => window.__tidalRehydratePlayback?.());
```

## Playback Machine State

### Window hooks (runtime)

```ts
const state = await page.evaluate(() => window.__tidalPlaybackMachineState?.());
```

### State shape

```ts
type PlaybackMachineSnapshot = {
	state: string;
	isPlaying: boolean;
	isLoading: boolean;
	currentTrackId: number | string | null;
	quality: string;
	loadRequestId: number;
	queueIndex: number;
	queueLength: number;
};
```

## Playback Quality

### Window hooks (runtime)

```ts
await page.evaluate(() => window.__tidalSetPlaybackQuality?.('LOW'));
```

## Download Recovery

### Window hooks (runtime)

```ts
await page.evaluate(() => window.__tidalResetDownloads?.());
```

## QA Diagnostics Overlay

In DEV/E2E, use `Ctrl+Shift+D` or the floating "Diagnostics" button to open the QA diagnostics overlay.
It shows error summaries, domain counts, and `/api/health` status.

## Network Test Fixtures

Use the helpers in `tests/e2e/helpers/network.ts` to simulate slow or flaky proxy responses:

```ts
import { applySlowProxy, applyFlakyProxy } from '../helpers/network';

await applySlowProxy(page, 1500);
await applyFlakyProxy(page, 2);
```
