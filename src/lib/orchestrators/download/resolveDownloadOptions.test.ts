import { describe, it, expect } from 'vitest';
import { resolveDownloadOptions } from './resolveDownloadOptions';

const userPrefs = {
	convertAacToMp3: true,
	downloadCoversSeperately: false
};

const downloadPrefs = {
	storage: 'server' as const
};

describe('resolveDownloadOptions', () => {
	it('uses preferences and defaults when options are not provided', () => {
		const resolved = resolveDownloadOptions(undefined, userPrefs, downloadPrefs);

		expect(resolved.quality).toBe('LOSSLESS');
		expect(resolved.convertAacToMp3).toBe(true);
		expect(resolved.downloadCoversSeperately).toBe(false);
		expect(resolved.autoConvertSonglink).toBe(true);
		expect(resolved.notificationMode).toBe('alert');
		expect(resolved.useCoordinator).toBe(false);
		expect(resolved.storage).toBe('server');
		expect(resolved.conflictResolution).toBe('overwrite_if_different');
	});

	it('allows explicit options to override preferences', () => {
		const resolved = resolveDownloadOptions(
			{
				quality: 'HIGH',
				convertAacToMp3: false,
				downloadCoversSeperately: true,
				autoConvertSonglink: false,
				notificationMode: 'toast',
				subtitle: 'override',
				ffmpegAutoTriggered: true,
				skipFfmpegCountdown: true,
				useCoordinator: true,
				storage: 'client',
				conflictResolution: 'skip'
			},
			userPrefs,
			downloadPrefs
		);

		expect(resolved.quality).toBe('HIGH');
		expect(resolved.convertAacToMp3).toBe(false);
		expect(resolved.downloadCoversSeperately).toBe(true);
		expect(resolved.autoConvertSonglink).toBe(false);
		expect(resolved.notificationMode).toBe('toast');
		expect(resolved.subtitle).toBe('override');
		expect(resolved.ffmpegAutoTriggered).toBe(true);
		expect(resolved.skipFfmpegCountdown).toBe(true);
		expect(resolved.useCoordinator).toBe(true);
		expect(resolved.storage).toBe('client');
		expect(resolved.conflictResolution).toBe('skip');
	});
});
