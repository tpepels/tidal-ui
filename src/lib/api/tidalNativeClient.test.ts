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
});
