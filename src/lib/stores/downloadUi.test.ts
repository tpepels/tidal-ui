import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { downloadUiStore } from './downloadUi';
import type { PlayableTrack, Track } from '../types';

const makeTrack = (id: number): PlayableTrack => {
	const track: Track = {
		id,
		title: `Track ${id}`,
		duration: 120,
		version: null,
		popularity: 0,
		editable: false,
		explicit: false,
		trackNumber: 1,
		volumeNumber: 1,
		isrc: 'TEST',
		url: 'https://example.com',
		audioQuality: 'LOSSLESS',
		audioModes: ['STEREO'],
		allowStreaming: true,
		streamReady: true,
		premiumStreamingOnly: false,
		artist: { id: 1, name: 'Test Artist', type: 'MAIN' },
		artists: [{ id: 1, name: 'Test Artist', type: 'MAIN' }],
		album: {
			id: 1,
			title: 'Test Album',
			cover: '',
			videoCover: null
		}
	};
	return track;
};

describe('downloadUiStore', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		downloadUiStore.reset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('stores controller on beginTrackDownload and clears on completion', () => {
		const { taskId, controller } = downloadUiStore.beginTrackDownload(makeTrack(1), 'track.flac');
		const runningState = get(downloadUiStore);
		const task = runningState.tasks.find((entry) => entry.id === taskId);

		expect(task?.controller).toBeInstanceOf(AbortController);
		expect(task?.controller).toBe(controller);

		downloadUiStore.completeTrackDownload(taskId);
		const completedTask = get(downloadUiStore).tasks.find((entry) => entry.id === taskId);
		expect(completedTask?.status).toBe('completed');
		expect(completedTask?.controller).toBeUndefined();
	});

	it('aborts controller and marks task cancelled', () => {
		const { taskId, controller } = downloadUiStore.beginTrackDownload(makeTrack(2), 'track.flac');

		downloadUiStore.cancelTrackDownload(taskId);
		const cancelledTask = get(downloadUiStore).tasks.find((entry) => entry.id === taskId);

		expect(controller.signal.aborted).toBe(true);
		expect(cancelledTask?.status).toBe('cancelled');
		expect(cancelledTask?.controller).toBeUndefined();
	});

	it('advances ffmpeg countdown and clears active flag on completion', () => {
		downloadUiStore.startFfmpegCountdown(2048, { autoTriggered: true });
		let state = get(downloadUiStore);

		expect(state.ffmpeg.phase).toBe('countdown');
		expect(state.ffmpeg.countdownActive).toBe(true);

		vi.advanceTimersByTime(1000);
		state = get(downloadUiStore);
		expect(state.ffmpeg.countdownSeconds).toBe(4);

		vi.advanceTimersByTime(4000);
		state = get(downloadUiStore);
		expect(state.ffmpeg.phase).toBe('loading');
		expect(state.ffmpeg.countdownActive).toBe(false);
	});

	it('skipFfmpegCountdown transitions to loading and disables countdown', () => {
		downloadUiStore.startFfmpegCountdown(1024, { autoTriggered: true });
		downloadUiStore.skipFfmpegCountdown();
		const state = get(downloadUiStore);

		expect(state.ffmpeg.phase).toBe('loading');
		expect(state.ffmpeg.countdownActive).toBe(false);
		expect(state.ffmpeg.countdownSeconds).toBe(0);
	});

	it('removes tasks after dismissal to avoid ghost entries', () => {
		const { taskId } = downloadUiStore.beginTrackDownload(makeTrack(3), 'track.flac');
		downloadUiStore.cancelTrackDownload(taskId);
		downloadUiStore.dismissTrackTask(taskId);

		const state = get(downloadUiStore);
		expect(state.tasks).toHaveLength(0);
	});
});
