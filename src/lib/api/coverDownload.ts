export type CoverImageFormat = { extension: string; mimeType: string };
type CoverSize = '1280' | '640' | '320';

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
	if (typeof AbortSignal === 'undefined') {
		return undefined;
	}
	const timeoutFn = (AbortSignal as typeof AbortSignal & {
		timeout?: (ms: number) => AbortSignal;
	}).timeout;
	if (typeof timeoutFn !== 'function') {
		return undefined;
	}
	return timeoutFn(timeoutMs);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = objectUrl;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(objectUrl);
}

export function validateImageData(data: Uint8Array): boolean {
	if (!data || data.length < 4) {
		return false;
	}

	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
		return true;
	}

	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
		return true;
	}

	if (
		data.length >= 12 &&
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return true;
	}

	return false;
}

export function detectImageFormat(data: Uint8Array): CoverImageFormat | null {
	if (!data || data.length < 4) {
		return null;
	}

	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
		return { extension: 'jpg', mimeType: 'image/jpeg' };
	}

	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
		return { extension: 'png', mimeType: 'image/png' };
	}

	if (
		data.length >= 12 &&
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return { extension: 'webp', mimeType: 'image/webp' };
	}

	return null;
}

function buildFetchOptions(strategyName: 'with-headers' | 'simple'): RequestInit {
	const base: RequestInit = { method: 'GET' };
	if (strategyName === 'with-headers') {
		base.headers = {
			Accept: 'image/jpeg,image/jpg,image/png,image/*',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
		};
	}
	const signal = createTimeoutSignal(10000);
	if (signal) {
		base.signal = signal;
	}
	return base;
}

export async function downloadCoverSeparately(options: {
	coverId: string;
	getCoverUrl: (coverId: string, size: CoverSize) => string;
	fetchFn?: typeof fetch;
	logger?: Pick<Console, 'log' | 'warn'>;
	validate?: (data: Uint8Array) => boolean;
	detect?: (data: Uint8Array) => CoverImageFormat | null;
}): Promise<boolean> {
	const {
		coverId,
		getCoverUrl,
		fetchFn = fetch,
		logger = console,
		validate = validateImageData,
		detect = detectImageFormat
	} = options;

	const coverSizes: CoverSize[] = ['1280', '640', '320'];
	const fetchStrategies: Array<'with-headers' | 'simple'> = ['with-headers', 'simple'];

	for (const size of coverSizes) {
		const coverUrl = getCoverUrl(coverId, size);
		if (!coverUrl) {
			continue;
		}
		logger.log(`[Cover Download] Attempting size ${size}:`, coverUrl);

		for (const strategy of fetchStrategies) {
			logger.log(`[Cover Download] Trying strategy: ${strategy}`);
			try {
				const response = await fetchFn(coverUrl, buildFetchOptions(strategy));

				logger.log(
					`[Cover Download] Response status: ${response.status}, Content-Length: ${response.headers.get('Content-Length')}`
				);

				if (!response.ok) {
					logger.warn(
						`[Cover Download] Failed with status ${response.status} for size ${size}`
					);
					continue;
				}

				const contentType = response.headers.get('Content-Type');
				const contentLength = response.headers.get('Content-Length');

				if (contentLength && parseInt(contentLength, 10) === 0) {
					logger.warn(`[Cover Download] Content-Length is 0 for size ${size}`);
					continue;
				}

				if (contentType && !contentType.startsWith('image/')) {
					logger.warn(`[Cover Download] Invalid content type: ${contentType}`);
					continue;
				}

				const arrayBuffer = await response.arrayBuffer();
				if (!arrayBuffer || arrayBuffer.byteLength === 0) {
					logger.warn(`[Cover Download] Empty array buffer for size ${size}`);
					continue;
				}

				const uint8Array = new Uint8Array(arrayBuffer);
				logger.log(`[Cover Download] Received ${uint8Array.length} bytes`);
				logger.log(
					`[Cover Download] First 16 bytes:`,
					Array.from(uint8Array.slice(0, 16))
						.map((value) => value.toString(16).padStart(2, '0'))
						.join(' ')
				);

				if (!validate(uint8Array)) {
					logger.warn(`[Cover Download] Invalid image data for size ${size}`);
					continue;
				}

				const imageFormat = detect(uint8Array);
				if (!imageFormat) {
					logger.warn(`[Cover Download] Unknown image format for size ${size}`);
					continue;
				}

				const blob = new Blob([uint8Array], { type: imageFormat.mimeType });
				triggerBlobDownload(blob, `cover.${imageFormat.extension}`);
				logger.log(
					`[Cover Download] Successfully downloaded (${size}x${size}, format: ${imageFormat.extension}, strategy: ${strategy})`
				);
				return true;
			} catch (error) {
				logger.warn(
					`[Cover Download] Failed at size ${size} with strategy ${strategy}:`,
					error
				);
			}
		}
	}

	logger.warn('[Cover Download] All attempts failed');
	return false;
}
