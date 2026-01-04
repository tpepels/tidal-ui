# Playback Machine Migration Map

This maps legacy playback logic to machine events and side effects.

## Legacy → Machine

- Track load request → `LOAD_TRACK`
- Stream fetch completion → `LOAD_COMPLETE`
- Stream fetch error → `LOAD_ERROR`
- Quality change → `CHANGE_QUALITY`
- Fallback selection (DASH/LOSSLESS/STREAM) → `FALLBACK_REQUESTED`
- Audio element `loadeddata` → `AUDIO_READY`
- Audio element `playing` → `AUDIO_PLAYING`
- Audio element `pause` → `AUDIO_PAUSED`
- Audio element `waiting` → `AUDIO_WAITING`
- Audio element `error` → `AUDIO_ERROR`
- Track end → `TRACK_END`
- Seek bar drag / lyrics seek → `SEEK`

## Side Effects

- API stream load → `LOAD_STREAM`
- Audio src update → `SET_AUDIO_SRC`
- Playback control → `PLAY_AUDIO` / `PAUSE_AUDIO`
- Seek → `SEEK_AUDIO`
- Error surface → `SHOW_ERROR`

## Remaining Non-Machine Responsibilities

- Queue operations (next/previous/shuffle/enqueue)
- Volume and mute
