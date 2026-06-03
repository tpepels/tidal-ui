import { describe, expect, it } from 'vitest';
import { parseAlbumLookupPayload } from './catalogAlbumResponse';

describe('catalog album response parsing', () => {
	it('parses hifi-api v2.10 album data as the album with items as tracks', () => {
		const result = parseAlbumLookupPayload({
			version: '2.10',
			data: {
				id: 232653022,
				title: 'Money For Nothing (2022 Remaster)',
				cover: 'cover-id',
				videoCover: null,
				numberOfTracks: 1,
				artist: { id: 1, name: 'Dire Straits', type: 'MAIN' },
				artists: [{ id: 1, name: 'Dire Straits', type: 'MAIN' }],
				items: [
					{
						item: {
							id: 232653023,
							title: 'Sultans Of Swing',
							duration: 300,
							trackNumber: 1,
							volumeNumber: 1,
							artists: [{ id: 1, name: 'Dire Straits', type: 'MAIN' }],
							audioQuality: 'LOSSLESS'
						}
					}
				]
			}
		});

		expect(result?.album.id).toBe(232653022);
		expect(result?.album.title).toBe('Money For Nothing (2022 Remaster)');
		expect(result?.tracks).toHaveLength(1);
		expect(result?.tracks[0].album.id).toBe(232653022);
		expect(result?.tracks[0].artist.name).toBe('Dire Straits');
	});
});
