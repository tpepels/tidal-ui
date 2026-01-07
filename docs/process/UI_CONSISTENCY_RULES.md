# UI Consistency Rules

These rules capture the intended interaction contract for existing surfaces.

## Playback Actions
- Track row click always plays that track (row-level play intent).
- Queue actions are only available from the queue action menu and never on row click.
- Bulk play controls must state their scope in labels (results/album/playlist/queue).

## Queue Actions
- "Play Next" inserts immediately after the current track.
- "Add to Queue" appends to the end of the current queue.
- Queue shuffle and clear actions must mention "Queue" in labels.

## Downloads
- Download controls follow a single state machine: idle → downloading → completed or cancelled.
- Cancel is always available only while downloading.
- Download buttons must use the shared download UI control.

## Feedback
- Buttons that change collection scope include explicit labels/aria-labels.
- Menu items use consistent verbs across surfaces (Play Next, Add to Queue).
