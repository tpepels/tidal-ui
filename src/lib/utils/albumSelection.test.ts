import { describe, expect, it } from 'vitest';
import { pickHigherScoredAlbum, scoreAlbumForSelection } from './albumSelection';

type AlbumSelectionInput = Parameters<typeof scoreAlbumForSelection>[0];

describe('albumSelection', () => {
	it('scores albums based on artwork + metadata completeness', () => {
		const base: AlbumSelectionInput = {
			cover: '',
			releaseDate: undefined,
			numberOfTracks: undefined,
			audioQuality: undefined
		};
		expect(scoreAlbumForSelection(base)).toBe(0);
		expect(
			scoreAlbumForSelection({
				...base,
				cover: 'cover-id',
				releaseDate: '2024-01-01',
				numberOfTracks: 10,
				audioQuality: 'LOSSLESS'
			})
		).toBe(5);
	});

	it('prefers the higher scored album', () => {
		const lower: AlbumSelectionInput = {
			cover: '',
			releaseDate: '2024-01-01',
			numberOfTracks: 8,
			audioQuality: undefined
		};
		const higher: AlbumSelectionInput = {
			cover: 'cover-id',
			releaseDate: '2024-01-01',
			numberOfTracks: 8,
			audioQuality: 'LOSSLESS'
		};
		expect(pickHigherScoredAlbum(lower, higher)).toBe(higher);
		expect(pickHigherScoredAlbum(higher, lower)).toBe(higher);
	});
});
