export function isSegmentedDashManifest(decoded: string): boolean {
	return /<SegmentTemplate/i.test(decoded);
}

export function isDashManifestPayload(payload: string, contentType: string | null): boolean {
	const trimmed = payload.trim();
	if (!trimmed) {
		return false;
	}
	if (contentType && contentType.toLowerCase().includes('xml')) {
		return trimmed.startsWith('<');
	}
	return /^<\?xml/i.test(trimmed) || /^<MPD[\s>]/i.test(trimmed) || /^<\w+/i.test(trimmed);
}

export function parseJsonSafely<T>(payload: string): T | null {
	try {
		return JSON.parse(payload) as T;
	} catch (error) {
		console.debug('Failed to parse JSON payload from DASH response', error);
		return null;
	}
}

export function isXmlContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	return /(application|text)\/(?:.+\+)?xml/i.test(contentType) || /dash\+xml|mpd/i.test(contentType);
}

export function isJsonContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	return /json/i.test(contentType) || /application\/vnd\.tidal\.bts/i.test(contentType);
}

export function extractUrlsFromDashJsonPayload(payload: unknown): string[] {
	if (!payload || typeof payload !== 'object') {
		return [];
	}

	const candidate = (payload as { urls?: unknown }).urls;
	if (!Array.isArray(candidate)) {
		return [];
	}

	return candidate
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter((entry) => entry.length > 0);
}
