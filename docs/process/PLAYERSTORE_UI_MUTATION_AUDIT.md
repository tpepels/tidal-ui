# playerStore UI Mutation Audit

This audit captures direct `playerStore` mutations originating from UI components and routes.
Use it to guide future consolidation.

## Components
- `src/lib/components/AudioPlayer.svelte`: queue remove/shuffle, volume updates, sample/bit depth, replay gain.
- `src/lib/components/SearchInterface.svelte`: enqueue, enqueueNext, setQueue, play.
- `src/lib/components/TrackList.svelte`: setQueue, play, enqueue, enqueueNext, pause.
- `src/lib/components/TopTracksGrid.svelte`: setQueue, play, enqueue, enqueueNext.
- `src/lib/components/LyricsPopup.svelte`: play.

## Routes
- `src/routes/+page.svelte`: setQueue, play.
- `src/routes/track/[id]/+page.svelte`: setQueue, play.
- `src/routes/playlist/[id]/+page.svelte`: setQueue, play.
- `src/routes/album/[id]/+page.svelte`: setQueue, play, pause, shuffle.

## Embeds
- `src/routes/embed/track/[id]/+page.svelte`: pause, setQueue, play.
- `src/routes/embed/artist/[id]/+page.svelte`: pause, setQueue, play.
- `src/routes/embed/album/[id]/+page.svelte`: pause, setQueue, play.
- `src/routes/embed/playlist/[id]/+page.svelte`: pause, setQueue, play.

## Orchestrators
- `src/lib/orchestrators/searchOrchestrator.ts`: setTrack, play.
