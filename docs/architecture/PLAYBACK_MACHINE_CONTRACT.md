# Playback Machine Contract

This document defines the playback state machine contract and how it synchronizes with
runtime stores and the audio element.

## Ownership

- **playbackMachine**: playback state, queue, stream URL selection, fallback/load sequencing, and stream metadata.
- **Audio element**: source URL, playback state, currentTime progression.

## States

- `idle`: no track loaded
- `converting`: Songlink → TIDAL conversion in progress
- `loading`: stream URL is being fetched
- `ready`: stream is loaded and ready to play
- `playing`: audio element is playing
- `paused`: playback paused
- `buffering`: audio playing but waiting for data
- `error`: playback failure

## Events

- `LOAD_TRACK(track)`
- `CONVERSION_COMPLETE(track)` / `CONVERSION_ERROR(error)`
- `LOAD_COMPLETE(streamUrl, quality)` / `LOAD_ERROR(error)`
- `PLAY` / `PAUSE`
- `AUDIO_READY` / `AUDIO_PLAYING` / `AUDIO_PAUSED` / `AUDIO_WAITING` / `AUDIO_ERROR`
- `TRACK_END`
- `CHANGE_QUALITY(quality)`
- `FALLBACK_REQUESTED(quality, reason)`
- `SEEK(position)`

## Side Effects

- `CONVERT_SONGLINK` → API conversion
- `LOAD_STREAM` → API stream URL load (requestId guarded)
- `SET_AUDIO_SRC` → set audio element src + load
- `PLAY_AUDIO` / `PAUSE_AUDIO` / `SEEK_AUDIO`
- `SHOW_ERROR` → user-visible error

## Invariants

- `playing` or `loading` implies `currentTrack` is set.
- `loadRequestId` is monotonic and guards stale load completion.
- `streamUrl` updates only after matching `loadRequestId`.
- `autoPlay` is the only reason to transition from `loading` to `playing`.

## Sync Rules

- UI reads playback state via machine-derived stores.
- Seek actions update the audio element; machine `currentTime` updates via timeupdate.

## Out of Scope

- None. PlaybackMachine is the single source of truth for playback state.
