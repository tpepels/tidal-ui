import { describe, expect, it } from 'vitest';
import type { Album } from '$lib/types';
import type { DiscographyGroup } from '$lib/utils/discography';
import {
	describeDiscographyEntrySource,
	resolveDiscographyGroupMusicBrainzReleaseId
} from './artistDiscographyPresentation';

function createAlbum(overrides: Partial<Album> & Pick<Album, 'id' | 'title'>): Album {
	return {
		id: overrides.id,
		title: overrides.title,
		cover: overrides.cover ?? 'cover-id',
		videoCover: null,
		numberOfTracks: overrides.numberOfTracks ?? 10,
		artist: overrides.artist ?? { id: 1, name: 'Artist', type: 'MAIN' },
		artists: overrides.artists ?? [{ id: 1, name: 'Artist', type: 'MAIN' }],
		discographySource: overrides.discographySource,
		releaseDate: overrides.releaseDate ?? '2024-01-01'
	};
}

function createEntry(overrides?: Partial<DiscographyGroup>): DiscographyGroup {
	const representative = createAlbum({ id: 1, title: 'Signal Fires' });
	return {
		key: 'signal-fires',
		representative,
		versions: [representative],
		availableQualities: ['LOSSLESS'],
		section: 'album',
		...overrides
	};
}

describe('artistDiscographyPresentation', () => {
	it('resolves a grouped MusicBrainz match from a non-representative version', () => {
		const representative = createAlbum({ id: 10, title: 'Shared Album' });
		const alternateVersion = createAlbum({
			id: 11,
			title: 'Shared Album',
			discographySource: 'official_tidal'
		});
		const entry = createEntry({
			representative,
			versions: [representative, alternateVersion]
		});

		expect(
			resolveDiscographyGroupMusicBrainzReleaseId(entry, {
				albumMusicBrainzReleaseMatches: { 11: 'release-11' }
			})
		).toBe('release-11');
	});

	it('falls back to cached MusicBrainz matches across grouped versions', () => {
		const representative = createAlbum({ id: 20, title: 'Shared Album' });
		const alternateVersion = createAlbum({
			id: 21,
			title: 'Shared Album',
			discographySource: 'official_tidal'
		});
		const entry = createEntry({
			representative,
			versions: [representative, alternateVersion]
		});

		expect(
			resolveDiscographyGroupMusicBrainzReleaseId(entry, {
				albumMusicBrainzReleaseMatches: {},
				resolveCachedMusicBrainzReleaseId: (album) =>
					album.id === 21 ? 'cached-release-21' : undefined
			})
		).toBe('cached-release-21');
	});

	it('describes artist page only releases clearly', () => {
		const representative = createAlbum({
			id: 30,
			title: 'Official Only',
			discographySource: 'official_tidal'
		});
		const entry = createEntry({
			representative,
			versions: [representative]
		});

		expect(describeDiscographyEntrySource(entry)).toBe('Artist page only release');
	});

	it('describes catalog rows that also include an artist-page duplicate', () => {
		const representative = createAlbum({ id: 40, title: 'Signal Fires' });
		const alternateVersion = createAlbum({
			id: 41,
			title: 'Signal Fires',
			discographySource: 'official_tidal'
		});
		const entry = createEntry({
			representative,
			versions: [representative, alternateVersion]
		});

		expect(describeDiscographyEntrySource(entry)).toBe(
			'Catalog release · artist page also found'
		);
	});
});
