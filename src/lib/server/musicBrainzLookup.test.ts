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

	it('prefers a user-selected release when available', async () => {
		const preferredReleaseId = '11111111-2222-4333-8444-555555555555';
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						recordings: [
							{
								id: 'recording-1',
								title: 'Autumn Leaves',
								score: 90,
								'artist-credit': [{ name: 'Sample Artist', artist: { id: 'artist-1' } }],
								releases: [
									{
										id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
										title: 'Album A',
										status: 'Official'
									},
									{
										id: preferredReleaseId,
										title: 'Album B',
										status: 'Official'
									}
								]
							}
						]
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					}
				)
			);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		const tags = await lookupMusicBrainzTagsForTrack(
			{
				title: 'Autumn Leaves',
				artist: { name: 'Sample Artist' },
				album: { title: 'Some Album' }
			},
			{ preferredReleaseId }
		);

		expect(tags.MUSICBRAINZ_ALBUMID).toBe(preferredReleaseId);
	});
});

describe('searchMusicBrainzReleases', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('returns release candidates sorted by best match first', async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					releases: [
						{
							id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
							title: 'Nearby Match',
							status: 'Bootleg',
							date: '2002-01-01',
							'artist-credit': [{ name: 'Another Artist' }]
						},
						{
							id: '11111111-2222-4333-8444-555555555555',
							title: 'Exact Match Album',
							status: 'Official',
							date: '2001-09-09',
							barcode: '1234567890123',
							'artist-credit': [{ name: 'Sample Artist' }]
						}
					]
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { searchMusicBrainzReleases } = await import('./musicBrainzLookup');
		const releases = await searchMusicBrainzReleases({
			albumTitle: 'Exact Match Album',
			artistName: 'Sample Artist',
			releaseDate: '2001-01-01',
			upc: '1234567890123'
		});

		expect(releases).toHaveLength(2);
		expect(releases[0]?.id).toBe('11111111-2222-4333-8444-555555555555');
		expect(releases[0]?.title).toBe('Exact Match Album');
	});
});
