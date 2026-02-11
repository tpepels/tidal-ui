import type { Album } from '$lib/types';

const TIDAL_AUTH_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_PAGES = 12;
const PAGE_LIMIT = 100;

type TokenState = {
	accessToken: string;
	expiresAt: number;
};

let tokenState: TokenState | null = null;

function getClientCredentials(): { clientId: string; clientSecret: string } | null {
	const clientId = process.env.TIDAL_CLIENT_ID || process.env.CLIENT_ID;
	const clientSecret = process.env.TIDAL_CLIENT_SECRET || process.env.CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		return null;
	}
	return { clientId, clientSecret };
}

export function isTidalOfficialApiConfigured(): boolean {
	return Boolean(getClientCredentials());
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseNumericId(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function parseString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseAlbumFromRecord(record: unknown): Album | null {
	if (!isJsonObject(record)) return null;
	const attributes = isJsonObject(record.attributes) ? record.attributes : record;
	const id = parseNumericId(record.id ?? attributes.id);
	const title = parseString(attributes.title ?? record.title);
	if (id === null || !title) return null;

	const releaseDate = parseString(
		attributes.releaseDate ?? attributes.release_date ?? record.releaseDate ?? record.release_date
	);
	const type = parseString(attributes.type ?? record.type);
	const audioQuality = parseString(
		attributes.audioQuality ??
			attributes.audio_quality ??
			record.audioQuality ??
			record.audio_quality
	);
	const cover = parseString(attributes.cover ?? record.cover) ?? '';
	const videoCover = parseString(attributes.videoCover ?? attributes.video_cover ?? record.videoCover) ?? null;
	const numberOfTracks =
		parseNumericId(
			attributes.numberOfTracks ??
				attributes.number_of_tracks ??
				record.numberOfTracks ??
				record.number_of_tracks
		) ?? undefined;
	const popularity = parseNumericId(attributes.popularity ?? record.popularity) ?? undefined;

	return {
		id,
		title,
		cover,
		videoCover,
		releaseDate,
		type,
		audioQuality,
		numberOfTracks,
		popularity,
		discographySource: 'official_tidal'
	};
}

function extractAlbumRecords(payload: unknown): unknown[] {
	if (!isJsonObject(payload)) return [];
	const records: unknown[] = [];

	const directData = payload.data;
	if (Array.isArray(directData)) {
		records.push(...directData);
	} else if (isJsonObject(directData) && Array.isArray(directData.items)) {
		records.push(...directData.items);
	}

	if (Array.isArray(payload.items)) {
		records.push(...payload.items);
	}

	if (Array.isArray(payload.included)) {
		const albumIncluded = payload.included.filter((entry) => {
			if (!isJsonObject(entry)) return false;
			const type = parseString(entry.type)?.toLowerCase();
			return type === 'albums' || type === 'album';
		});
		records.push(...albumIncluded);
	}

	return records;
}

function getPaginationHint(payload: unknown): {
	nextUrl?: string;
	total?: number;
	offset?: number;
	limit?: number;
} {
	if (!isJsonObject(payload)) return {};

	const links = isJsonObject(payload.links) ? payload.links : undefined;
	const meta = isJsonObject(payload.meta) ? payload.meta : undefined;
	const data = isJsonObject(payload.data) ? payload.data : undefined;

	const nextUrl = parseString(links?.next);
	const total =
		parseNumericId(meta?.totalNumberOfItems ?? meta?.total ?? data?.totalNumberOfItems ?? data?.total) ??
		undefined;
	const offset =
		parseNumericId(meta?.offset ?? data?.offset ?? (isJsonObject(payload.albums) ? payload.albums.offset : undefined)) ??
		undefined;
	const limit =
		parseNumericId(meta?.limit ?? data?.limit ?? (isJsonObject(payload.albums) ? payload.albums.limit : undefined)) ??
		undefined;

	return { nextUrl, total, offset, limit };
}

async function requestAccessToken(): Promise<string> {
	const credentials = getClientCredentials();
	if (!credentials) {
		throw new Error('TIDAL API credentials are not configured');
	}

	if (tokenState && Date.now() + TOKEN_REFRESH_SKEW_MS < tokenState.expiresAt) {
		return tokenState.accessToken;
	}

	const grantBody = new URLSearchParams({ grant_type: 'client_credentials' });
	const basicAuth = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');

	let response = await fetch(TIDAL_AUTH_URL, {
		method: 'POST',
		headers: {
			authorization: `Basic ${basicAuth}`,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: grantBody
	});

	// Fallback for providers expecting credentials in body instead of Basic auth.
	if (!response.ok) {
		response = await fetch(TIDAL_AUTH_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret
			})
		});
	}

	if (!response.ok) {
		const detail = (await response.text()).slice(0, 300);
		throw new Error(`Failed to obtain TIDAL access token (${response.status}): ${detail}`);
	}

	const payload = await response.json();
	const accessToken = parseString((payload as { access_token?: unknown }).access_token);
	const expiresIn = parseNumericId((payload as { expires_in?: unknown }).expires_in) ?? 3600;
	if (!accessToken) {
		throw new Error('TIDAL token response did not include access_token');
	}

	tokenState = {
		accessToken,
		expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
	};
	return accessToken;
}

function normalizeAlbumVariantTitle(value?: string): string {
	return (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

function normalizeAlbumVariantQuality(value?: string): string {
	const normalized = (value ?? '').trim().toUpperCase();
	return normalized.length > 0 ? normalized : 'UNKNOWN';
}

function buildAlbumVariantKey(album: Pick<Album, 'id' | 'title' | 'audioQuality'>): string {
	const title = normalizeAlbumVariantTitle(album.title);
	const quality = normalizeAlbumVariantQuality(album.audioQuality);
	return title.length > 0 ? `title:${title}|quality:${quality}` : `id:${album.id}|quality:${quality}`;
}

function compareAlbumByAge(a: Album, b: Album): number {
	const timestampA = a.releaseDate ? Date.parse(a.releaseDate) : Number.NaN;
	const timestampB = b.releaseDate ? Date.parse(b.releaseDate) : Number.NaN;
	if (Number.isFinite(timestampA) && Number.isFinite(timestampB) && timestampA !== timestampB) {
		return timestampB - timestampA;
	}
	if (Number.isFinite(timestampA) && !Number.isFinite(timestampB)) return -1;
	if (!Number.isFinite(timestampA) && Number.isFinite(timestampB)) return 1;
	return (b.popularity ?? 0) - (a.popularity ?? 0);
}

function isSingle(album: Album): boolean {
	const type = (album.type ?? '').toUpperCase();
	return type.includes('SINGLE');
}

async function fetchAlbumsFromEndpoint(
	endpoint: string,
	token: string,
	countryCode: string
): Promise<Album[]> {
	const collected = new Map<number, Album>();
	const seenVariants = new Set<string>();
	let nextUrl: string | null = `${endpoint}?countryCode=${encodeURIComponent(countryCode)}&limit=${PAGE_LIMIT}&offset=0&include=albums`;

	for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
		const response = await fetch(nextUrl, {
			method: 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/json, application/vnd.api+json'
			}
		});

		if (response.status === 404) {
			return [];
		}
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 200);
			throw new Error(`TIDAL artist albums failed (${response.status}): ${detail}`);
		}

		const payload = await response.json();
		const records = extractAlbumRecords(payload);
		for (const record of records) {
			const album = parseAlbumFromRecord(record);
			if (!album || isSingle(album)) continue;
			const variantKey = buildAlbumVariantKey(album);
			if (seenVariants.has(variantKey)) continue;
			seenVariants.add(variantKey);
			collected.set(album.id, album);
		}

		const pagination = getPaginationHint(payload);
		if (pagination.nextUrl) {
			nextUrl = pagination.nextUrl.startsWith('http')
				? pagination.nextUrl
				: new URL(pagination.nextUrl, TIDAL_API_BASE).toString();
			continue;
		}

		if (
			typeof pagination.total === 'number' &&
			typeof pagination.limit === 'number' &&
			typeof pagination.offset === 'number'
		) {
			const nextOffset = pagination.offset + pagination.limit;
			nextUrl =
				nextOffset < pagination.total
					? `${endpoint}?countryCode=${encodeURIComponent(countryCode)}&limit=${pagination.limit}&offset=${nextOffset}&include=albums`
					: null;
			continue;
		}

		nextUrl = null;
	}

	return Array.from(collected.values()).sort(compareAlbumByAge);
}

export async function fetchOfficialArtistAlbums(
	artistId: number,
	countryCode = process.env.TIDAL_COUNTRY_CODE || 'US'
): Promise<Album[]> {
	const token = await requestAccessToken();
	const endpoints = [
		`${TIDAL_API_BASE}/artists/${artistId}/albums`,
		`${TIDAL_API_BASE}/artists/${artistId}/relationships/albums`
	];

	for (const endpoint of endpoints) {
		const albums = await fetchAlbumsFromEndpoint(endpoint, token, countryCode);
		if (albums.length > 0) {
			return albums;
		}
	}

	return [];
}
