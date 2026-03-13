import type { SearchOrchestratorOptions } from '$lib/orchestrators/searchOrchestrator';
import type { RegionOption } from '$lib/stores/region';
import type { SearchTab } from '$lib/stores/searchStoreAdapter';

export const SEARCH_TABS: SearchTab[] = ['tracks', 'albums', 'artists', 'playlists'];
const DEFAULT_SCOPES: SearchTab[] = ['albums', 'artists'];

export type SearchExecutionScopes = {
	primaryTab: SearchTab;
	aggregateTabs: SearchTab[];
};

export type SearchUrlState = {
	queryParam: string;
	resolvedTab: SearchTab | null;
	artistParam: string;
	strictAlbumArtistMatch: boolean;
	lookupKey: string;
};

type BuildSearchOrchestratorOptionsArgs = {
	region: RegionOption;
	showErrorToasts: boolean;
	targetTab: SearchTab;
	artistFilter: string;
	strictAlbumArtistMatch: boolean;
	aggregateTabs: SearchTab[];
	isUrlQuery: boolean;
};

export function isSearchTab(value: string | null): value is SearchTab {
	return !!value && SEARCH_TABS.includes(value as SearchTab);
}

export function normalizeScopeSelection(scopes: SearchTab[]): SearchTab[] {
	const selected = scopes.filter((scope, index) => scopes.indexOf(scope) === index);
	const ordered = SEARCH_TABS.filter((tab) => selected.includes(tab));
	return ordered.length > 0 ? ordered : DEFAULT_SCOPES;
}

export function toggleSearchScope(scopes: SearchTab[], scope: SearchTab): SearchTab[] {
	const selected = normalizeScopeSelection(scopes);
	if (selected.includes(scope)) {
		return normalizeScopeSelection(selected.filter((tab) => tab !== scope));
	}
	return normalizeScopeSelection([...selected, scope]);
}

export function resolveSearchExecutionScopes(scopes: SearchTab[]): SearchExecutionScopes {
	const aggregateTabs = normalizeScopeSelection(scopes);
	const primaryTab = aggregateTabs[0] ?? 'albums';
	return { primaryTab, aggregateTabs };
}

export function parseStrictAlbumArtistMatchParam(value: string | null): boolean {
	const normalized = value?.trim().toLowerCase() ?? '';
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function resolveSearchUrlState(url: URL): SearchUrlState {
	const queryParam = (url.searchParams.get('q') ?? '').trim();
	const tabParam = url.searchParams.get('tab');
	const artistParam = (url.searchParams.get('artist') ?? '').trim();
	const strictAlbumArtistMatch = parseStrictAlbumArtistMatchParam(url.searchParams.get('strictArtist'));
	const resolvedTab = isSearchTab(tabParam) ? tabParam : null;
	const lookupKey = `${queryParam}::${resolvedTab ?? ''}::${artistParam}::${
		strictAlbumArtistMatch ? 'strict' : 'relaxed'
	}`;

	return {
		queryParam,
		resolvedTab,
		artistParam,
		strictAlbumArtistMatch,
		lookupKey
	};
}

export function buildSearchOrchestratorOptions(
	args: BuildSearchOrchestratorOptionsArgs
): SearchOrchestratorOptions {
	return {
		region: args.region,
		showErrorToasts: args.showErrorToasts,
		albumArtistQuery: args.targetTab === 'albums' ? args.artistFilter.trim() : undefined,
		strictAlbumArtistMatch:
			args.targetTab === 'albums' ? args.strictAlbumArtistMatch : undefined,
		aggregateAllTabs: !args.isUrlQuery && args.aggregateTabs.length > 1,
		aggregateTabs: !args.isUrlQuery ? args.aggregateTabs : undefined
	};
}
