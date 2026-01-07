import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';

const downloadTrackMock = vi.fn();

vi.mock('$lib/orchestrators', () => ({
	downloadOrchestrator: {
		downloadTrack: (...args: unknown[]) => downloadTrackMock(...args)
	}
}));

import { createTrackDownloadUi } from './trackDownloadUi';
import type { Track } from '$lib/types';

const makeTrack = (id: number): Track =>
	({
		id,
		title: `Track ${id}`,
		album: { title: 'Album', id: 10 },
		artist: { name: 'Artist', id: 20 }
	}) as Track;

describe('trackDownloadUi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		downloadPreferencesStore.setDownloadQuality('LOSSLESS');
	});

	it('dispatches download with resolved subtitle and clears in-flight state', async () => {
		downloadTrackMock.mockResolvedValueOnce({ success: true, taskId: 'task-1' });
		const ui = createTrackDownloadUi<Track>({
			resolveSubtitle: (track) => track.album?.title ?? 'Unknown',
			notificationMode: 'alert',
			skipFfmpegCountdown: true
		});
		const track = makeTrack(1);

		await ui.handleDownload(track);

		expect(downloadTrackMock).toHaveBeenCalledWith(track, {
			quality: get(downloadPreferencesStore).downloadQuality,
			subtitle: 'Album',
			notificationMode: 'alert',
			ffmpegAutoTriggered: false,
			skipFfmpegCountdown: true,
			autoConvertSonglink: false
		});
		expect(get(ui.downloadingIds).has(track.id)).toBe(false);
	});

	it('marks cancellation for explicit cancel results', async () => {
		vi.useFakeTimers();
		downloadTrackMock.mockResolvedValueOnce({
			success: false,
			error: { code: 'DOWNLOAD_CANCELLED' }
		});
		const ui = createTrackDownloadUi<Track>({
			resolveSubtitle: () => 'Artist',
			notificationMode: 'alert'
		});
		const track = makeTrack(2);

		await ui.handleDownload(track);

		expect(get(ui.cancelledIds).has(track.id)).toBe(true);
		vi.advanceTimersByTime(1500);
		expect(get(ui.cancelledIds).has(track.id)).toBe(false);
		vi.useRealTimers();
	});

	it('ignores duplicate download requests while a track is already downloading', async () => {
		let resolveDownload: (value: { success: boolean }) => void;
		const deferred = new Promise<{ success: boolean }>((resolve) => {
			resolveDownload = resolve;
		});
		downloadTrackMock.mockReturnValueOnce(deferred);
		const ui = createTrackDownloadUi<Track>({
			resolveSubtitle: () => 'Artist'
		});
		const track = makeTrack(3);

		const first = ui.handleDownload(track);
		await ui.handleDownload(track);

		expect(downloadTrackMock).toHaveBeenCalledTimes(1);

		resolveDownload!({ success: true });
		await first;
	});
});
