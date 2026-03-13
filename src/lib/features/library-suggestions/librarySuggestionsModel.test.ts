import { describe, expect, it } from 'vitest';
import {
	buildSearchHref,
	createSuggestionsSnapshot,
	parseSuggestionsSnapshot,
	type SuggestionsState
} from './librarySuggestionsModel';

describe('librarySuggestionsModel', () => {
	it('builds browse/search hrefs with the selected tab', () => {
		expect(buildSearchHref('Bill Evans', 'artists')).toBe('/?q=Bill+Evans&tab=artists');
		expect(buildSearchHref('  ', 'albums')).toBe('/');
	});

	it('creates and restores normalized cache snapshots', () => {
		const snapshot = createSuggestionsSnapshot({
			localArtists: [],
			localAlbums: [],
			scannedAt: 123,
			seedArtists: [],
			smartArtists: [],
			smartAlbums: [],
			localError: null,
			smartError: 'temporary',
			suggestionSeed: 99,
			smartGeneratedAt: 456
		} satisfies SuggestionsState);

		expect(parseSuggestionsSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
		expect(parseSuggestionsSnapshot(JSON.stringify({ foo: 'bar' }))).toBeNull();
	});
});
