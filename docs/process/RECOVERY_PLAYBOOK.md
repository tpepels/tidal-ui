# Recovery Playbook

This playbook documents low-risk recovery steps for playback and download state issues.
Use these steps to stabilize the UI without a full reload when possible.

## Playback Recovery

1. Pause playback.
2. Reset playback state.
3. Rehydrate persisted state if needed.

Test hooks (DEV/E2E only):
```ts
window.__tidalResetPlayback?.();
window.__tidalRehydratePlayback?.();
```

## Download Recovery

1. Cancel any active downloads.
2. Reset download UI state.

Test hooks (DEV/E2E only):
```ts
window.__tidalResetDownloads?.();
```

## When to Use

- Playback UI stuck in loading or play/pause desync.
- Download UI stuck in running/error state after cancel.
- Repro triage for state persistence bugs.
