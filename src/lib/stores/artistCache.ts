import type { ArtistDetails } from '$lib/types';

type ArtistCacheEntry = {
	artist: ArtistDetails;
	expiresAt: number;
};

const artistCache = new Map<number, ArtistCacheEntry>();
const STORAGE_KEY = 'tidal-ui:artist-cache';
const browser = typeof window !== 'undefined';
const CACHE_TTL_MS = 30 * 60 * 1000;

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
