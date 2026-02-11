import type { Album } from '$lib/types';

const TIDAL_AUTH_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_PAGES = 12;
const ALBUM_BATCH_SIZE = 50;

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
	const type = parseString(attributes.type ?? attributes.albumType ?? record.type);
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
				attributes.numberOfItems ??
				attributes.number_of_tracks ??
				record.numberOfTracks ??
				record.numberOfItems ??
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

function extractAlbumIdsFromRelationshipData(payload: unknown): number[] {
	if (!isJsonObject(payload)) return [];
	const data = payload.data;
	if (!Array.isArray(data)) return [];
	const ids = new Set<number>();
	for (const entry of data) {
		if (!isJsonObject(entry)) continue;
		const id = parseNumericId(entry.id);
		if (id !== null) ids.add(id);
	}
	return Array.from(ids);
}

function extractAlbumIdsFromArtistResource(payload: unknown): number[] {
	if (!isJsonObject(payload)) return [];
	const data = payload.data;
	if (!isJsonObject(data)) return [];
	const relationships = isJsonObject(data.relationships) ? data.relationships : undefined;
	const albumsRelationship = isJsonObject(relationships?.albums) ? relationships.albums : undefined;
	const albumData = albumsRelationship?.data;
	if (!Array.isArray(albumData)) return [];
	const ids = new Set<number>();
	for (const entry of albumData) {
		if (!isJsonObject(entry)) continue;
		const id = parseNumericId(entry.id);
		if (id !== null) ids.add(id);
	}
	return Array.from(ids);
}

function getPaginationHint(payload: unknown): {
	nextUrl?: string;
	nextCursor?: string;
} {
	if (!isJsonObject(payload)) return {};

	const links = isJsonObject(payload.links) ? payload.links : undefined;
	const meta = isJsonObject(payload.meta) ? payload.meta : undefined;
	const nextUrl = parseString(links?.next);
	const nextCursor = parseString((isJsonObject(links?.meta) ? links.meta.nextCursor : undefined) ?? meta?.nextCursor);
	return { nextUrl, nextCursor };
}

function resolveNextPageUrl(nextUrl: string): string {
	if (nextUrl.startsWith('http://') || nextUrl.startsWith('https://')) {
		return nextUrl;
	}
	if (nextUrl.startsWith('/v2/')) {
		return `https://openapi.tidal.com${nextUrl}`;
	}
	if (nextUrl.startsWith('/')) {
		return `https://openapi.tidal.com/v2${nextUrl}`;
	}
	return new URL(nextUrl, `${TIDAL_API_BASE}/`).toString();
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

function createAuthHeaders(token: string): Headers {
	return new Headers({
		authorization: `Bearer ${token}`,
		accept: 'application/vnd.tidal.v1+json, application/vnd.api+json, application/json',
		'content-type': 'application/vnd.tidal.v1+json'
	});
}

function mergeAlbums(
	collected: Map<number, Album>,
	seenVariants: Set<string>,
	candidates: Album[]
): void {
	for (const album of candidates) {
		if (!album || isSingle(album)) continue;
		const variantKey = buildAlbumVariantKey(album);
		if (seenVariants.has(variantKey)) continue;
		seenVariants.add(variantKey);
		collected.set(album.id, album);
	}
}

async function fetchAlbumsByIds(
	token: string,
	countryCode: string,
	albumIds: number[]
): Promise<Album[]> {
	if (albumIds.length === 0) return [];
	const albums: Album[] = [];
	for (let start = 0; start < albumIds.length; start += ALBUM_BATCH_SIZE) {
		const chunk = albumIds.slice(start, start + ALBUM_BATCH_SIZE);
		const query = new URLSearchParams();
		query.set('countryCode', countryCode);
		query.append('include', 'artists');
		query.set('filter[id]', chunk.join(','));
		const url = `${TIDAL_API_BASE}/albums?${query.toString()}`;
		const response = await fetch(url, {
			method: 'GET',
			headers: createAuthHeaders(token)
		});
		if (!response.ok) {
			continue;
		}
		const payload = await response.json();
		const parsed = extractAlbumRecords(payload)
			.map((record) => parseAlbumFromRecord(record))
			.filter((album): album is Album => album !== null);
		albums.push(...parsed);
	}
	return albums;
}

async function fetchAlbumsFromRelationshipsEndpoint(
	artistId: number,
	token: string,
	countryCode: string
): Promise<Album[]> {
	const collected = new Map<number, Album>();
	const seenVariants = new Set<string>();
	let nextUrl: string | null = `${TIDAL_API_BASE}/artists/${artistId}/relationships/albums?countryCode=${encodeURIComponent(countryCode)}&include=albums`;
	let pageCount = 0;
	let relationshipIdCount = 0;
	let includedAlbumCount = 0;
	let hydratedAlbumCount = 0;

	for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
		pageCount += 1;
		const response = await fetch(nextUrl, {
			method: 'GET',
			headers: createAuthHeaders(token)
		});

		if (response.status === 404) {
			if (page === 0) {
				return [];
			}
			console.warn(
				`[TidalOpenApi] Artist ${artistId}: pagination returned 404 on page ${page + 1}, keeping ${collected.size} collected albums`
			);
			break;
		}
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 200);
			throw new Error(`TIDAL artist albums failed (${response.status}): ${detail}`);
		}

		const payload = await response.json();
		const fromIncluded = extractAlbumRecords(payload)
			.map((record) => parseAlbumFromRecord(record))
			.filter((album): album is Album => album !== null);
		includedAlbumCount += fromIncluded.length;
		mergeAlbums(collected, seenVariants, fromIncluded);

		const relationshipAlbumIds = extractAlbumIdsFromRelationshipData(payload);
		relationshipIdCount += relationshipAlbumIds.length;
		const missingIds = relationshipAlbumIds.filter((id) => !collected.has(id));
		if (missingIds.length > 0) {
			const fetchedByIds = await fetchAlbumsByIds(token, countryCode, missingIds);
			hydratedAlbumCount += fetchedByIds.length;
			mergeAlbums(collected, seenVariants, fetchedByIds);
		}

		const pagination = getPaginationHint(payload);
		if (pagination.nextUrl) {
			nextUrl = resolveNextPageUrl(pagination.nextUrl);
			continue;
		}
		if (pagination.nextCursor) {
			nextUrl = `${TIDAL_API_BASE}/artists/${artistId}/relationships/albums?countryCode=${encodeURIComponent(countryCode)}&include=albums&page%5Bcursor%5D=${encodeURIComponent(pagination.nextCursor)}`;
			continue;
		}

		nextUrl = null;
	}

	console.info(
		`[TidalOpenApi] Artist ${artistId}: relationships pagination pages=${pageCount}, relationshipIds=${relationshipIdCount}, includedAlbums=${includedAlbumCount}, hydratedById=${hydratedAlbumCount}, merged=${collected.size}`
	);

	return Array.from(collected.values()).sort(compareAlbumByAge);
}

async function fetchAlbumsFromArtistIncludeEndpoint(
	artistId: number,
	token: string,
	countryCode: string
): Promise<Album[]> {
	const url = `${TIDAL_API_BASE}/artists/${artistId}?countryCode=${encodeURIComponent(countryCode)}&include=albums`;
	const response = await fetch(url, {
		method: 'GET',
		headers: createAuthHeaders(token)
	});
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 200);
		console.warn(
			`[TidalOpenApi] Artist ${artistId}: include=albums fallback failed (${response.status}) ${detail}`
		);
		return [];
	}

	const payload = await response.json();
	const fromIncluded = extractAlbumRecords(payload)
		.map((record) => parseAlbumFromRecord(record))
		.filter((album): album is Album => album !== null);
	const relationshipAlbumIds = extractAlbumIdsFromArtistResource(payload);
	const missingIds = relationshipAlbumIds.filter((id) => !fromIncluded.some((album) => album.id === id));
	const hydrated = missingIds.length > 0 ? await fetchAlbumsByIds(token, countryCode, missingIds) : [];
	const merged = new Map<number, Album>();
	const seenVariants = new Set<string>();
	mergeAlbums(merged, seenVariants, fromIncluded);
	mergeAlbums(merged, seenVariants, hydrated);
	console.info(
		`[TidalOpenApi] Artist ${artistId}: include=albums fallback included=${fromIncluded.length}, relationshipIds=${relationshipAlbumIds.length}, hydratedById=${hydrated.length}, merged=${merged.size}`
	);
	return Array.from(merged.values()).sort(compareAlbumByAge);
}

export async function fetchOfficialArtistAlbums(
	artistId: number,
	countryCode = process.env.TIDAL_COUNTRY_CODE || 'US'
): Promise<Album[]> {
	const token = await requestAccessToken();
	const fromRelationships = await fetchAlbumsFromRelationshipsEndpoint(artistId, token, countryCode);
	if (fromRelationships.length > 0) {
		return fromRelationships;
	}
	return fetchAlbumsFromArtistIncludeEndpoint(artistId, token, countryCode);
}
