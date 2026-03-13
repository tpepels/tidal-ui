import type { Album } from '$lib/types';

export type ArtistFetchProgress = {
	receivedBytes: number;
	totalBytes?: number;
	percent?: number;
};

export type ArtistFetchOptions = {
	onProgress?: (progress: ArtistFetchProgress) => void;
	officialEnrichment?: boolean;
	officialOrigin?: string;
	signal?: AbortSignal;
};

type OfficialDiscographyResponse = {
	enabled?: boolean;
	albums?: Album[];
	error?: string;
	reason?: string;
	count?: number;
};

export type OfficialDiscographyFetchResult = {
	status: 'disabled' | 'error' | 'ok';
	albums: Album[];
	detail?: string;
};

export async function fetchOfficialDiscography(
	artistId: number,
	options?: ArtistFetchOptions
): Promise<OfficialDiscographyFetchResult> {
	if (!options?.officialEnrichment) {
		return { status: 'disabled', albums: [], detail: 'disabled' };
	}

	const origin = options.officialOrigin?.trim();
	if (!origin) {
		return { status: 'disabled', albums: [], detail: 'missing_origin' };
	}

	try {
		const response = await fetch(`${origin}/api/artist/${artistId}/official-discography`, {
			signal: options?.signal
		});
		if (!response.ok) {
			return { status: 'error', albums: [], detail: `http_${response.status}` };
		}
		const payload = (await response.json()) as OfficialDiscographyResponse;
		if (!payload.enabled) {
			return { status: 'disabled', albums: [], detail: payload.reason ?? 'not_enabled' };
		}
		if (!Array.isArray(payload.albums)) {
			return { status: 'error', albums: [], detail: 'malformed_payload' };
		}
		return { status: 'ok', albums: payload.albums };
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'fetch_failed';
		return { status: 'error', albums: [], detail };
	}
}

export async function readJsonWithProgress(
	response: Response,
	onProgress?: (progress: ArtistFetchProgress) => void
): Promise<unknown> {
	if (!onProgress) {
		return response.json();
	}
	if (!response.body || typeof response.body.getReader !== 'function') {
		const text = await response.text();
		const receivedBytes = new TextEncoder().encode(text).byteLength;
		if (receivedBytes > 0) {
			onProgress({ receivedBytes, totalBytes: receivedBytes, percent: 1 });
		}
		return text ? JSON.parse(text) : null;
	}

	const contentLength = response.headers.get('content-length');
	const totalBytes = contentLength ? Number(contentLength) : undefined;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;
	onProgress({ receivedBytes, totalBytes, percent: totalBytes ? 0 : undefined });

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			receivedBytes += value.byteLength;
			onProgress({
				receivedBytes,
				totalBytes,
				percent: totalBytes ? Math.min(1, receivedBytes / totalBytes) : undefined
			});
		}
	}

	if (totalBytes) {
		onProgress({ receivedBytes, totalBytes, percent: 1 });
	} else if (receivedBytes > 0) {
		onProgress({ receivedBytes, totalBytes: receivedBytes, percent: 1 });
	}

	const merged = new Uint8Array(receivedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	const text = new TextDecoder('utf-8').decode(merged);
	return text ? JSON.parse(text) : null;
}
