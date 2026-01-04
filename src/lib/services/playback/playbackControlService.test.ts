import { describe, expect, it, vi } from 'vitest';
import {
	handlePreviousTrack,
	requestAudioPlayback,
	seekToPosition,
	setVolume
} from './playbackControlService';

describe('playbackControlService', () => {
	it('seeks within duration and notifies callback', () => {
		const audio = { currentTime: 0 } as HTMLAudioElement;
		const onSetCurrentTime = vi.fn();

		seekToPosition(audio, 140, { duration: 120, onSetCurrentTime });

		expect(audio.currentTime).toBe(120);
		expect(onSetCurrentTime).toHaveBeenCalledWith(120);
	});

	it('handles previous track behavior based on time and queue index', () => {
		const audio = { currentTime: 0 } as HTMLAudioElement;
		const onSetCurrentTime = vi.fn();
		const onPrevious = vi.fn();

		handlePreviousTrack(audio, {
			currentTime: 10,
			queueIndex: 1,
			onSetCurrentTime,
			onPrevious
		});
		expect(onSetCurrentTime).toHaveBeenCalledWith(0);

		onSetCurrentTime.mockClear();
		handlePreviousTrack(audio, {
			currentTime: 2,
			queueIndex: 2,
			onSetCurrentTime,
			onPrevious
		});
		expect(onPrevious).toHaveBeenCalledTimes(1);
	});

	it('clamps volume updates', () => {
		const onSetVolume = vi.fn();
		const clampedHigh = setVolume(2, { onSetVolume });
		expect(clampedHigh).toBe(1);
		expect(onSetVolume).toHaveBeenCalledWith(1);

		const clampedLow = setVolume(-1, { onSetVolume });
		expect(clampedLow).toBe(0);
		expect(onSetVolume).toHaveBeenCalledWith(0);
	});

	it('retries play after a pause when initial play fails', async () => {
		const play = vi
			.fn()
			.mockRejectedValueOnce(new Error('first fail'))
			.mockResolvedValueOnce(undefined);
		const pause = vi.fn();
		const audio = { play, pause } as unknown as HTMLAudioElement;

		await requestAudioPlayback(audio);
		expect(play).toHaveBeenCalledTimes(2);
		expect(pause).toHaveBeenCalledTimes(1);
	});
});
