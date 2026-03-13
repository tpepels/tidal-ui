import { downloadCoverSeparately } from './coverDownload';
import type { AudioQuality, TrackLookup } from '../types';
import type { DownloadTrackOptions } from '../apiClient';

type InferMimeFromExtension = (
	ext: string | null | undefined,
	fallbackType?: string
) => string | undefined;

export interface MetadataEmbeddingDeps {
	inferExtensionFromFilename: (filename: string) => string | null;
	inferExtensionFromMime: (mime?: string | null) => string | null;
	inferMimeFromExtension: InferMimeFromExtension;
	buildMetadataEntries: (
		lookup: TrackLookup,
		extraMetadata?: Record<string, string>
	) => Array<[string, string]>;
	getCoverUrl: (
		coverId: string,
		size: '1280' | '640' | '320' | '160' | '80',
		options?: { proxy?: boolean }
	) => string;
}

export async function runMetadataEmbeddingPipeline(params: {
	blob: Blob;
	lookup: TrackLookup;
	filename: string;
	contentType: string | undefined;
	options: DownloadTrackOptions | undefined;
	quality: AudioQuality;
	convertToMp3: boolean;
	extraMetadataTags?: Record<string, string>;
	deps: MetadataEmbeddingDeps;
}): Promise<Blob | null> {
	const { blob, lookup, filename, contentType, options, quality, convertToMp3, extraMetadataTags, deps } =
		params;

	if (typeof window === 'undefined') {
		return null;
	}

	const extensionFromMime = deps.inferExtensionFromMime(contentType);
	const extensionFromFilename = deps.inferExtensionFromFilename(filename);
	const extension = extensionFromMime ?? extensionFromFilename;

	if (!extension) {
		return null;
	}

	const supportedExtensions = new Set(['flac', 'mp3', 'm4a', 'aac', 'wav', 'ogg']);
	if (!supportedExtensions.has(extension)) {
		return null;
	}

	const convertibleExtensions = new Set(['m4a', 'aac', 'mp4']);
	const shouldConvertToMp3 = convertToMp3 && convertibleExtensions.has(extension);
	const outputExtension = shouldConvertToMp3 ? 'mp3' : extension;
	const targetBitrate = quality === 'LOW' ? '96k' : '320k';

	let ffmpegModule: typeof import('../ffmpegClient') | null = null;
	try {
		ffmpegModule = await import('../ffmpegClient');
	} catch (error) {
		console.warn('Unable to load FFmpeg client module', error);
		options?.onFfmpegError?.(error);
		return null;
	}

	if (!ffmpegModule.isFFmpegSupported()) {
		return null;
	}

	if (options?.onFfmpegCountdown) {
		try {
			const estimatedBytes = await ffmpegModule.estimateFfmpegDownloadSize?.();
			options.onFfmpegCountdown({
				totalBytes: estimatedBytes,
				autoTriggered: options.ffmpegAutoTriggered ?? false
			});
		} catch (estimateError) {
			console.debug('Failed to estimate FFmpeg size', estimateError);
			options.onFfmpegCountdown({
				totalBytes: undefined,
				autoTriggered: options.ffmpegAutoTriggered ?? false
			});
		}
	}

	options?.onFfmpegStart?.();

	let ffmpeg: Awaited<ReturnType<typeof ffmpegModule.getFFmpeg>>;
	let progressHandler: ((data: { progress: number }) => void) | null = null;

	try {
		const loadOptions: Parameters<typeof ffmpegModule.getFFmpeg>[0] = {
			signal: options?.signal,
			onProgress: ({
				receivedBytes,
				totalBytes
			}: {
				receivedBytes: number;
				totalBytes?: number;
			}) => {
				if (totalBytes && totalBytes > 0) {
					options?.onProgress?.({
						stage: 'embedding',
						progress: Math.max(0, Math.min(1, receivedBytes / totalBytes))
					});
				} else if (receivedBytes > 0) {
					options?.onProgress?.({ stage: 'embedding', progress: 0 });
				}
			}
		};
		ffmpeg = await ffmpegModule.getFFmpeg(loadOptions);

		progressHandler = ({ progress }: { progress: number }) => {
			if (options?.onProgress && progress >= 0) {
				options.onProgress({ stage: 'embedding', progress: Math.min(1, progress) });
			}
		};
		ffmpeg.on('progress', progressHandler);

		options?.onFfmpegProgress?.(1);
		options?.onFfmpegComplete?.();
	} catch (loadError) {
		options?.onFfmpegError?.(loadError);
		throw loadError;
	}

	const uniqueSuffix =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	const inputName = `source-${uniqueSuffix}.${extension}`;
	const outputName = `output-${uniqueSuffix}.${outputExtension}`;

	const coverWritten = false;
	const coverExtension = 'jpg';
	const finalCoverName = `cover-${uniqueSuffix}.${coverExtension}`;

	try {
		if (options?.onProgress) {
			options.onProgress({ stage: 'embedding', progress: 0 });
		}

		const arrayBuffer = await blob.arrayBuffer();
		const uint8Array = new Uint8Array(arrayBuffer);
		await ffmpeg.writeFile(inputName, uint8Array);

		const artworkId = lookup.track.album?.cover;
		if (artworkId && options?.downloadCoverSeperately) {
			await downloadCoverSeparately({
				coverId: artworkId,
				getCoverUrl: (coverId, size) => deps.getCoverUrl(coverId, size)
			});
		}

		const args: string[] = ['-i', inputName];
		if (coverWritten) {
			args.push('-i', finalCoverName);
		}

		if (coverWritten) {
			args.push('-map', '0:a');
			args.push('-map', '1');
		} else {
			args.push('-map', '0:a');
		}

		if (shouldConvertToMp3) {
			args.push('-codec:a', 'libmp3lame');
			args.push('-b:a', targetBitrate);
		} else {
			args.push('-codec', 'copy');
		}

		for (const [key, value] of deps.buildMetadataEntries(lookup, extraMetadataTags)) {
			args.push('-metadata', `${key}=${value}`);
		}

		if (coverWritten) {
			args.push('-metadata:s:v', 'title=Album cover');
			args.push('-metadata:s:v', 'comment=Cover (front)');
			args.push('-disposition:v', 'attached_pic');
		}

		if (shouldConvertToMp3) {
			args.push('-id3v2_version', '3');
			args.push('-write_xing', '0');
		}

		args.push(outputName);

		const timeoutMs = 180000;
		const execPromise = ffmpeg.exec(args);
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(
					new Error(
						'FFmpeg execution timeout - processing took longer than 3 minutes. Try using "Download covers separately" option instead.'
					)
				);
			}, timeoutMs);
		});

		try {
			await Promise.race([execPromise, timeoutPromise]);
		} catch (execError) {
			const errorMessage = execError instanceof Error ? execError.message : String(execError);
			if (errorMessage.includes('timeout')) {
				throw new Error(
					'FFmpeg timeout: Processing took too long. Enable "Download covers separately" option for FLAC files.'
				);
			}

			if (
				errorMessage.includes('memory access out of bounds') ||
				errorMessage.includes('RuntimeError') ||
				errorMessage.includes('out of memory')
			) {
				throw new Error(
					'FFmpeg memory error: File may be too large for browser processing. Try a smaller file or download without metadata embedding.'
				);
			}

			throw execError;
		}

		const outputData = await ffmpeg.readFile(outputName);
		if (options?.onProgress) {
			options.onProgress({ stage: 'embedding', progress: 1 });
		}

		let outputArray: Uint8Array;
		if (outputData instanceof Uint8Array) {
			outputArray = outputData;
		} else if (typeof outputData === 'string') {
			outputArray = new TextEncoder().encode(outputData);
		} else {
			outputArray = new Uint8Array((outputData as unknown as ArrayBuffer) ?? new ArrayBuffer(0));
		}

		const blobArray = new Uint8Array(outputArray);
		const mimeType = deps.inferMimeFromExtension(
			outputExtension,
			contentType ?? (blob.type && blob.type.length > 0 ? blob.type : undefined)
		);
		return new Blob([blobArray], { type: mimeType });
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (
			errorMessage.includes('memory access out of bounds') ||
			errorMessage.includes('RuntimeError') ||
			errorMessage.includes('out of memory') ||
			errorMessage.includes('memory error')
		) {
			options?.onFfmpegError?.(
				new Error('Memory error: File processed without metadata due to browser limitations')
			);
		} else {
			options?.onFfmpegError?.(error);
		}

		return null;
	} finally {
		if (progressHandler && ffmpeg) {
			ffmpeg.off('progress', progressHandler);
		}

		if (ffmpeg) {
			try {
				await ffmpeg.deleteFile(inputName);
			} catch (cleanupErr) {
				console.debug('Failed to delete FFmpeg input file', cleanupErr);
			}
			try {
				await ffmpeg.deleteFile(outputName);
			} catch (cleanupErr) {
				console.debug('Failed to delete FFmpeg output file', cleanupErr);
			}
			if (coverWritten) {
				try {
					const finalCoverFileName = `cover-${uniqueSuffix}.${coverExtension}`;
					await ffmpeg.deleteFile(finalCoverFileName);
				} catch (cleanupErr) {
					console.debug('Failed to delete FFmpeg cover file', cleanupErr);
				}
			}
		}
	}
}
