export type AlbumLibraryStatusInput = {
	id: number;
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
};

export type AlbumLibraryStatusMap = Record<number, { exists: boolean; matchedTracks: number }>;

export type AlbumRepairTrackInput = {
	trackId: number;
	trackTitle?: string;
	trackNumber?: number;
	durationSeconds?: number;
};

export type AlbumRepairResult = {
	success: boolean;
	albumId?: number;
	scannedAt?: number;
	summary?: {
		expected: number;
		healthy: number;
		missing: number;
		corrupt: number;
		repairNeeded: number;
		queued: number;
	};
	repairTargets?: Array<{
		trackId: number;
		trackTitle?: string;
		trackNumber?: number;
		status: 'healthy' | 'missing' | 'corrupt';
		reason?: string;
		relativePath?: string;
	}>;
	queuedJobIds?: string[];
	error?: string;
};

export type FullLibraryRepairResult = {
	success: boolean;
	startedAt?: number;
	finishedAt?: number;
	durationMs?: number;
	queueEnabled?: boolean;
	quality?: 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';
	summary?: {
		albumsDiscovered: number;
		albumsProcessed: number;
		albumsMatched: number;
		albumsUnresolved: number;
		albumsErrored: number;
		albumsWithRepairTargets: number;
		albumsWithQueuedRepairs: number;
		tracksExpected: number;
		tracksHealthy: number;
		tracksMissing: number;
		tracksCorrupt: number;
		tracksQueued: number;
	};
	unresolvedAlbums?: Array<{
		artistName: string;
		albumTitle: string;
		reason: string;
	}>;
	errorAlbums?: Array<{
		artistName: string;
		albumTitle: string;
		reason: string;
	}>;
	error?: string;
};

export async function fetchAlbumLibraryStatus(
	albums: AlbumLibraryStatusInput[]
): Promise<AlbumLibraryStatusMap> {
	if (!Array.isArray(albums) || albums.length === 0) {
		return {};
	}

	try {
		const response = await fetch('/api/media-library/status', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ albums })
		});
		if (!response.ok) {
			return {};
		}
		const payload = (await response.json()) as {
			success?: boolean;
			albums?: AlbumLibraryStatusMap;
		};
		if (!payload.success || !payload.albums) {
			return {};
		}
		return payload.albums;
	} catch {
		return {};
	}
}

export async function repairAlbumInLibrary(input: {
	albumId: number;
	artistName?: string;
	albumTitle?: string;
	quality: 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';
	tracks: AlbumRepairTrackInput[];
	coverUrl?: string;
	forceRescan?: boolean;
	queue?: boolean;
}): Promise<AlbumRepairResult> {
	try {
		const response = await fetch('/api/media-library/repair', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(input)
		});
		const payload = (await response.json()) as AlbumRepairResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to inspect/repair album'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to inspect/repair album'
		};
	}
}

export async function repairFullLibraryInLibrary(input: {
	quality: 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS';
	forceRescan?: boolean;
	queue?: boolean;
	maxAlbums?: number;
}): Promise<FullLibraryRepairResult> {
	try {
		const response = await fetch('/api/media-library/repair-all', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(input)
		});
		const payload = (await response.json()) as FullLibraryRepairResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to auto-repair full library'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to auto-repair full library'
		};
	}
}
