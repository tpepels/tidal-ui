import type { Album, Track } from '$lib/types';

export type CatalogApiContext = {
	baseUrl: string;
	fetch: (url: string, options?: RequestInit) => Promise<Response>;
	ensureNotRateLimited: (response: Response) => void;
};

export type CatalogHttpError = Error & { status?: number; cached?: boolean };

export type CatalogAlbumLookupResult = {
	album: Album;
	tracks: Track[];
};
