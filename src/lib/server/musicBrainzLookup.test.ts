import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('lookupMusicBrainzTagsForTrack', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('skips strict lookup when ISRC is invalid', async () => {
		const fetchSpy = vi.fn();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		const tags = await lookupMusicBrainzTagsForTrack(
			{
				title: 'Track',
				artist: { name: 'Artist' },
				isrc: 'INVALID-ISRC'
			},
			{ strictIsrcMatch: true }
		);

		expect(tags).toEqual({});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('falls back to query search when ISRC is invalid in flexible mode', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ recordings: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		const tags = await lookupMusicBrainzTagsForTrack({
			title: 'Track',
			artist: { name: 'Artist' },
			isrc: 'BAD'
		});

		expect(tags).toEqual({});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const firstUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
		expect(firstUrl).toContain('/recording?query=');
		expect(firstUrl).not.toContain('/isrc/');
	});

	it('normalizes valid ISRC values before request', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ recordings: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		const tags = await lookupMusicBrainzTagsForTrack(
			{
				title: 'Track',
				artist: { name: 'Artist' },
				isrc: 'US-ABC-24-00001'
			},
			{ strictIsrcMatch: true }
		);

		expect(tags).toEqual({});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const firstUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
		expect(firstUrl).toContain('/isrc/USABC2400001');
	});

	it('treats MusicBrainz HTTP 400 as non-fatal without warning noise', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(new Response('Bad request', { status: 400 }));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		const tags = await lookupMusicBrainzTagsForTrack({
			title: 'Track',
			artist: { name: 'Artist' }
		});

		expect(tags).toEqual({});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).not.toHaveBeenCalledWith(
			'[MusicBrainz] Metadata lookup failed:',
			expect.stringContaining('MusicBrainz HTTP 400')
		);
	});
});
