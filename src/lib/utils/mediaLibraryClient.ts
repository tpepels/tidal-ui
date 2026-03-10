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

export type FullLibraryRepairStatusResult = {
	success: boolean;
	status?: 'idle' | 'running' | 'completed' | 'failed';
	startedAt?: number | null;
	finishedAt?: number | null;
	currentAlbum?: {
		index: number;
		total: number;
		artistName: string;
		albumTitle: string;
	} | null;
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
	error?: string | null;
};

export type MediaLibraryDeduplicateResult = {
	success: boolean;
	scannedAt?: number;
	dryRun?: boolean;
	albumsScanned?: number;
	duplicateAlbumGroups?: number;
	duplicateAlbumDirs?: number;
	albumsMerged?: number;
	filesMovedBetweenAlbums?: number;
	albumsWithTrackDuplicates?: number;
	duplicateTrackGroups?: number;
	duplicateFilesBackedUp?: number;
	backupRoot?: string;
	report?: {
		startedAt: number;
		finishedAt: number;
		durationMs: number;
		dryRun: boolean;
		albumsScanned: number;
		albumsMerged: number;
		filesMovedBetweenAlbums: number;
		duplicateTrackGroups: number;
		duplicateFilesBackedUp: number;
		backupRoot?: string;
	};
	error?: string;
};

export type MediaLibraryDeduplicateStatusResult = {
	success: boolean;
	status?: 'idle' | 'running' | 'completed' | 'failed';
	startedAt?: number | null;
	finishedAt?: number | null;
	progress?: {
		phase: 'scan' | 'merge' | 'track_dedupe' | 'complete';
		message: string;
		processed: number;
		total: number;
		currentArtistDir?: string;
		currentAlbumDir?: string;
		summary: {
			scannedAt: number;
			dryRun: boolean;
			albumsScanned: number;
			duplicateAlbumGroups: number;
			duplicateAlbumDirs: number;
			albumsMerged: number;
			filesMovedBetweenAlbums: number;
			albumsWithTrackDuplicates: number;
			duplicateTrackGroups: number;
			duplicateFilesBackedUp: number;
			backupRoot?: string;
		};
	} | null;
	result?: {
		scannedAt: number;
		dryRun: boolean;
		albumsScanned: number;
		duplicateAlbumGroups: number;
		duplicateAlbumDirs: number;
		albumsMerged: number;
		filesMovedBetweenAlbums: number;
		albumsWithTrackDuplicates: number;
		duplicateTrackGroups: number;
		duplicateFilesBackedUp: number;
		backupRoot?: string;
	} | null;
	report?: {
		startedAt: number;
		finishedAt: number;
		durationMs: number;
		dryRun: boolean;
		albumsScanned: number;
		albumsMerged: number;
		filesMovedBetweenAlbums: number;
		duplicateTrackGroups: number;
		duplicateFilesBackedUp: number;
		backupRoot?: string;
	} | null;
	error?: string | null;
};

export type MediaLibrarySweepTemporaryResult = {
	success: boolean;
	scannedAt?: number;
	baseDir?: string;
	dryRun?: boolean;
	artistDirsScanned?: number;
	artifactDirsFound?: number;
	artifactDirsRemoved?: number;
	samplePaths?: string[];
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

export async function fetchFullLibraryRepairStatus(): Promise<FullLibraryRepairStatusResult> {
	try {
		const response = await fetch('/api/media-library/repair-all');
		const payload = (await response.json()) as FullLibraryRepairStatusResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to fetch full-library repair status'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to fetch full-library repair status'
		};
	}
}

export async function deduplicateLibraryInLibrary(input?: {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
}): Promise<MediaLibraryDeduplicateResult> {
	try {
		const response = await fetch('/api/media-library/deduplicate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(input ?? {})
		});
		const payload = (await response.json()) as MediaLibraryDeduplicateResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to deduplicate media library'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to deduplicate media library'
		};
	}
}

export async function fetchLibraryDeduplicateStatus(): Promise<MediaLibraryDeduplicateStatusResult> {
	try {
		const response = await fetch('/api/media-library/deduplicate');
		const payload = (await response.json()) as MediaLibraryDeduplicateStatusResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to fetch deduplicate status'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to fetch deduplicate status'
		};
	}
}

export async function sweepTemporaryLibraryArtifacts(input?: {
	dryRun?: boolean;
}): Promise<MediaLibrarySweepTemporaryResult> {
	try {
		const response = await fetch('/api/media-library/sweep-temporary', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(input ?? {})
		});
		const payload = (await response.json()) as MediaLibrarySweepTemporaryResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to sweep temporary album artifacts'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to sweep temporary album artifacts'
		};
	}
}
