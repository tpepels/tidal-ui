export type SearchSubmitMode = 'search' | 'stop' | 'stop_and_search';

export function resolveSearchSubmitMode(
	query: string,
	isSearchInProgress: boolean
): SearchSubmitMode {
	const hasQuery = query.trim().length > 0;
	if (!isSearchInProgress) {
		return 'search';
	}
	return hasQuery ? 'stop_and_search' : 'stop';
}

export function resolveSearchSubmitLabel(mode: SearchSubmitMode): string {
	switch (mode) {
		case 'stop':
			return 'Stop';
		case 'stop_and_search':
			return 'Stop & Search';
		case 'search':
		default:
			return 'Search';
	}
}

export function isSearchSubmitDisabled(
	query: string,
	isSearchInProgress: boolean
): boolean {
	return resolveSearchSubmitMode(query, isSearchInProgress) === 'search' && query.trim().length === 0;
}
