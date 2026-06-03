import { prepareAlbum, prepareArtist, prepareTrack } from './normalizers';
import type { Album, Artist, CoverImage, Lyrics, Playlist, SearchResponse, Track } from '../types';

type JsonRecord = Record<string, unknown>;

type TokenState = {
	accessToken: string;
	expiresAt: number;
};

type NativeSearchType = 'tracks' | 'albums' | 'artists' | 'playlists';

type NativeAlbumWithTracks = {
	album: Album;
	tracks: Track[];
};

type NativePlaylistWithTracks = {
	playlist: Playlist;
	items: Array<{ item: Track }>;
};

type NativeArtistDetails = Artist & {
	albums: Album[];
	tracks: Track[];
};

const TIDAL_AUTH_URL = 'https://auth.tidal.com/v1/oauth2/token';
const TIDAL_API_BASE = 'https://api.tidal.com/v1';
const TIDAL_OPEN_API_BASE = 'https://openapi.tidal.com/v2';
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_BROWSER_CLIENT_ID = 'txNoH4kkV41MfH25';
const DEFAULT_BROWSER_CLIENT_SECRET = 'dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=';
const DEFAULT_SEARCH_LIMIT = 100;
const DEFAULT_ALBUM_TRACK_LIMIT = 500;
const DEFAULT_PLAYLIST_TRACK_LIMIT = 500;

let tokenState: TokenState | null = null;

function getEnvValue(name: string): string | undefined {
	if (typeof process === 'undefined' || !process.env) return undefined;
	return process.env[name];
}

export function isNativeTidalApiEnabled(): boolean {
	const raw = getEnvValue('TIDAL_NATIVE_API_ENABLED');
	if (raw) {
		return !['0', 'false', 'no', 'off', 'disabled'].includes(raw.trim().toLowerCase());
	}
	if (getEnvValue('VITEST') === 'true') return false;
	return true;
}

function getCountryCode(): string {
	return (getEnvValue('TIDAL_COUNTRY_CODE') || 'US').trim().toUpperCase() || 'US';
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
	return {
		clientId:
			getEnvValue('TIDAL_NATIVE_CLIENT_ID') ||
			getEnvValue('TIDAL_CLIENT_ID') ||
			getEnvValue('CLIENT_ID') ||
			DEFAULT_BROWSER_CLIENT_ID,
		clientSecret:
			getEnvValue('TIDAL_NATIVE_CLIENT_SECRET') ||
			getEnvValue('TIDAL_CLIENT_SECRET') ||
			getEnvValue('CLIENT_SECRET') ||
			DEFAULT_BROWSER_CLIENT_SECRET
	};
}

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function parseIsoDurationSeconds(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return undefined;
	const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
		value
	);
	if (!match) return asNumber(value);
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2] ?? 0);
	const seconds = Number(match[3] ?? 0);
	const total = hours * 3600 + minutes * 60 + seconds;
	return Number.isFinite(total) ? total : undefined;
}

function buildUrl(base: string, params?: Record<string, unknown> | URLSearchParams): string {
	const url = new URL(base);
	const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams();
	if (!(params instanceof URLSearchParams) && params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue;
			searchParams.set(key, String(value));
		}
	}
	for (const [key, value] of searchParams.entries()) {
		url.searchParams.append(key, value);
	}
	return url.toString();
}

async function requestAccessToken(signal?: AbortSignal): Promise<string> {
	if (tokenState && Date.now() + TOKEN_REFRESH_SKEW_MS < tokenState.expiresAt) {
		return tokenState.accessToken;
	}

	const credentials = getClientCredentials();
	const basicAuth =
		typeof Buffer !== 'undefined'
			? Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')
			: btoa(`${credentials.clientId}:${credentials.clientSecret}`);
	const body = new URLSearchParams({
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		grant_type: 'client_credentials'
	});
	let response = await fetch(TIDAL_AUTH_URL, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basicAuth}`,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body,
		signal
	});

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
			}),
			signal
		});
	}

	if (!response.ok) {
		const detail = (await response.text()).slice(0, 300);
		throw new Error(`Native TIDAL token request failed (${response.status}): ${detail}`);
	}

	const payload = (await response.json()) as JsonRecord;
	const accessToken = asString(payload.access_token);
	if (!accessToken) {
		throw new Error('Native TIDAL token response did not include access_token');
	}
	const expiresIn = asNumber(payload.expires_in) ?? 3600;
	tokenState = {
		accessToken,
		expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
	};
	return accessToken;
}

async function fetchNativeJson<T>(
	url: string,
	params?: Record<string, unknown> | URLSearchParams,
	options?: { signal?: AbortSignal; openApi?: boolean }
): Promise<T> {
	if (!isNativeTidalApiEnabled()) {
		throw new Error('Native TIDAL API is disabled');
	}
	const token = await requestAccessToken(options?.signal);
	const response = await fetch(buildUrl(url, params), {
		method: 'GET',
		headers: {
			authorization: `Bearer ${token}`,
			accept: options?.openApi
				? 'application/vnd.api+json, application/json;q=0.9, */*;q=0.8'
				: 'application/json'
		},
		signal: options?.signal
	});
	if (!response.ok) {
		throw new Error(`Native TIDAL request failed (${response.status})`);
	}
	return (await response.json()) as T;
}

function parseCoverIdFromResourceUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== 'resources.tidal.com') return undefined;
		const segments = parsed.pathname.split('/').filter(Boolean);
		const imageIndex = segments.findIndex((segment) => segment === 'images');
		if (imageIndex < 0) return undefined;
		const imageSegments = segments.slice(imageIndex + 1, -1);
		return imageSegments.length > 0 ? imageSegments.join('/') : undefined;
	} catch {
		return undefined;
	}
}

function normalizeCoverId(value: unknown): string {
	const raw = asString(value);
	if (!raw) return '';
	const fromResourceUrl = parseCoverIdFromResourceUrl(raw);
	if (fromResourceUrl) return fromResourceUrl;
	if (/^https?:\/\//i.test(raw)) return '';
	return raw.replace(/^\/+|\/+$/g, '');
}

function normalizeArtistRecord(value: unknown): Artist | null {
	if (!isRecord(value)) return null;
	const attrs = isRecord(value.attributes) ? value.attributes : value;
	const id = asNumber(value.id ?? attrs.id);
	const name = asString(attrs.name ?? value.name);
	if (!id || !name) return null;
	return prepareArtist({
		id,
		name,
		type: asString(attrs.type ?? value.type) ?? 'MAIN',
		picture: asString(attrs.picture ?? value.picture) ?? null,
		popularity: asNumber(attrs.popularity ?? value.popularity),
		url: asString(attrs.url ?? value.url)
	} as Artist);
}

function normalizeAlbumRecord(value: unknown, artists: Artist[] = []): Album | null {
	if (!isRecord(value)) return null;
	const attrs = isRecord(value.attributes) ? value.attributes : value;
	const id = asNumber(value.id ?? attrs.id);
	const title = asString(attrs.title ?? value.title);
	if (!id || !title) return null;
	const albumArtists =
		artists.length > 0
			? artists
			: Array.isArray(attrs.artists ?? value.artists)
				? ((attrs.artists ?? value.artists) as unknown[])
						.map(normalizeArtistRecord)
						.filter((artist): artist is Artist => artist !== null)
				: [];
	return prepareAlbum({
		id,
		title,
		cover: normalizeCoverId(attrs.cover ?? value.cover),
		videoCover: (asString(attrs.videoCover ?? value.videoCover) as string | undefined) ?? null,
		releaseDate: asString(attrs.releaseDate ?? value.releaseDate),
		duration: parseIsoDurationSeconds(attrs.duration ?? value.duration),
		numberOfTracks: asNumber(attrs.numberOfTracks ?? attrs.numberOfItems ?? value.numberOfTracks),
		numberOfVolumes: asNumber(attrs.numberOfVolumes ?? value.numberOfVolumes),
		explicit: asBoolean(attrs.explicit ?? value.explicit),
		popularity: asNumber(attrs.popularity ?? value.popularity),
		type: asString(attrs.type ?? attrs.albumType ?? value.type),
		upc: asString(attrs.upc ?? attrs.barcodeId ?? value.upc),
		audioQuality: asString(attrs.audioQuality ?? value.audioQuality),
		audioModes: Array.isArray(attrs.audioModes ?? value.audioModes)
			? ((attrs.audioModes ?? value.audioModes) as string[])
			: undefined,
		artists: albumArtists,
		artist: albumArtists[0]
	} as Album);
}

function normalizeTrackRecord(value: unknown, artists: Artist[] = [], album?: Album): Track | null {
	if (!isRecord(value)) return null;
	const attrs = isRecord(value.attributes) ? value.attributes : value;
	const id = asNumber(value.id ?? attrs.id);
	const title = asString(attrs.title ?? value.title);
	if (!id || !title) return null;
	const trackArtists =
		artists.length > 0
			? artists
			: Array.isArray(attrs.artists ?? value.artists)
				? ((attrs.artists ?? value.artists) as unknown[])
						.map(normalizeArtistRecord)
						.filter((artist): artist is Artist => artist !== null)
				: [];
	const trackAlbum = album ?? normalizeAlbumRecord(attrs.album ?? value.album, []);
	const mediaMetadata = isRecord(attrs.mediaMetadata) ? attrs.mediaMetadata : {};
	const copyrightRecord = isRecord(attrs.copyright) ? attrs.copyright : null;
	const mediaTags = Array.isArray(attrs.mediaTags ?? mediaMetadata.tags)
		? ((attrs.mediaTags ?? mediaMetadata.tags) as string[])
		: undefined;
	return prepareTrack({
		id,
		title,
		duration: parseIsoDurationSeconds(attrs.duration ?? value.duration) ?? 0,
		replayGain: asNumber(attrs.replayGain ?? value.replayGain),
		peak: asNumber(attrs.peak ?? value.peak),
		allowStreaming: asBoolean(attrs.allowStreaming ?? value.allowStreaming, true),
		streamReady: asBoolean(attrs.streamReady ?? value.streamReady, true),
		streamStartDate: asString(attrs.streamStartDate ?? value.streamStartDate),
		premiumStreamingOnly: asBoolean(
			attrs.premiumStreamingOnly ?? value.premiumStreamingOnly,
			false
		),
		trackNumber: asNumber(attrs.trackNumber ?? value.trackNumber) ?? 0,
		volumeNumber: asNumber(attrs.volumeNumber ?? value.volumeNumber) ?? 1,
		version: (asString(attrs.version ?? value.version) as string | undefined) ?? null,
		popularity: asNumber(attrs.popularity ?? value.popularity) ?? 0,
		copyright: asString(copyrightRecord?.text ?? attrs.copyright ?? value.copyright),
		url: asString(attrs.url ?? value.url) ?? '',
		isrc: asString(attrs.isrc ?? value.isrc),
		editable: asBoolean(attrs.editable ?? value.editable),
		explicit: asBoolean(attrs.explicit ?? value.explicit),
		audioQuality: asString(attrs.audioQuality ?? value.audioQuality) ?? 'LOSSLESS',
		audioModes: Array.isArray(attrs.audioModes ?? value.audioModes)
			? ((attrs.audioModes ?? value.audioModes) as string[])
			: [],
		artist: trackArtists[0] ?? trackAlbum?.artist ?? ({ id: 0, name: 'Unknown', type: 'MAIN' } as Artist),
		artists: trackArtists,
		album: trackAlbum ?? ({ id: 0, title: '', cover: '', videoCover: null } as Album),
		mediaMetadata: mediaTags ? { tags: mediaTags } : undefined
	} as Track);
}

function buildIncludedMap(payload: JsonRecord): Map<string, JsonRecord> {
	const included = Array.isArray(payload.included) ? payload.included : [];
	const map = new Map<string, JsonRecord>();
	for (const item of included) {
		if (!isRecord(item)) continue;
		const type = asString(item.type);
		const id = asString(item.id);
		if (type && id) map.set(`${type}:${id}`, item);
	}
	return map;
}

function resolveOpenApiArtworkId(item: JsonRecord, relName: string, included: Map<string, JsonRecord>): string {
	const relationships = isRecord(item.relationships) ? item.relationships : {};
	const rel = isRecord(relationships[relName]) ? relationships[relName] : {};
	const data = rel.data;
	const ref = Array.isArray(data) ? data[0] : isRecord(data) ? data : null;
	if (!isRecord(ref)) return '';
	const artwork = included.get(`artworks:${asString(ref.id)}`);
	const attrs = isRecord(artwork?.attributes) ? artwork.attributes : {};
	const files = Array.isArray(attrs.files) ? attrs.files : [];
	for (const file of files) {
		if (!isRecord(file)) continue;
		const href = asString(file.href);
		if (!href) continue;
		const coverId = parseCoverIdFromResourceUrl(href);
		if (coverId) return coverId;
	}
	return '';
}

function resolveOpenApiArtists(item: JsonRecord, included: Map<string, JsonRecord>): Artist[] {
	const relationships = isRecord(item.relationships) ? item.relationships : {};
	const artistsRel = isRecord(relationships.artists) ? relationships.artists : {};
	const refs = Array.isArray(artistsRel.data) ? artistsRel.data : [];
	return refs
		.map((ref) => (isRecord(ref) ? included.get(`artists:${asString(ref.id)}`) : null))
		.map(normalizeArtistRecord)
		.filter((artist): artist is Artist => artist !== null);
}

function resolveOpenApiItem(ref: unknown, included: Map<string, JsonRecord>): unknown {
	if (!isRecord(ref)) return null;
	const type = asString(ref.type);
	const id = asString(ref.id);
	if (!type || !id) return null;
	const item = included.get(`${type}:${id}`);
	if (!item) return null;
	const attrs = isRecord(item.attributes) ? item.attributes : {};
	if (type === 'artists') {
		return normalizeArtistRecord(item);
	}
	if (type === 'albums') {
		const album = normalizeAlbumRecord(item, resolveOpenApiArtists(item, included));
		return album ? { ...album, cover: resolveOpenApiArtworkId(item, 'coverArt', included) || album.cover } : null;
	}
	if (type === 'tracks') {
		const relationships = isRecord(item.relationships) ? item.relationships : {};
		const albumsRel = isRecord(relationships.albums) ? relationships.albums : {};
		const albumRef = Array.isArray(albumsRel.data) ? albumsRel.data[0] : null;
		const albumItem = isRecord(albumRef) ? included.get(`albums:${asString(albumRef.id)}`) : null;
		const album = albumItem
			? normalizeAlbumRecord(albumItem, resolveOpenApiArtists(albumItem, included))
			: null;
		const cover = albumItem ? resolveOpenApiArtworkId(albumItem, 'coverArt', included) : '';
		return normalizeTrackRecord(
			item,
			resolveOpenApiArtists(item, included),
			album ? { ...album, cover: cover || album.cover } : undefined
		);
	}
	if (type === 'playlists') {
		return {
			uuid: id,
			title: asString(attrs.name ?? attrs.title) ?? '',
			description: asString(attrs.description) ?? '',
			image: resolveOpenApiArtworkId(item, 'coverArt', included),
			duration: parseIsoDurationSeconds(attrs.duration) ?? 0,
			numberOfTracks: asNumber(attrs.numberOfItems ?? attrs.numberOfTracks) ?? 0,
			numberOfVideos: 0,
			creator: { id: 0, name: '', picture: null },
			created: asString(attrs.createdAt) ?? '',
			lastUpdated: asString(attrs.updatedAt) ?? '',
			type: 'PLAYLIST',
			publicPlaylist: true,
			url: asString(attrs.url) ?? '',
			popularity: 0
		} as Playlist;
	}
	return null;
}

function parseOpenApiSearch<T>(
	payload: unknown,
	bucket: NativeSearchType,
	limit: number,
	offset: number
): SearchResponse<T> {
	if (!isRecord(payload)) {
		return { items: [], limit, offset, totalNumberOfItems: 0 };
	}
	const included = buildIncludedMap(payload);
	const data = isRecord(payload.data) ? payload.data : {};
	const relationships = isRecord(data.relationships) ? data.relationships : {};
	const rel = isRecord(relationships[bucket]) ? relationships[bucket] : {};
	const refs = Array.isArray(rel.data) ? rel.data : [];
	const items = refs
		.map((ref) => resolveOpenApiItem(ref, included))
		.filter((item): item is T => item !== null);
	return {
		items,
		limit,
		offset,
		totalNumberOfItems: items.length
	};
}

async function searchNative<T>(
	query: string,
	bucket: NativeSearchType,
	include: string,
	options?: { signal?: AbortSignal }
): Promise<SearchResponse<T>> {
	const limit = DEFAULT_SEARCH_LIMIT;
	const offset = 0;
	const payload = await fetchNativeJson<unknown>(
		`${TIDAL_OPEN_API_BASE}/searchResults/${encodeURIComponent(query)}`,
		{
			limit,
			offset,
			include,
			countryCode: getCountryCode()
		},
		{ openApi: true, signal: options?.signal }
	);
	return parseOpenApiSearch<T>(payload, bucket, limit, offset);
}

export async function nativeSearchTracks(
	query: string,
	options?: { signal?: AbortSignal }
): Promise<SearchResponse<Track>> {
	return searchNative<Track>(
		query,
		'tracks',
		'tracks,tracks.artists,tracks.albums,tracks.albums.coverArt',
		options
	);
}

export async function nativeSearchAlbums(
	query: string,
	options?: { signal?: AbortSignal }
): Promise<SearchResponse<Album>> {
	return searchNative<Album>(
		query,
		'albums',
		'albums,albums.artists,albums.coverArt',
		options
	);
}

export async function nativeSearchArtists(
	query: string,
	options?: { signal?: AbortSignal }
): Promise<SearchResponse<Artist>> {
	return searchNative<Artist>(query, 'artists', 'artists,artists.profileArt', options);
}

export async function nativeSearchPlaylists(
	query: string,
	options?: { signal?: AbortSignal }
): Promise<SearchResponse<Playlist>> {
	return searchNative<Playlist>(query, 'playlists', 'playlists,playlists.coverArt', options);
}

export async function nativeGetTrackMetadata(
	id: number,
	options?: { signal?: AbortSignal }
): Promise<Track> {
	const payload = await fetchNativeJson<unknown>(
		`${TIDAL_API_BASE}/tracks/${id}/`,
		{
			countryCode: getCountryCode()
		},
		options
	);
	const track = normalizeTrackRecord(payload);
	if (!track) throw new Error('Native TIDAL track metadata was malformed');
	return track;
}

export async function nativeGetAlbum(
	id: number,
	options?: { signal?: AbortSignal }
): Promise<NativeAlbumWithTracks> {
	const [albumPayload, itemsPayload] = await Promise.all([
		fetchNativeJson<unknown>(
			`${TIDAL_API_BASE}/albums/${id}`,
			{ countryCode: getCountryCode() },
			options
		),
		fetchNativeJson<JsonRecord>(
			`${TIDAL_API_BASE}/albums/${id}/items`,
			{
				countryCode: getCountryCode(),
				limit: DEFAULT_ALBUM_TRACK_LIMIT,
				offset: 0
			},
			options
		)
	]);
	const album = normalizeAlbumRecord(albumPayload);
	if (!album) throw new Error('Native TIDAL album metadata was malformed');
	const items = Array.isArray(itemsPayload.items) ? itemsPayload.items : [];
	const tracks = items
		.map((entry) => (isRecord(entry) ? normalizeTrackRecord(entry.item, [], album) : null))
		.filter((track): track is Track => track !== null);
	return { album, tracks };
}

export async function nativeGetPlaylist(
	uuid: string,
	options?: { signal?: AbortSignal }
): Promise<NativePlaylistWithTracks> {
	const [playlistPayload, itemsPayload] = await Promise.all([
		fetchNativeJson<JsonRecord>(
			`${TIDAL_API_BASE}/playlists/${encodeURIComponent(uuid)}`,
			{
				countryCode: getCountryCode()
			},
			options
		),
		fetchNativeJson<JsonRecord>(
			`${TIDAL_API_BASE}/playlists/${encodeURIComponent(uuid)}/items`,
			{
				countryCode: getCountryCode(),
				limit: DEFAULT_PLAYLIST_TRACK_LIMIT,
				offset: 0
			},
			options
		)
	]);
	const playlist: Playlist = {
		uuid,
		title: asString(playlistPayload.title) ?? '',
		description: asString(playlistPayload.description) ?? '',
		image: normalizeCoverId(playlistPayload.image),
		squareImage: normalizeCoverId(playlistPayload.squareImage),
		duration: asNumber(playlistPayload.duration) ?? 0,
		numberOfTracks: asNumber(playlistPayload.numberOfTracks) ?? 0,
		numberOfVideos: asNumber(playlistPayload.numberOfVideos) ?? 0,
		creator: {
			id: asNumber(isRecord(playlistPayload.creator) ? playlistPayload.creator.id : 0) ?? 0,
			name: '',
			picture: null
		},
		created: asString(playlistPayload.created) ?? '',
		lastUpdated: asString(playlistPayload.lastUpdated) ?? '',
		type: asString(playlistPayload.type) ?? '',
		publicPlaylist: asBoolean(playlistPayload.publicPlaylist, true),
		url: asString(playlistPayload.url) ?? '',
		popularity: asNumber(playlistPayload.popularity) ?? 0,
		promotedArtists: Array.isArray(playlistPayload.promotedArtists)
			? (playlistPayload.promotedArtists as Artist[])
			: []
	};
	const items = Array.isArray(itemsPayload.items) ? itemsPayload.items : [];
	return {
		playlist,
		items: items
			.map((entry) => (isRecord(entry) ? normalizeTrackRecord(entry.item) : null))
			.filter((track): track is Track => track !== null)
			.map((track) => ({ item: track }))
	};
}

export async function nativeGetArtist(
	id: number,
	options?: { signal?: AbortSignal }
): Promise<NativeArtistDetails> {
	const [artistPayload, albumsPayload, tracksPayload] = await Promise.all([
		fetchNativeJson<unknown>(
			`${TIDAL_API_BASE}/artists/${id}`,
			{
				countryCode: getCountryCode()
			},
			options
		),
		fetchNativeJson<JsonRecord>(
			`${TIDAL_API_BASE}/artists/${id}/albums`,
			{
				countryCode: getCountryCode(),
				limit: 100,
				offset: 0
			},
			options
		),
		fetchNativeJson<JsonRecord>(
			`${TIDAL_API_BASE}/artists/${id}/toptracks`,
			{
				countryCode: getCountryCode(),
				limit: 20,
				offset: 0
			},
			options
		)
	]);
	const artist = normalizeArtistRecord(artistPayload);
	if (!artist) throw new Error('Native TIDAL artist metadata was malformed');
	const albums = (Array.isArray(albumsPayload.items) ? albumsPayload.items : [])
		.map((entry) => normalizeAlbumRecord(entry))
		.filter((album): album is Album => album !== null);
	const tracks = (Array.isArray(tracksPayload.items) ? tracksPayload.items : [])
		.map((entry) => normalizeTrackRecord(entry))
		.filter((track): track is Track => track !== null);
	return { ...artist, albums, tracks };
}

export async function nativeGetCover(
	id?: number,
	query?: string,
	options?: { signal?: AbortSignal }
): Promise<CoverImage[]> {
	if (id) {
		const track = await nativeGetTrackMetadata(id, options);
		const cover = track.album?.cover;
		if (!cover) throw new Error('Native TIDAL cover not found');
		return [{ id, name: track.album?.title ?? track.title, url: cover }];
	}
	if (query) {
		const tracks = await nativeSearchTracks(query, options);
		return tracks.items
			.map((track) => track.album?.cover)
			.filter((cover): cover is string => typeof cover === 'string' && cover.length > 0)
			.slice(0, 10)
			.map((cover) => ({ url: cover }));
	}
	throw new Error('Native TIDAL cover lookup requires id or query');
}

export async function nativeGetLyrics(
	id: number,
	options?: { signal?: AbortSignal }
): Promise<Lyrics> {
	const payload = await fetchNativeJson<unknown>(
		`${TIDAL_API_BASE}/tracks/${id}/lyrics`,
		{
			countryCode: getCountryCode()
		},
		options
	);
	if (!isRecord(payload)) throw new Error('Native TIDAL lyrics payload was malformed');
	return {
		trackId: asNumber(payload.trackId) ?? id,
		lyrics: asString(payload.lyrics) ?? '',
		subtitles: asString(payload.subtitles),
		syncType: asString(payload.subtitles) ? 'LINE_SYNCED' : undefined,
		provider: asString(payload.lyricsProvider),
		lyricsProvider: asString(payload.lyricsProvider),
		providerCommontrackId: asString(payload.providerCommontrackId),
		providerLyricsId: asString(payload.providerLyricsId),
		isRightToLeft: asBoolean(payload.isRightToLeft)
	};
}
