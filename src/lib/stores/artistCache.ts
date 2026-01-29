import type { ArtistDetails } from '$lib/types';

const artistCache = new Map<number, ArtistDetails>();
const STORAGE_KEY = 'tidal-ui:artist-cache';
const browser = typeof window !== 'undefined';

const hydrateFromSession = () => {
	if (!browser || artistCache.size > 0) {
		return;
	}
	try {
		const stored = sessionStorage.getItem(STORAGE_KEY);
		if (!stored) return;
		const parsed = JSON.parse(stored) as Record<string, ArtistDetails>;
		for (const [id, artist] of Object.entries(parsed)) {
			const numericId = Number(id);
			if (Number.isFinite(numericId) && artist) {
				artistCache.set(numericId, artist);
			}
		}
	} catch {
		// Ignore session storage cache errors.
	}
};

const persistToSession = () => {
	if (!browser) return;
	try {
		const payload: Record<string, ArtistDetails> = {};
		for (const [id, artist] of artistCache.entries()) {
			payload[id.toString()] = artist;
		}
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Ignore session storage cache errors.
	}
};

export const artistCacheStore = {
	get(id: number): ArtistDetails | undefined {
		hydrateFromSession();
		return artistCache.get(id);
	},
	set(artist: ArtistDetails): void {
		artistCache.set(artist.id, artist);
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
