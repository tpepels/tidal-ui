import { describe, expect, it } from 'vitest';
import type { Album } from '$lib/types';
import {
	formatMusicBrainzReleaseOption,
	lookupAlbumMusicBrainzReleases,
	pickDefaultMusicBrainzReleaseId,
	type MusicBrainzReleaseOption
} from './albumMusicBrainzController';

describe('albumMusicBrainzController', () => {
	it('prefers exact track-count matches when picking a default release', () => {
		const releases: MusicBrainzReleaseOption[] = [
			{ id: 'a', title: 'Standard', trackCount: 10 },
			{ id: 'b', title: 'Deluxe', trackCount: 12 },
			{ id: 'c', title: 'Expanded', trackCount: 14 }
		];

		expect(pickDefaultMusicBrainzReleaseId(releases, 12)).toBe('b');
	});

	it('falls back to the first release meeting or exceeding the track count', () => {
		const releases: MusicBrainzReleaseOption[] = [
			{ id: 'a', title: 'Short', trackCount: 8 },
			{ id: 'b', title: 'Expanded', trackCount: 13 },
			{ id: 'c', title: 'Oversized', trackCount: 18 }
		];

		expect(pickDefaultMusicBrainzReleaseId(releases, 12)).toBe('b');
	});

	it('keeps a compatible existing selection during lookup', async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				JSON.stringify({
					success: true,
					releases: [
						{ id: 'preferred', title: 'Preferred', trackCount: 11 },
						{ id: 'other', title: 'Other', trackCount: 15 }
					]
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);

		const result = await lookupAlbumMusicBrainzReleases({
			album: {
				id: 1,
				title: 'Album',
				numberOfTracks: 10,
				artist: { id: 2, name: 'Artist', type: 'ARTIST' }
			} as Album,
			tracks: [],
			currentSelectionId: 'preferred',
			fetchImpl
		});

		expect(result.selectedReleaseId).toBe('preferred');
		expect(formatMusicBrainzReleaseOption(result.releases[0] ?? { id: 'x' })).toContain('Preferred');
	});
});
