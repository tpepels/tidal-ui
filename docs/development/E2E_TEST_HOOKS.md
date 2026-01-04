# E2E Test Hooks (Registry v1)

This document captures app-level hooks intended for Playwright tests. These hooks are
**DEV-only** and should not be relied on in production. In E2E runs, enable them with
`VITE_E2E=true`.

## Hook Registry (v1)

Allowed hooks in tests:

- `window.__tidalSetRegion(region)`
- `window.__tidalSetCurrentTime(time)`
- `window.__tidalSetDuration(duration)`
- `window.__tidalResetPlayback()`
- `window.__tidalRehydratePlayback()`
- `window.__tidalResetDownloads()`
- `window.__tidalPlaybackMachineState()`

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

## Download Recovery

### Window hooks (runtime)

```ts
await page.evaluate(() => window.__tidalResetDownloads?.());
```
