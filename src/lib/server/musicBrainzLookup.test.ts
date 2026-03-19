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
		const fetchSpy = vi.fn().mockResolvedValue(
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
		const fetchSpy = vi.fn().mockResolvedValue(
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
		const fetchSpy = vi.fn().mockResolvedValue(new Response('Bad request', { status: 400 }));
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

	it('retries transient upstream failures before returning no tags', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(new Response('Temporary failure', { status: 503 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ recordings: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		const tags = await lookupMusicBrainzTagsForTrack({
			title: 'Track',
			artist: { name: 'Artist' }
		});

		expect(tags).toEqual({});
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('does not cache lookup_failed results as no-match', async () => {
		const fetchSpy = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('network down'))
			.mockRejectedValueOnce(new TypeError('network down'))
			.mockRejectedValueOnce(new TypeError('network down'))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						recordings: [
							{
								id: 'recording-1',
								title: 'Track',
								'artist-credit': [{ name: 'Artist', artist: { id: 'artist-1', name: 'Artist' } }],
								releases: [
									{
										id: '11111111-2222-4333-8444-555555555555',
										title: 'Album',
										status: 'Official',
										'artist-credit': [
											{ name: 'Artist', artist: { id: 'artist-1', name: 'Artist' } }
										]
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
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzMetadataForTrack } = await import('./musicBrainzLookup');
		const firstResult = await lookupMusicBrainzMetadataForTrack({
			title: 'Track',
			artist: { name: 'Artist' },
			album: { title: 'Album' }
		});
		const secondResult = await lookupMusicBrainzMetadataForTrack({
			title: 'Track',
			artist: { name: 'Artist' },
			album: { title: 'Album' }
		});

		expect(firstResult.lookupStatus).toBe('lookup_failed');
		expect(secondResult.lookupStatus).toBe('matched');
		expect(secondResult.tags.MUSICBRAINZ_TRACKID).toBe('recording-1');
		expect(fetchSpy).toHaveBeenCalledTimes(4);
		expect(warnSpy).toHaveBeenCalled();
	});

	it('includes track and disc in cache keys to avoid cross-track collisions', async () => {
		const fetchSpy = vi.fn().mockImplementation(
			async () =>
				new Response(JSON.stringify({ recordings: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
		);
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

		const { lookupMusicBrainzTagsForTrack } = await import('./musicBrainzLookup');
		await lookupMusicBrainzTagsForTrack({
			title: 'Duplicate Title',
			artist: { name: 'Same Artist' },
			album: { title: 'Same Album' },
			trackNumber: 1,
			volumeNumber: 1
		});
		await lookupMusicBrainzTagsForTrack({
			title: 'Duplicate Title',
			artist: { name: 'Same Artist' },
			album: { title: 'Same Album' },
			trackNumber: 2,
			volumeNumber: 1
		});

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('uses selected release directly and skips flex recording lookup', async () => {
		const preferredReleaseId = '11111111-2222-4333-8444-555555555555';
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: preferredReleaseId,
					title: 'Album B',
					status: 'Official',
					country: 'US',
					barcode: '1234567890123',
					'artist-credit': [{ name: 'Sample Artist', artist: { id: 'artist-1' } }],
					'release-group': { id: 'release-group-1', 'primary-type': 'Album' },
					media: [
						{
							position: 1,
							'track-count': 2,
							tracks: [
								{
									number: '1',
									title: 'Autumn Leaves',
									recording: {
										id: 'recording-1',
										title: 'Autumn Leaves',
										isrcs: ['USABC2400001'],
										'artist-credit': [{ name: 'Sample Artist', artist: { id: 'artist-1' } }]
									}
								},
								{
									number: '2',
									title: 'Another Song',
									recording: { id: 'recording-2', title: 'Another Song' }
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
				isrc: 'US-ABC-24-00001',
				trackNumber: 1,
				album: { title: 'Some Album' }
			},
			{ preferredReleaseId }
		);

		expect(tags.MUSICBRAINZ_ALBUMID).toBe(preferredReleaseId);
		expect(tags.MUSICBRAINZ_TRACKID).toBe('recording-1');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const firstUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
		expect(firstUrl).toContain(`/release/${preferredReleaseId}`);
		expect(firstUrl).not.toContain('/recording?query=');
		expect(firstUrl).not.toContain('/isrc/');
	});

	it('returns structured match details alongside tags', async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					recordings: [
						{
							id: 'recording-1',
							title: 'Autumn Leaves',
							'artist-credit': [
								{ name: 'Sample Artist', artist: { id: 'artist-1', name: 'Sample Artist' } }
							],
							releases: [
								{
									id: '11111111-2222-4333-8444-555555555555',
									title: 'Portrait in Jazz',
									status: 'Official',
									date: '1960-12-01',
									country: 'US',
									barcode: '1234567890123',
									'artist-credit': [
										{
											name: 'Sample Artist',
											artist: { id: 'artist-1', name: 'Sample Artist' }
										}
									],
									'release-group': {
										id: 'release-group-1',
										title: 'Portrait in Jazz',
										'primary-type': 'Album',
										'secondary-types': ['Remaster']
									}
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

		const { lookupMusicBrainzMetadataForTrack } = await import('./musicBrainzLookup');
		const result = await lookupMusicBrainzMetadataForTrack({
			title: 'Autumn Leaves',
			artist: { name: 'Sample Artist' },
			album: { title: 'Portrait in Jazz' }
		});

		expect(result.lookupStatus).toBe('matched');
		expect(result.match?.recording.title).toBe('Autumn Leaves');
		expect(result.match?.release?.title).toBe('Portrait in Jazz');
		expect(result.match?.releaseGroup?.title).toBe('Portrait in Jazz');
		expect(result.match?.artists[0]?.name).toBe('Sample Artist');
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
							'track-count': 8,
							'artist-credit': [{ name: 'Another Artist' }]
						},
						{
							id: '11111111-2222-4333-8444-555555555555',
							title: 'Exact Match Album',
							status: 'Official',
							date: '2001-09-09',
							barcode: '1234567890123',
							'track-count': 12,
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
		expect(releases[0]?.trackCount).toBe(12);
		expect(releases[1]?.trackCount).toBe(8);
	});

	it('falls back to media track counts when top-level track-count is missing', async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					releases: [
						{
							id: '11111111-2222-4333-8444-555555555555',
							title: 'Media Count Album',
							status: 'Official',
							media: [{ 'track-count': 6 }, { 'track-count': 7 }],
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
			albumTitle: 'Media Count Album',
			artistName: 'Sample Artist'
		});

		expect(releases).toHaveLength(1);
		expect(releases[0]?.trackCount).toBe(13);
	});
});
