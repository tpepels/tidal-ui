import { describe, expect, it } from 'vitest';
import type { Album } from '$lib/types';
import { groupDiscography } from './discography';

const buildAlbum = (
	overrides: Partial<Album> & Pick<Album, 'id' | 'title'>
): Album =>
	({
		id: overrides.id,
		title: overrides.title,
		cover: overrides.cover ?? 'cover-id',
		videoCover: null,
		releaseDate: overrides.releaseDate ?? '2024-01-01',
		numberOfTracks: overrides.numberOfTracks ?? 10,
		type: overrides.type ?? 'ALBUM',
		audioQuality: overrides.audioQuality ?? 'LOSSLESS',
		artist: overrides.artist ?? { id: 1, name: 'Artist', type: 'MAIN' },
		artists: overrides.artists ?? [{ id: 1, name: 'Artist', type: 'MAIN' }],
		upc: overrides.upc,
		popularity: overrides.popularity ?? 50,
		mediaMetadata: overrides.mediaMetadata
	}) as Album;

describe('groupDiscography', () => {
	it('merges quality variants and picks representative at preferred quality or higher', () => {
		const albums: Album[] = [
			buildAlbum({ id: 10, title: 'Sample Album', audioQuality: 'HIGH' }),
			buildAlbum({ id: 11, title: 'Sample Album', audioQuality: 'LOSSLESS' }),
			buildAlbum({ id: 12, title: 'Sample Album', audioQuality: 'HI_RES_LOSSLESS' })
		];

		const losslessPreferred = groupDiscography(albums, 'LOSSLESS');
		expect(losslessPreferred).toHaveLength(1);
		expect(losslessPreferred[0]?.representative.id).toBe(11);
		expect(losslessPreferred[0]?.availableQualities).toEqual([
			'HI_RES_LOSSLESS',
			'LOSSLESS',
			'HIGH'
		]);

		const hiResPreferred = groupDiscography(albums, 'HI_RES_LOSSLESS');
		expect(hiResPreferred[0]?.representative.id).toBe(12);

		const lowPreferred = groupDiscography(albums, 'LOW');
		expect(lowPreferred[0]?.representative.id).toBe(10);
	});

	it('splits singles into a separate section', () => {
		const albums: Album[] = [
			buildAlbum({ id: 21, title: 'Main Album', type: 'ALBUM' }),
			buildAlbum({ id: 22, title: 'Lead Single', type: 'SINGLE' })
		];

		const grouped = groupDiscography(albums, 'LOSSLESS');
		expect(grouped).toHaveLength(2);
		expect(grouped.find((entry) => entry.representative.id === 21)?.section).toBe('album');
		expect(grouped.find((entry) => entry.representative.id === 22)?.section).toBe('single');
	});

	it('does not create duplicate groups for repeated album ids', () => {
		const albums: Album[] = [
			buildAlbum({ id: 31, title: 'Duplicate Album', cover: '' }),
			buildAlbum({ id: 31, title: 'Duplicate Album', cover: 'cover-id' })
		];

		const grouped = groupDiscography(albums, 'LOSSLESS');
		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.versions).toHaveLength(1);
		expect(grouped[0]?.representative.cover).toBe('cover-id');
	});

	it('collapses same-title quality variants even when metadata differs', () => {
		const albums: Album[] = [
			buildAlbum({
				id: 41,
				title: 'Blueprint',
				audioQuality: 'HIGH',
				releaseDate: '2023-01-01',
				upc: '111111111111'
			}),
			buildAlbum({
				id: 42,
				title: 'Blueprint',
				audioQuality: 'LOSSLESS',
				releaseDate: '2024-06-10',
				upc: '222222222222'
			})
		];

		const grouped = groupDiscography(albums, 'LOSSLESS');
		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.representative.id).toBe(42);
		expect(grouped[0]?.versions.map((album) => album.id).sort((a, b) => a - b)).toEqual([41, 42]);
	});

	it('prefers newer representative for same-title merged releases', () => {
		const albums: Album[] = [
			buildAlbum({
				id: 51,
				title: 'Same Name',
				audioQuality: 'LOSSLESS',
				releaseDate: '2025-01-01',
				popularity: 20
			}),
			buildAlbum({
				id: 52,
				title: 'Same Name',
				audioQuality: 'LOSSLESS',
				releaseDate: '2020-01-01',
				popularity: 90
			})
		];

		const grouped = groupDiscography(albums, 'LOSSLESS');
		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.representative.id).toBe(51);
	});
});
