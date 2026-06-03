import { describe, expect, it, vi } from 'vitest';
import {
	assertAlbumTrackListComplete,
	parseAlbumResponse
} from './downloadQueueWorkerAlbumResponse';

describe('download queue album response parsing', () => {
	it('parses hifi-api v2.10 album data without deriving album from the first track', () => {
		const result = parseAlbumResponse({
			version: '2.10',
			data: {
				id: 232653022,
				title: 'Money For Nothing (2022 Remaster)',
				cover: 'cover-id',
				videoCover: null,
				numberOfTracks: 1,
				artist: { id: 1, name: 'Dire Straits', type: 'MAIN' },
				items: [
					{
						item: {
							id: 232653023,
							title: 'Sultans Of Swing',
							duration: 300,
							trackNumber: 1,
							volumeNumber: 1
						}
					}
				]
			}
		});

		expect(result.album.id).toBe(232653022);
		expect(result.album.title).toBe('Money For Nothing (2022 Remaster)');
		expect(result.tracks).toHaveLength(1);
		expect(result.tracks[0].id).toBe(232653023);
		expect((result.tracks[0].album as Record<string, unknown>).id).toBe(232653022);
	});

	it('fails metadata validation when the album payload is missing expected tracks', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		try {
			expect(() =>
				assertAlbumTrackListComplete(
					232653022,
					{ id: 232653022, title: 'Incomplete Album', numberOfTracks: 2 },
					[{ id: 232653023, title: 'Track 1', trackNumber: 1 }]
				)
			).toThrow('Album 232653022 metadata incomplete: received 1/2 track item(s).');
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Album 232653022 metadata incomplete')
			);
		} finally {
			warnSpy.mockRestore();
		}
	});
});
