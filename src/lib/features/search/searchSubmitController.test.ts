import { describe, expect, it } from 'vitest';
import {
	isSearchSubmitDisabled,
	resolveSearchSubmitLabel,
	resolveSearchSubmitMode
} from './searchSubmitController';

describe('searchSubmitController', () => {
	it('uses stop-and-search mode when a search is in progress and the query is present', () => {
		expect(resolveSearchSubmitMode('miles davis', true)).toBe('stop_and_search');
		expect(resolveSearchSubmitLabel('stop_and_search')).toBe('Stop & Search');
		expect(isSearchSubmitDisabled('miles davis', true)).toBe(false);
	});

	it('uses stop mode when a search is in progress and the query is empty', () => {
		expect(resolveSearchSubmitMode('   ', true)).toBe('stop');
		expect(resolveSearchSubmitLabel('stop')).toBe('Stop');
		expect(isSearchSubmitDisabled('   ', true)).toBe(false);
	});

	it('uses plain search mode when idle', () => {
		expect(resolveSearchSubmitMode('nirvana', false)).toBe('search');
		expect(resolveSearchSubmitLabel('search')).toBe('Search');
		expect(isSearchSubmitDisabled('   ', false)).toBe(true);
		expect(isSearchSubmitDisabled('nirvana', false)).toBe(false);
	});
});
