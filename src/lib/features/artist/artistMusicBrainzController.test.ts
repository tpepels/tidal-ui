import { describe, expect, it, vi } from 'vitest';
import {
	formatMusicBrainzArtistLifeSpan,
	normalizeArtistToken,
	pickDefaultMusicBrainzArtistId,
	searchMusicBrainzArtistsByName
} from './artistMusicBrainzController';

describe('artistMusicBrainzController', () => {
	it('normalizes artist tokens for matching', () => {
		expect(normalizeArtistToken('Björk Guðmundsdóttir')).toBe('bjork gu mundsdottir');
		expect(normalizeArtistToken('  Bob   Dylan  ')).toBe('bob dylan');
	});

	it('formats life span fields for display', () => {
		expect(
			formatMusicBrainzArtistLifeSpan({
				id: 'a1',
				lifeSpanBegin: '1962',
				lifeSpanEnd: '2020'
			})
		).toBe('1962 - 2020');
		expect(
			formatMusicBrainzArtistLifeSpan({
				id: 'a2',
				lifeSpanBegin: '1962'
			})
		).toBe('1962 - present');
		expect(formatMusicBrainzArtistLifeSpan({ id: 'a3' })).toBeNull();
	});

	it('picks default artist id using exact then partial then fallback matching', () => {
		expect(
			pickDefaultMusicBrainzArtistId(
				[
					{ id: 'x', name: 'Bob Dylan Tribute' },
					{ id: 'y', name: 'Bob Dylan' }
				],
				'Bob Dylan'
			)
		).toBe('y');
		expect(
			pickDefaultMusicBrainzArtistId(
				[
					{ id: 'x', name: 'The Beatles' },
					{ id: 'y', name: 'Beatles Cover Band' }
				],
				'Beatles'
			)
		).toBe('x');
		expect(pickDefaultMusicBrainzArtistId([{ id: 'x', name: 'Unknown Artist' }], '')).toBe('x');
	});

	it('searches and returns only valid-id artist candidates', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				artists: [{ id: 'mb1', name: 'Artist 1' }, { id: '', name: 'Invalid' }, { name: 'No id' }]
			})
		});

		const result = await searchMusicBrainzArtistsByName('Artist 1', {
			fetchImpl: fetchImpl as unknown as typeof fetch
		});

		expect(result).toEqual([{ id: 'mb1', name: 'Artist 1' }]);
	});

	it('throws on API failures', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ success: false, error: 'rate limited' })
		});

		await expect(
			searchMusicBrainzArtistsByName('Artist', {
				fetchImpl: fetchImpl as unknown as typeof fetch
			})
		).rejects.toThrow('rate limited');
	});
});
