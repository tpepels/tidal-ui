import { describe, expect, it } from 'vitest';
import {
	buildSectionHashUrl,
	normalizeSectionId,
	resolveHashSectionId,
	shouldSkipInitialSectionHashSync
} from './pageSectionNavState';

describe('pageSectionNavState', () => {
	it('normalizes section ids from raw hashes and text', () => {
		expect(normalizeSectionId('# album-actions ')).toBe('album-actions');
		expect(normalizeSectionId('artist-metadata')).toBe('artist-metadata');
		expect(normalizeSectionId('')).toBe('');
	});

	it('resolves only known hash targets', () => {
		expect(resolveHashSectionId('#album-actions', ['album-actions', 'album-tracks'])).toBe(
			'album-actions'
		);
		expect(resolveHashSectionId('#unknown', ['album-actions', 'album-tracks'])).toBe('');
		expect(resolveHashSectionId('', ['album-actions'])).toBe('');
	});

	it('builds stable same-page hash urls', () => {
		expect(
			buildSectionHashUrl(
				{ pathname: '/album/12', search: '?view=full' } as Pick<Location, 'pathname' | 'search'>,
				'album-tracks'
			)
		).toBe('/album/12?view=full#album-tracks');
		expect(
			buildSectionHashUrl(
				{ pathname: '/album/12', search: '' } as Pick<Location, 'pathname' | 'search'>,
				''
			)
		).toBe('/album/12');
	});

	it('skips hash sync for the initial un-hashed first section only', () => {
		expect(
			shouldSkipInitialSectionHashSync({
				lastObservedId: '',
				currentHash: '',
				nextId: 'album-actions',
				firstVisibleId: 'album-actions'
			})
		).toBe(true);

		expect(
			shouldSkipInitialSectionHashSync({
				lastObservedId: 'album-actions',
				currentHash: '',
				nextId: 'album-metadata',
				firstVisibleId: 'album-actions'
			})
		).toBe(false);

		expect(
			shouldSkipInitialSectionHashSync({
				lastObservedId: '',
				currentHash: '#album-metadata',
				nextId: 'album-metadata',
				firstVisibleId: 'album-actions'
			})
		).toBe(false);
	});
});
