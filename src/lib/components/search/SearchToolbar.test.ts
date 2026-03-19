import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	path.resolve(process.cwd(), 'src/lib/components/search/SearchToolbar.svelte'),
	'utf8'
);

describe('SearchToolbar source contract', () => {
	it('submits through the form submit handler so Enter and the primary button stay aligned', () => {
		expect(source).toContain('onsubmit={(event) =>');
		expect(source).toContain('event.preventDefault();');
		expect(source).toContain('onSubmit();');
	});

	it('keeps the query field, album artist filter, scope chips, and strict toggle in reading order', () => {
		const queryIndex = source.indexOf('id="catalog-search-input"');
		const artistFilterIndex = source.indexOf('id="album-artist-filter"');
		const scopeGroupIndex = source.indexOf('aria-label="Search sections"');
		const strictToggleIndex = source.indexOf('Strict album artist match');

		expect(queryIndex).toBeGreaterThan(-1);
		expect(artistFilterIndex).toBeGreaterThan(queryIndex);
		expect(scopeGroupIndex).toBeGreaterThan(artistFilterIndex);
		expect(strictToggleIndex).toBeGreaterThan(scopeGroupIndex);
	});
});
