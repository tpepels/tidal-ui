import { describe, expect, it, vi } from 'vitest';
import { fetchTrackBlobPayload, type TrackBlobDeps } from './trackBlob';
import type { AudioQuality, Track, TrackInfo, TrackLookup } from '../types';

const baseTrack = (trackId: number, quality: AudioQuality): Track => ({
	id: trackId,
	title: 'Test Track',
	duration: 180,
	version: null,
	popularity: 0,
	editable: false,
	explicit: false,
	trackNumber: 1,
	volumeNumber: 1,
	url: 'https://example.com',
	audioQuality: quality,
	audioModes: ['STEREO'],
	allowStreaming: true,
	streamReady: true,
	premiumStreamingOnly: false,
	artist: { id: 1, name: 'Test Artist', type: 'MAIN' },
	artists: [{ id: 1, name: 'Test Artist', type: 'MAIN' }],
	album: { id: 1, title: 'Test Album', cover: '', videoCover: null }
});

const baseInfo = (
	trackId: number,
	quality: AudioQuality,
	assetPresentation: string = 'FULL'
): TrackInfo => ({
	trackId,
	audioQuality: quality,
	audioMode: 'STEREO',
	manifest: btoa('not-a-stream-url'),
	manifestMimeType: 'audio/flac',
	assetPresentation
});

const buildLookup = (params: {
	trackId: number;
	quality: AudioQuality;
	assetPresentation?: string;
}): TrackLookup => ({
	track: baseTrack(params.trackId, params.quality),
	info: baseInfo(params.trackId, params.quality, params.assetPresentation)
});

function buildDeps(overrides: Partial<TrackBlobDeps> = {}): TrackBlobDeps {
	return {
		resolveTrackLookups: vi.fn(async (trackId: number, quality: AudioQuality) => {
			const lookup = buildLookup({ trackId, quality });
			return { manifestLookup: lookup, metadataLookup: lookup, manifestQuality: quality };
		}),
		fetch: vi.fn(),
		decodeBase64Manifest: vi.fn((manifest: string) => atob(manifest)),
		downloadFlacFromMpd: vi.fn(),
		extractStreamUrlFromManifest: vi.fn(() => null),
		getTrack: vi.fn(async (trackId: number, quality: AudioQuality) =>
			buildLookup({ trackId, quality })
		),
		lookupMusicBrainzTags: vi.fn(),
		embedMetadataIntoBlob: vi.fn(),
		rateLimitErrorMessage: 'Rate limited',
		...overrides
	};
}

describe('fetchTrackBlobPayload', () => {
	it('rejects preview clips before fetching browser download bytes', async () => {
		const previewLookup = buildLookup({
			trackId: 42,
			quality: 'LOSSLESS',
			assetPresentation: 'PREVIEW'
		});
		const deps = buildDeps({
			resolveTrackLookups: vi.fn(async () => ({
				manifestLookup: previewLookup,
				metadataLookup: previewLookup,
				manifestQuality: 'LOSSLESS' as AudioQuality
			}))
		});

		await expect(
			fetchTrackBlobPayload({
				trackId: 42,
				quality: 'LOSSLESS',
				filename: 'Test Track.flac',
				deps
			})
		).rejects.toThrow('preview clip');

		expect(deps.fetch).not.toHaveBeenCalled();
	});

	it('rejects preview clips returned by the lossless fallback lookup', async () => {
		const hiResLookup = buildLookup({ trackId: 42, quality: 'HI_RES_LOSSLESS' });
		const losslessPreviewLookup = buildLookup({
			trackId: 42,
			quality: 'LOSSLESS',
			assetPresentation: 'PREVIEW'
		});
		const deps = buildDeps({
			resolveTrackLookups: vi.fn(async () => ({
				manifestLookup: hiResLookup,
				metadataLookup: hiResLookup,
				manifestQuality: 'HI_RES_LOSSLESS' as AudioQuality
			})),
			getTrack: vi.fn(async () => losslessPreviewLookup)
		});

		await expect(
			fetchTrackBlobPayload({
				trackId: 42,
				quality: 'HI_RES_LOSSLESS',
				filename: 'Test Track.flac',
				deps
			})
		).rejects.toThrow('preview clip');

		expect(deps.getTrack).toHaveBeenCalledWith(42, 'LOSSLESS');
		expect(deps.fetch).not.toHaveBeenCalled();
	});
});
