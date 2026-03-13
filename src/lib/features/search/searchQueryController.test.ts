import { describe, expect, it } from 'vitest';
import {
	buildSearchOrchestratorOptions,
	normalizeScopeSelection,
	parseStrictAlbumArtistMatchParam,
	resolveSearchExecutionScopes,
	resolveSearchUrlState,
	toggleSearchScope,
	type SearchExecutionScopes
} from './searchQueryController';

describe('searchQueryController', () => {
	it('normalizes scope selection with stable order and default fallback', () => {
		expect(normalizeScopeSelection(['playlists', 'albums', 'playlists'])).toEqual([
			'albums',
			'playlists'
		]);
		expect(normalizeScopeSelection([])).toEqual(['albums', 'artists']);
	});

	it('toggles scopes while keeping at least one default scope', () => {
		expect(toggleSearchScope(['albums', 'artists'], 'artists')).toEqual(['albums']);
		expect(toggleSearchScope(['albums'], 'albums')).toEqual(['albums', 'artists']);
		expect(toggleSearchScope(['albums'], 'tracks')).toEqual(['tracks', 'albums']);
	});

	it('resolves primary/aggregate scopes from selected scopes', () => {
		const scopes: SearchExecutionScopes = resolveSearchExecutionScopes(['artists', 'tracks']);
		expect(scopes).toEqual({
			primaryTab: 'tracks',
			aggregateTabs: ['tracks', 'artists']
		});
	});

	it('parses strict album-artist flags from query params', () => {
		expect(parseStrictAlbumArtistMatchParam('true')).toBe(true);
		expect(parseStrictAlbumArtistMatchParam('YES')).toBe(true);
		expect(parseStrictAlbumArtistMatchParam('1')).toBe(true);
		expect(parseStrictAlbumArtistMatchParam('off')).toBe(false);
		expect(parseStrictAlbumArtistMatchParam(null)).toBe(false);
	});

	it('resolves URL state and lookup key for query synchronization', () => {
		const url = new URL('https://app.local/search?q=voices&tab=albums&artist=bob%20dylan&strictArtist=on');
		expect(resolveSearchUrlState(url)).toEqual({
			queryParam: 'voices',
			resolvedTab: 'albums',
			artistParam: 'bob dylan',
			strictAlbumArtistMatch: true,
			lookupKey: 'voices::albums::bob dylan::strict'
		});
	});

	it('builds orchestrator options for aggregate and url modes', () => {
		expect(
			buildSearchOrchestratorOptions({
				region: 'us',
				showErrorToasts: true,
				targetTab: 'albums',
				artistFilter: ' Dylan ',
				strictAlbumArtistMatch: true,
				aggregateTabs: ['albums', 'artists'],
				isUrlQuery: false
			})
		).toEqual({
			region: 'us',
			showErrorToasts: true,
			albumArtistQuery: 'Dylan',
			strictAlbumArtistMatch: true,
			aggregateAllTabs: true,
			aggregateTabs: ['albums', 'artists']
		});

		expect(
			buildSearchOrchestratorOptions({
				region: 'eu',
				showErrorToasts: false,
				targetTab: 'artists',
				artistFilter: 'ignored',
				strictAlbumArtistMatch: true,
				aggregateTabs: ['artists', 'albums'],
				isUrlQuery: true
			})
		).toEqual({
			region: 'eu',
			showErrorToasts: false,
			albumArtistQuery: undefined,
			strictAlbumArtistMatch: undefined,
			aggregateAllTabs: false,
			aggregateTabs: undefined
		});
	});
});
