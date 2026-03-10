import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export interface AlbumHistoryEntry {
	id: number;
	href: string;
	title: string;
	artistName: string;
	visitedAt: number;
}

export interface ArtistHistoryEntry {
	id: number;
	href: string;
	name: string;
	visitedAt: number;
}

export interface NavigationHistoryState {
	albums: AlbumHistoryEntry[];
	artists: ArtistHistoryEntry[];
}

type AlbumVisitInput = {
	id: number;
	title?: string | null;
	artistName?: string | null;
};

type ArtistVisitInput = {
	id: number;
	name?: string | null;
};

const STORAGE_KEY = 'tidal-ui.navigation-history';
const MAX_ALBUM_HISTORY = 25;
const MAX_ARTIST_HISTORY = 10;

const EMPTY_STATE: NavigationHistoryState = {
	albums: [],
	artists: []
};

function normalizeAlbumTitle(value: string | null | undefined): string {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : 'Unknown Album';
}

function normalizeArtistName(value: string | null | undefined): string {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : 'Unknown Artist';
}

function normalizeAlbumEntry(raw: unknown): AlbumHistoryEntry | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const candidate = raw as Partial<AlbumHistoryEntry>;
	const id = Number(candidate.id);
	if (!Number.isFinite(id) || id <= 0) {
		return null;
	}
	return {
		id,
		href: `/album/${id}`,
		title: normalizeAlbumTitle(candidate.title),
		artistName: normalizeArtistName(candidate.artistName),
		visitedAt:
			typeof candidate.visitedAt === 'number' && Number.isFinite(candidate.visitedAt)
				? candidate.visitedAt
				: Date.now()
	};
}

function normalizeArtistEntry(raw: unknown): ArtistHistoryEntry | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const candidate = raw as Partial<ArtistHistoryEntry>;
	const id = Number(candidate.id);
	if (!Number.isFinite(id) || id <= 0) {
		return null;
	}
	const name = normalizeArtistName(candidate.name);
	return {
		id,
		href: `/artist/${id}`,
		name,
		visitedAt:
			typeof candidate.visitedAt === 'number' && Number.isFinite(candidate.visitedAt)
				? candidate.visitedAt
				: Date.now()
	};
}

function readInitialState(): NavigationHistoryState {
	if (!browser) {
		return EMPTY_STATE;
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return EMPTY_STATE;
		}
		const parsed = JSON.parse(raw) as Partial<NavigationHistoryState> | null;
		const albums = Array.isArray(parsed?.albums)
			? parsed.albums
					.map((entry) => normalizeAlbumEntry(entry))
					.filter((entry): entry is AlbumHistoryEntry => entry !== null)
					.slice(0, MAX_ALBUM_HISTORY)
			: [];
		const artists = Array.isArray(parsed?.artists)
			? parsed.artists
					.map((entry) => normalizeArtistEntry(entry))
					.filter((entry): entry is ArtistHistoryEntry => entry !== null)
					.slice(0, MAX_ARTIST_HISTORY)
			: [];
		return { albums, artists };
	} catch (error) {
		console.warn('Failed to restore navigation history from storage', error);
		return EMPTY_STATE;
	}
}

function createNavigationHistoryStore() {
	const { subscribe, set, update } = writable<NavigationHistoryState>(readInitialState());

	if (browser) {
		subscribe((state) => {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch (error) {
				console.warn('Failed to persist navigation history to storage', error);
			}
		});
	}

	return {
		subscribe,
		visitAlbum(input: AlbumVisitInput): void {
			const id = Number(input.id);
			if (!Number.isFinite(id) || id <= 0) {
				return;
			}
			const next: AlbumHistoryEntry = {
				id,
				href: `/album/${id}`,
				title: normalizeAlbumTitle(input.title),
				artistName: normalizeArtistName(input.artistName),
				visitedAt: Date.now()
			};
			update((state) => ({
				...state,
				albums: [next, ...state.albums.filter((entry) => entry.id !== id)].slice(
					0,
					MAX_ALBUM_HISTORY
				)
			}));
		},
		visitArtist(input: ArtistVisitInput): void {
			const id = Number(input.id);
			if (!Number.isFinite(id) || id <= 0) {
				return;
			}
			const next: ArtistHistoryEntry = {
				id,
				href: `/artist/${id}`,
				name: normalizeArtistName(input.name),
				visitedAt: Date.now()
			};
			update((state) => ({
				...state,
				artists: [next, ...state.artists.filter((entry) => entry.id !== id)].slice(
					0,
					MAX_ARTIST_HISTORY
				)
			}));
		},
		clear(): void {
			set(EMPTY_STATE);
		}
	};
}

export const navigationHistoryStore = createNavigationHistoryStore();
