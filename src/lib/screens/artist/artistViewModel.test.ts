import { describe, expect, it } from 'vitest';
import type { ArtistDetails } from '$lib/types';
import {
	DEFAULT_ARTIST_DISCOGRAPHY_FILTER_STATE,
	buildArtistHeroViewModel,
	toggleArtistDiscographyFilterState
} from './artistViewModel';

describe('artistViewModel', () => {
	it('keeps one content-rating filter active', () => {
		const next = toggleArtistDiscographyFilterState(
			{
				...DEFAULT_ARTIST_DISCOGRAPHY_FILTER_STATE,
				explicit: true,
				clean: false
			},
			'explicit'
		);

		expect(next.explicit).toBe(false);
		expect(next.clean).toBe(true);
	});

	it('builds an artist hero view model from normalized artist state', () => {
		const artist = {
			id: 7,
			name: 'Massive Attack',
			type: 'Artist',
			picture: 'abc-def',
			popularity: 82,
			artistTypes: ['Group'],
			artistRoles: [{ category: 'Main', categoryId: 1 }],
			albums: [],
			tracks: []
		} as unknown as ArtistDetails;

		const hero = buildArtistHeroViewModel(artist, '/artist.jpg');

		expect(hero.title).toBe('Massive Attack');
		expect(hero.visual?.kind).toBe('artwork');
		expect(hero.metaItems?.length).toBeGreaterThan(0);
	});
});
