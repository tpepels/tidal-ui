import type { Album, Artist, Playlist, SonglinkTrack, Track } from '$lib/types';

export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';
export type RegionOption = 'auto' | 'us' | 'eu';

export type SearchProgressUpdate = {
	tab: 'albums';
	phase: 'base' | 'enriched';
	items: Album[];
	processedArtists?: number;
	totalArtists?: number;
};

export type SearchExecutionOptions = {
	albumArtistQuery?: string;
	strictAlbumArtistMatch?: boolean;
	onProgress?: (update: SearchProgressUpdate) => void;
};

export interface SearchResults {
	tracks: (Track | SonglinkTrack)[];
	albums: Album[];
	artists: Artist[];
	playlists: Playlist[];
}

export type SearchError =
	| { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
	| { code: 'INVALID_QUERY'; retry: false; message: string }
	| { code: 'API_ERROR'; retry: true; message: string; statusCode?: number }
	| { code: 'TIMEOUT'; retry: true; message: string }
	| { code: 'UNKNOWN_ERROR'; retry: false; message: string; originalError?: unknown };

export type SearchResult =
	| { success: true; results: SearchResults }
	| { success: false; error: SearchError };

export function createEmptySearchResults(): SearchResults {
	return {
		tracks: [],
		albums: [],
		artists: [],
		playlists: []
	};
}
