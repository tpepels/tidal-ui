import type { ArtistDetails } from '$lib/types';

type ArtistCacheEntry = {
	artist: ArtistDetails;
	expiresAt: number;
};

const artistCache = new Map<number, ArtistCacheEntry>();
const STORAGE_KEY = 'tidal-ui:artist-cache';
const browser = typeof window !== 'undefined';
const CACHE_TTL_MS = 30 * 60 * 1000;

const normalizeCover = (value: string | null | undefined): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const patchEntryAlbumCover = (
	entry: ArtistCacheEntry,
	albumId: number,
	cover: string
): ArtistCacheEntry | null => {
	let changed = false;

	const albums = entry.artist.albums.map((album) => {
		if (album.id !== albumId) return album;
		if (album.cover === cover) return album;
		changed = true;
		return { ...album, cover };
	});

	const tracks = entry.artist.tracks.map((track) => {
		if (!track.album || track.album.id !== albumId) return track;
		if (track.album.cover === cover) return track;
		changed = true;
		return {
			...track,
			album: {
				...track.album,
				cover
			}
		};
	});

	if (!changed) {
		return null;
	}

	return {
		...entry,
		artist: {
			...entry.artist,
			albums,
			tracks
		}
	};
};

const hydrateFromSession = () => {
	if (!browser || artistCache.size > 0) {
		return;
	}
	try {
		const stored = sessionStorage.getItem(STORAGE_KEY);
		if (!stored) return;
		const parsed = JSON.parse(stored) as Record<string, ArtistDetails | ArtistCacheEntry>;
		const now = Date.now();
		for (const [id, value] of Object.entries(parsed)) {
			const numericId = Number(id);
			if (!Number.isFinite(numericId) || !value) continue;

			const entry =
				typeof value === 'object' &&
				value !== null &&
				'artist' in value &&
				'expiresAt' in value
					? (value as ArtistCacheEntry)
					: ({
							artist: value as ArtistDetails,
							expiresAt: now + CACHE_TTL_MS
						} as ArtistCacheEntry);

			if (entry.expiresAt > now) {
				artistCache.set(numericId, entry);
			}
		}
	} catch {
		// Ignore session storage cache errors.
	}
};

const persistToSession = () => {
	if (!browser) return;
	try {
		const payload: Record<string, ArtistCacheEntry> = {};
		const now = Date.now();
		for (const [id, entry] of artistCache.entries()) {
			if (entry.expiresAt <= now) {
				artistCache.delete(id);
				continue;
			}
			payload[id.toString()] = entry;
		}
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Ignore session storage cache errors.
	}
};

export const artistCacheStore = {
	get(id: number): ArtistDetails | undefined {
		hydrateFromSession();
		const entry = artistCache.get(id);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) {
			artistCache.delete(id);
			persistToSession();
			return undefined;
		}
		return entry.artist;
	},
	set(artist: ArtistDetails): void {
		artistCache.set(artist.id, {
			artist,
			expiresAt: Date.now() + CACHE_TTL_MS
		});
		persistToSession();
	},
	upsertAlbumCover(artistId: number, albumId: number, cover: string): void {
		hydrateFromSession();
		const normalizedCover = normalizeCover(cover);
		if (!normalizedCover || !Number.isFinite(artistId) || !Number.isFinite(albumId)) {
			return;
		}

		const entry = artistCache.get(artistId);
		if (!entry || entry.expiresAt <= Date.now()) {
			return;
		}

		const patched = patchEntryAlbumCover(entry, albumId, normalizedCover);
		if (!patched) {
			return;
		}

		artistCache.set(artistId, patched);
		persistToSession();
	},
	upsertAlbumCoverGlobally(albumId: number, cover: string): void {
		hydrateFromSession();
		const normalizedCover = normalizeCover(cover);
		if (!normalizedCover || !Number.isFinite(albumId)) {
			return;
		}

		const now = Date.now();
		let changed = false;
		for (const [artistId, entry] of artistCache.entries()) {
			if (entry.expiresAt <= now) {
				artistCache.delete(artistId);
				changed = true;
				continue;
			}

			const patched = patchEntryAlbumCover(entry, albumId, normalizedCover);
			if (!patched) {
				continue;
			}
			artistCache.set(artistId, patched);
			changed = true;
		}

		if (changed) {
			persistToSession();
		}
	},
	clear(): void {
		artistCache.clear();
		if (!browser) return;
		try {
			sessionStorage.removeItem(STORAGE_KEY);
		} catch {
			// Ignore session storage cache errors.
		}
	}
};
