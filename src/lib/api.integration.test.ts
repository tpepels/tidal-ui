import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { losslessAPI } from './api';
import { TidalError } from './errors';

describe('API Integration Tests', () => {
	let consoleErrorSpy: MockInstance;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubEnv('QOBUZ_FALLBACK_ENABLED', 'false');
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	describe('LosslessAPI error handling', () => {
		it('throws error for invalid URLs', async () => {
			await expect(losslessAPI.importFromUrl('test-url')).rejects.toThrow();
			await expect(losslessAPI.importFromUrl('')).rejects.toThrow();
		});

		it('handles API errors gracefully', async () => {
			// These methods are implemented but may fail due to network/API issues
			await expect(losslessAPI.getDashManifest(123)).rejects.toThrow();
			await expect(losslessAPI.getDashManifestWithMetadata(123)).rejects.toThrow();
		});

		it('returns proper error types', async () => {
			try {
				await losslessAPI.importFromUrl('invalid-url');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
			}
		});
	});

	describe('getRecommendations', () => {
		it('returns a Track array on success', async () => {
			const mockTracks = [
				{ id: 1, title: 'Track 1', artists: [] },
				{ id: 2, title: 'Track 2', artists: [] }
			];
			const mockResponse = {
				version: '2.0',
				data: {
					limit: 10,
					offset: 0,
					totalNumberOfItems: 2,
					items: mockTracks.map((track) => ({ track, sources: ['TRACK_RADIO'] }))
				}
			};

			vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => mockResponse
			} as Response);

			const result = await losslessAPI.getRecommendations(123);
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe(1);
			expect(result[1].id).toBe(2);
		});

		it('throws when response is not ok', async () => {
			vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce({
				ok: false,
				status: 404,
				headers: new Headers()
			} as Response);

			await expect(losslessAPI.getRecommendations(123)).rejects.toThrow(
				'Failed to fetch track recommendations'
			);
		});

		it('throws when items are missing from response', async () => {
			vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ version: '2.0', data: { limit: 10, offset: 0, totalNumberOfItems: 0 } })
			} as Response);

			await expect(losslessAPI.getRecommendations(123)).rejects.toThrow('No recommendations found');
		});
	});

	describe('getTrack hi-res manifest resolution', () => {
		const trackMetadataPayload = {
			version: '2.10',
			data: {
				id: 123,
				title: 'Hi Res Track',
				duration: 180,
				artist: { id: 1, name: 'Test Artist', type: 'MAIN' },
				artists: [{ id: 1, name: 'Test Artist', type: 'MAIN' }],
				album: { id: 2, title: 'Test Album', cover: null, videoCover: null },
				trackNumber: 1,
				volumeNumber: 1,
				audioQuality: 'HI_RES_LOSSLESS',
				audioModes: ['STEREO'],
				allowStreaming: true,
				streamReady: true,
				premiumStreamingOnly: false
			}
		};

		it('uses trackManifests for HI_RES_LOSSLESS before legacy playbackinfo', async () => {
			const runtimeSpy = vi
				.spyOn(losslessAPI as any, 'isBrowserRuntime')
				.mockReturnValue(false);
			const fetchSpy = vi
				.spyOn(losslessAPI as any, 'fetch')
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							version: '2.10',
							data: {
								data: {
									id: '123',
									type: 'trackManifests',
									attributes: {
										trackPresentation: 'FULL',
										uri: 'https://im-fa.manifest.tidal.com/1/manifests/test.mpd',
										hash: 'manifest-hash',
										formats: ['FLAC_HIRES'],
										trackAudioNormalizationData: {
											replayGain: -7.5,
											peakAmplitude: 0.95
										}
									}
								}
							}
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					)
				)
				.mockResolvedValueOnce(
					new Response('<MPD mediaPresentationDuration="PT180S"></MPD>', {
						status: 200,
						headers: { 'content-type': 'application/dash+xml' }
					})
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify(trackMetadataPayload), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
				);

			try {
				const result = await losslessAPI.getTrack(123, 'HI_RES_LOSSLESS');

				expect(fetchSpy).toHaveBeenCalledTimes(3);
				expect(fetchSpy.mock.calls[0][0]).toContain('/trackManifests/?');
				expect(fetchSpy.mock.calls[0][0]).toContain('formats=FLAC_HIRES');
				expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/track/?'))).toBe(false);
				expect(result.info.audioQuality).toBe('HI_RES_LOSSLESS');
				expect(result.info.manifest).toContain('<MPD');
				expect(result.info.manifestMimeType).toBe('application/dash+xml');
				expect(result.info.trackReplayGain).toBe(-7.5);
			} finally {
				runtimeSpy.mockRestore();
				fetchSpy.mockRestore();
			}
		});

		it('fails exact HI_RES_LOSSLESS when trackManifests omits FLAC_HIRES', async () => {
			const runtimeSpy = vi
				.spyOn(losslessAPI as any, 'isBrowserRuntime')
				.mockReturnValue(false);
			const fetchSpy = vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						version: '2.10',
						data: {
							data: {
								id: '123',
								type: 'trackManifests',
								attributes: {
									trackPresentation: 'FULL',
									uri: 'https://im-fa.manifest.tidal.com/1/manifests/test.mpd',
									formats: ['FLAC']
								}
							}
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);

			try {
				await expect(losslessAPI.getTrack(123, 'HI_RES_LOSSLESS')).rejects.toThrow(
					'trackManifests response did not include required format FLAC_HIRES'
				);
				expect(fetchSpy).toHaveBeenCalledTimes(1);
				expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/track/?'))).toBe(false);
			} finally {
				runtimeSpy.mockRestore();
				fetchSpy.mockRestore();
			}
		});

		it('fails exact HI_RES_LOSSLESS with upstream previewReason when Qobuz is disabled', async () => {
			const runtimeSpy = vi
				.spyOn(losslessAPI as any, 'isBrowserRuntime')
				.mockReturnValue(false);
			const qobuzFetch = vi.fn();
			vi.stubGlobal('fetch', qobuzFetch);
			const fetchSpy = vi
				.spyOn(losslessAPI as any, 'fetch')
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							version: '2.10',
							data: {
								data: {
									id: '123',
									type: 'trackManifests',
									attributes: {
										trackPresentation: 'PREVIEW',
										previewReason: 'FULL_REQUIRES_SUBSCRIPTION',
										uri: 'https://im-fa.manifest.tidal.com/1/manifests/test.mpd',
										formats: ['FLAC_HIRES']
									}
								}
							}
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					)
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify(trackMetadataPayload), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
				);

			try {
				await expect(losslessAPI.getTrack(123, 'HI_RES_LOSSLESS')).rejects.toThrow(
					'previewReason: FULL_REQUIRES_SUBSCRIPTION'
				);
				expect(fetchSpy).toHaveBeenCalledTimes(1);
				expect(qobuzFetch).not.toHaveBeenCalled();
				expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/track/?'))).toBe(false);
			} finally {
				runtimeSpy.mockRestore();
				fetchSpy.mockRestore();
			}
		});

		it('uses Qobuz before trackManifests for an exact ISRC match', async () => {
			vi.stubEnv('QOBUZ_FALLBACK_ENABLED', 'true');
			const runtimeSpy = vi
				.spyOn(losslessAPI as any, 'isBrowserRuntime')
				.mockReturnValue(false);
			const qobuzUrl = 'https://streaming-qobuz-std.akamaized.net/file';
			const qobuzFetch = vi
				.fn()
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							success: true,
							data: {
								tracks: {
									items: [
										{
											id: 419577986,
											isrc: 'GBVNV2600046',
											title: 'Hi Res Track',
											duration: 180,
											streamable: true,
											hires_streamable: true,
											maximum_bit_depth: 24,
											maximum_sampling_rate: 48,
											audio_info: {
												replaygain_track_gain: -5.17,
												replaygain_track_peak: 0.975677
											},
											album: {
												title: 'Test Album'
											},
											performer: {
												name: 'Test Artist'
											}
										}
									]
								}
							}
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					)
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ success: true, data: { url: qobuzUrl } }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					})
				);
			vi.stubGlobal('fetch', qobuzFetch);
			const fetchSpy = vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						version: '2.10',
						data: {
							...trackMetadataPayload.data,
							isrc: 'GBVNV2600046'
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);

			try {
				const result = await losslessAPI.getTrack(123, 'HI_RES_LOSSLESS');

				expect(result.originalTrackUrl).toBe(qobuzUrl);
				expect(result.info.assetPresentation).toBe('FULL');
				expect(result.info.audioQuality).toBe('HI_RES_LOSSLESS');
				expect(result.info.bitDepth).toBe(24);
				expect(result.info.sampleRate).toBe(48000);
				expect(result.info.trackReplayGain).toBe(-5.17);
				expect(fetchSpy).toHaveBeenCalledTimes(1);
				expect(fetchSpy.mock.calls[0][0]).toContain('/info/?id=123');
				expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/track/?'))).toBe(false);
				expect(
					fetchSpy.mock.calls.some((call) => String(call[0]).includes('/trackManifests/?'))
				).toBe(false);
				expect(qobuzFetch).toHaveBeenCalledTimes(2);
				expect(String(qobuzFetch.mock.calls[0][0])).toContain('/api/get-music?q=GBVNV2600046');
				expect(String(qobuzFetch.mock.calls[1][0])).toContain(
					'/api/download-music?track_id=419577986&quality=27'
				);
			} finally {
				runtimeSpy.mockRestore();
				fetchSpy.mockRestore();
			}
		});

		it('does not fall back to legacy playbackinfo when trackManifests manifest URI fails', async () => {
			const runtimeSpy = vi
				.spyOn(losslessAPI as any, 'isBrowserRuntime')
				.mockReturnValue(false);
			const fetchSpy = vi
				.spyOn(losslessAPI as any, 'fetch')
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							version: '2.10',
							data: {
								data: {
									id: '123',
									type: 'trackManifests',
									attributes: {
										trackPresentation: 'FULL',
										uri: 'https://im-fa.manifest.tidal.com/1/manifests/test.mpd',
										formats: ['FLAC_HIRES']
									}
								}
							}
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					)
				)
				.mockResolvedValueOnce(
					new Response('manifest unavailable', {
						status: 502,
						headers: { 'content-type': 'text/plain' }
					})
				);

			try {
				await expect(losslessAPI.getTrack(123, 'HI_RES_LOSSLESS')).rejects.toThrow(
					'trackManifests lookup failed for HI_RES_LOSSLESS'
				);
				expect(fetchSpy.mock.calls[0][0]).toContain('/trackManifests/?');
				expect(fetchSpy.mock.calls[1][0]).toBe(
					'https://im-fa.manifest.tidal.com/1/manifests/test.mpd'
				);
				expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/track/?'))).toBe(false);
			} finally {
				runtimeSpy.mockRestore();
				fetchSpy.mockRestore();
			}
		});
	});

	describe('Error handling edge cases', () => {
		it('handles network errors gracefully', () => {
			const error = TidalError.networkError(new Error('Connection timeout'));
			expect(error.isRetryable).toBe(true);
			expect(error.code).toBe('NETWORK_ERROR');
		});

		it('handles validation errors', () => {
			const error = TidalError.validationError('Invalid quality');
			expect(error.statusCode).toBe(400);
			expect(error.isRetryable).toBe(false);
		});
	});
});
