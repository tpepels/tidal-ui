import { detectAudioFormatFromBlob } from '../utils/audioFormat';
import { isSegmentedDashManifest } from './manifest';
import type { AudioQuality, Track, TrackLookup } from '../types';
import type { DownloadTrackOptions } from '../apiClient';

export interface TrackBlobDeps {
	resolveTrackLookups: (
		trackId: number,
		quality: AudioQuality
	) => Promise<{
		manifestLookup: TrackLookup;
		metadataLookup: TrackLookup;
		manifestQuality: AudioQuality;
	}>;
	fetch: (url: string, init?: RequestInit) => Promise<Response>;
	decodeBase64Manifest: (manifest: string) => string;
	downloadFlacFromMpd: (
		manifestText: string,
		options?: DownloadTrackOptions
	) => Promise<{ blob: Blob; mimeType: string } | null>;
	extractStreamUrlFromManifest: (manifest: string) => string | null;
	getTrack: (trackId: number, quality: AudioQuality) => Promise<TrackLookup>;
	lookupMusicBrainzTags: (
		track: Track,
		signal?: AbortSignal,
		strictMusicBrainzMatching?: boolean,
		musicBrainzReleaseId?: string
	) => Promise<Record<string, string> | undefined>;
	embedMetadataIntoBlob: (
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType: string | null,
		options: DownloadTrackOptions | undefined,
		quality: AudioQuality,
		convertToMp3: boolean,
		extraMetadataTags?: Record<string, string>
	) => Promise<Blob | null>;
	rateLimitErrorMessage: string;
}

export async function fetchTrackBlobPayload(params: {
	trackId: number;
	quality: AudioQuality;
	filename: string;
	options?: DownloadTrackOptions;
	deps: TrackBlobDeps;
}): Promise<{ blob: Blob; mimeType?: string }> {
	const { trackId, quality, filename, options, deps } = params;

	try {
		const {
			manifestLookup,
			metadataLookup: initialMetadataLookup,
			manifestQuality
		} = await deps.resolveTrackLookups(trackId, quality);
		let metadataLookup = initialMetadataLookup;
		let response: Response | null = null;
		let streamUrl: string | null = null;
		let downloadBlob: Blob | null = null;
		let contentType: string | null = null;
		let receivedBytes = 0;
		let totalBytes: number | undefined;

		streamUrl = manifestLookup.originalTrackUrl || null;
		if (streamUrl) {
			response = await deps.fetch(streamUrl, { signal: options?.signal });
			if (response.status === 429) {
				throw new Error(deps.rateLimitErrorMessage);
			}
			if (!response.ok) {
				console.warn('OriginalTrackUrl download failed, falling back to manifest', {
					status: response.status
				});
				response = null;
			}
		}

		if (!response) {
			let manifestSource = manifestLookup;
			const decodedManifest = deps.decodeBase64Manifest(manifestSource.info.manifest);

			if (isSegmentedDashManifest(decodedManifest)) {
				try {
					const mpdResult = await deps.downloadFlacFromMpd(decodedManifest, options);
					if (mpdResult) {
						downloadBlob = mpdResult.blob;
						contentType = mpdResult.mimeType;
						receivedBytes = downloadBlob.size;
						totalBytes = downloadBlob.size;
						metadataLookup = manifestSource;
					}
				} catch (mpdError) {
					console.warn('Failed to download FLAC from MPD manifest', mpdError);
				}

				if (!downloadBlob) {
					throw new Error('Could not download segmented DASH content');
				}
			} else {
				let fallbackUrl = deps.extractStreamUrlFromManifest(manifestSource.info.manifest);
				if (!fallbackUrl && manifestQuality !== 'LOSSLESS') {
					try {
						const losslessLookup = await deps.getTrack(trackId, 'LOSSLESS');
						const candidateUrl = deps.extractStreamUrlFromManifest(losslessLookup.info.manifest);
						if (candidateUrl) {
							fallbackUrl = candidateUrl;
							manifestSource = losslessLookup;
						}
					} catch (manifestError) {
						console.warn(
							'Failed to fetch lossless manifest for download fallback',
							manifestError
						);
					}
				}

				if (fallbackUrl) {
					streamUrl = fallbackUrl;
					response = await deps.fetch(fallbackUrl, { signal: options?.signal });
					if (response.status === 429) {
						throw new Error(deps.rateLimitErrorMessage);
					}
					if (!response.ok) {
						throw new Error('Failed to fetch audio stream');
					}
					metadataLookup = manifestSource;
				} else {
					throw new Error('Could not extract stream URL from manifest');
				}
			}
		}

		if (response) {
			const totalHeader = Number(response.headers.get('Content-Length') ?? '0');
			totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;

			if (!response.body || typeof response.body.getReader !== 'function') {
				downloadBlob = await response.blob();
				receivedBytes = downloadBlob.size;
				if (!totalBytes && receivedBytes > 0) {
					options?.onProgress?.({
						stage: 'downloading',
						receivedBytes,
						totalBytes: receivedBytes
					});
				}
			} else {
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) {
						receivedBytes += value.byteLength;
						chunks.push(value);
						options?.onProgress?.({
							stage: 'downloading',
							receivedBytes,
							totalBytes
						});
					}
				}
				downloadBlob = new Blob(chunks as BlobPart[], {
					type: response.headers.get('Content-Type') ?? 'application/octet-stream'
				});
				if (receivedBytes === 0) {
					receivedBytes = downloadBlob.size;
				}
			}

			contentType = response.headers.get('Content-Type');
		}

		options?.onProgress?.({
			stage: 'downloading',
			receivedBytes,
			totalBytes: totalBytes ?? downloadBlob?.size
		});

		if (!downloadBlob) {
			throw new Error('Download failed to produce audio payload');
		}

		const shouldConvertToMp3 =
			options?.convertAacToMp3 === true && (quality === 'HIGH' || quality === 'LOW');
		const shouldEmbedMetadata = options?.skipMetadataEmbedding !== true;
		const enableExperimentalMusicBrainz = options?.enableExperimentalMusicBrainz ?? true;
		let preferredMusicBrainzReleaseId = options?.musicBrainzReleaseId;
		if (!preferredMusicBrainzReleaseId && options?.musicBrainzReleaseIdPromise) {
			try {
				const deferredReleaseId = await options.musicBrainzReleaseIdPromise;
				preferredMusicBrainzReleaseId =
					typeof deferredReleaseId === 'string' && deferredReleaseId.trim().length > 0
						? deferredReleaseId.trim()
						: undefined;
			} catch {
				preferredMusicBrainzReleaseId = undefined;
			}
		}
		const experimentalTags =
			shouldEmbedMetadata && enableExperimentalMusicBrainz
				? await deps.lookupMusicBrainzTags(
						metadataLookup.track,
						options?.signal,
						options?.strictMusicBrainzMatching,
						preferredMusicBrainzReleaseId
					)
				: undefined;
		const processedBlob = !shouldEmbedMetadata
			? null
			: await deps.embedMetadataIntoBlob(
					downloadBlob,
					metadataLookup,
					filename,
					contentType,
					options,
					quality,
					shouldConvertToMp3,
					experimentalTags
				);
		const finalBlob = processedBlob ?? downloadBlob;

		const detectedFormat = await detectAudioFormatFromBlob(finalBlob).catch(() => null);
		const resolvedMimeType = detectedFormat?.mimeType ?? contentType ?? undefined;

		return { blob: finalBlob, mimeType: resolvedMimeType };
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw error;
		}
		if (error instanceof Error && error.message === deps.rateLimitErrorMessage) {
			throw error;
		}
		throw new Error(
			'Download failed. The stream URL may require a proxy. Please try streaming instead.'
		);
	}
}
