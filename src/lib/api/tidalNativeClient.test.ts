import { afterEach, describe, expect, it, vi } from 'vitest';

describe('tidalNativeClient', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('requests app tokens with Monochrome browser credentials in the form body', async () => {
		vi.resetModules();
		vi.stubEnv('TIDAL_NATIVE_API_ENABLED', 'true');
		const fetchMock = vi
			.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'native-token', expires_in: 3600 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 123,
						title: 'Native Track',
						duration: 180,
						artist: { id: 1, name: 'Native Artist', type: 'MAIN' },
						artists: [{ id: 1, name: 'Native Artist', type: 'MAIN' }],
						album: { id: 2, title: 'Native Album', cover: '', videoCover: null }
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);
		vi.stubGlobal('fetch', fetchMock);

		const { nativeGetTrackMetadata } = await import('./tidalNativeClient');
		const track = await nativeGetTrackMetadata(123);

		expect(track.title).toBe('Native Track');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [, tokenInit] = fetchMock.mock.calls[0];
		expect(tokenInit?.method).toBe('POST');
		expect((tokenInit?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
		const body = tokenInit?.body as URLSearchParams;
		expect(body.get('grant_type')).toBe('client_credentials');
		expect(body.get('client_id')).toBe('txNoH4kkV41MfH25');
		expect(body.get('client_secret')).toBe('dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=');
		const [, metadataInit] = fetchMock.mock.calls[1];
		expect((metadataInit?.headers as Record<string, string>).authorization).toBe(
			'Bearer native-token'
		);
	});

	it('paginates native album items instead of relying on one oversized page', async () => {
		vi.resetModules();
		vi.stubEnv('TIDAL_NATIVE_API_ENABLED', 'true');
		const pageOneItems = Array.from({ length: 100 }, (_, index) => ({
			item: {
				id: 1000 + index,
				title: `Track ${index + 1}`,
				duration: 180,
				trackNumber: index + 1,
				volumeNumber: 1
			}
		}));
		const pageTwoItems = [
			{
				item: {
					id: 1100,
					title: 'Track 101',
					duration: 180,
					trackNumber: 101,
					volumeNumber: 1
				}
			}
		];
		const fetchMock = vi
			.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'native-token', expires_in: 3600 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 77,
						title: 'Long Album',
						numberOfTracks: 101,
						cover: '',
						videoCover: null,
						artist: { id: 1, name: 'Native Artist', type: 'MAIN' },
						artists: [{ id: 1, name: 'Native Artist', type: 'MAIN' }]
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ items: pageOneItems }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ items: pageTwoItems }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);
		vi.stubGlobal('fetch', fetchMock);

		const { nativeGetAlbum } = await import('./tidalNativeClient');
		const result = await nativeGetAlbum(77);

		expect(result.tracks).toHaveLength(101);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		const firstItemsUrl = new URL(String(fetchMock.mock.calls[2][0]));
		const secondItemsUrl = new URL(String(fetchMock.mock.calls[3][0]));
		expect(firstItemsUrl.pathname).toBe('/v1/albums/77/items');
		expect(firstItemsUrl.searchParams.get('limit')).toBe('100');
		expect(firstItemsUrl.searchParams.get('offset')).toBe('0');
		expect(secondItemsUrl.searchParams.get('limit')).toBe('1');
		expect(secondItemsUrl.searchParams.get('offset')).toBe('100');
	});

	it('refreshes the app token once when a native resource request returns 401', async () => {
		vi.resetModules();
		vi.stubEnv('TIDAL_NATIVE_API_ENABLED', 'true');
		const fetchMock = vi
			.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'stale-token', expires_in: 3600 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'fresh-token', expires_in: 3600 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 123,
						title: 'Native Track',
						duration: 180,
						artist: { id: 1, name: 'Native Artist', type: 'MAIN' },
						artists: [{ id: 1, name: 'Native Artist', type: 'MAIN' }],
						album: { id: 2, title: 'Native Album', cover: '', videoCover: null }
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);
		vi.stubGlobal('fetch', fetchMock);

		const { nativeGetTrackMetadata } = await import('./tidalNativeClient');
		const track = await nativeGetTrackMetadata(123);

		expect(track.id).toBe(123);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).authorization).toBe(
			'Bearer stale-token'
		);
		expect((fetchMock.mock.calls[3]?.[1]?.headers as Record<string, string>).authorization).toBe(
			'Bearer fresh-token'
		);
	});

	it('requests native OpenAPI trackManifests with fixed exact-quality params', async () => {
		vi.resetModules();
		vi.stubEnv('TIDAL_NATIVE_API_ENABLED', 'true');
		const fetchMock = vi
			.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'native-token', expires_in: 3600 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: {
							id: '123',
							type: 'trackManifests',
							attributes: {
								formats: ['FLAC_HIRES'],
								trackPresentation: 'FULL',
								manifest: '<MPD></MPD>'
							}
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/vnd.api+json' } }
				)
			);
		vi.stubGlobal('fetch', fetchMock);

		const { nativeGetTrackManifestPayload } = await import('./tidalNativeClient');
		await nativeGetTrackManifestPayload(123, {
			formats: ['FLAC_HIRES'],
			adaptive: false
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const manifestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
		expect(manifestUrl.href).toContain('/v2/trackManifests/123');
		expect(manifestUrl.searchParams.get('adaptive')).toBe('false');
		expect(manifestUrl.searchParams.get('manifestType')).toBe('MPEG_DASH');
		expect(manifestUrl.searchParams.get('uriScheme')).toBe('HTTPS');
		expect(manifestUrl.searchParams.get('usage')).toBe('PLAYBACK');
		expect(manifestUrl.searchParams.getAll('formats')).toEqual(['FLAC_HIRES']);
		expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).accept).toContain(
			'application/vnd.api+json'
		);
	});

	it('rejects native album metadata when the item list is shorter than numberOfTracks', async () => {
		vi.resetModules();
		vi.stubEnv('TIDAL_NATIVE_API_ENABLED', 'true');
		const fetchMock = vi
			.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: 'native-token', expires_in: 3600 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 77,
						title: 'Short Album',
						numberOfTracks: 2,
						cover: '',
						videoCover: null,
						artist: { id: 1, name: 'Native Artist', type: 'MAIN' },
						artists: [{ id: 1, name: 'Native Artist', type: 'MAIN' }]
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [
							{
								item: {
									id: 1000,
									title: 'Track 1',
									duration: 180,
									trackNumber: 1,
									volumeNumber: 1
								}
							}
						]
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);
		vi.stubGlobal('fetch', fetchMock);

		const { nativeGetAlbum } = await import('./tidalNativeClient');

		await expect(nativeGetAlbum(77)).rejects.toThrow(
			'Native TIDAL album metadata returned 1/2 track item(s)'
		);
	});
});
