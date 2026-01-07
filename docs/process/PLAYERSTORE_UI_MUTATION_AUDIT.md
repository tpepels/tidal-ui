# playerStore UI Mutation Audit

This audit captures direct `playerStore` mutations originating from UI components and routes.
Use it to guide future consolidation and ensure playback intent stays in the facade/machine.

## Components
- `src/lib/components/AudioPlayer.svelte`: UI projection updates only (current time, duration, volume, sample rate/bit depth/replay gain).

## Routes
- None (routes use `playbackFacade` for playback intent).

## Embeds
- None (embed controls use `playbackFacade`).

## Orchestrators
- None (streaming URL workflow uses `playbackFacade`).
