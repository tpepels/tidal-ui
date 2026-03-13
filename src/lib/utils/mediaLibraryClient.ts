export type AlbumLibraryStatusInput = {
	id: number;
	artistName?: string;
	albumTitle?: string;
	expectedTrackCount?: number;
};

export type AlbumLibraryStatusMap = Record<number, { exists: boolean; matchedTracks: number }>;

export type MediaLibraryArtistSuggestion = {
	artistDir: string;
	artistName: string;
	trackCount: number;
	albumCount: number;
	searchQuery: string;
};

export type MediaLibraryAlbumSuggestion = {
	artistDir: string;
	artistName: string;
	albumDir: string;
	albumTitle: string;
	trackCount: number;
	searchQuery: string;
};

export type MediaLibrarySuggestionsResult = {
	success: boolean;
	scannedAt?: number;
	totalArtists?: number;
	totalAlbums?: number;
	artists?: MediaLibraryArtistSuggestion[];
	albums?: MediaLibraryAlbumSuggestion[];
	error?: string;
};

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
	runId?: string;
	albumsScanned?: number;
	duplicateAlbumGroups?: number;
	duplicateAlbumDirs?: number;
	albumsMerged?: number;
	filesMovedBetweenAlbums?: number;
	filesMoveErrors?: number;
	albumsWithTrackDuplicates?: number;
	albumsSkipped?: number;
	duplicateTrackGroups?: number;
	manualReviewRequired?: number;
	duplicateFilesBackedUp?: number;
	backupErrors?: number;
	movedSamples?: string[];
	backedUpSamples?: string[];
	skippedSamples?: string[];
	failedSamples?: string[];
	backupRoot?: string;
	report?: {
		runId?: string;
		startedAt: number;
		finishedAt: number;
		durationMs: number;
		dryRun: boolean;
		albumsScanned: number;
		albumsMerged: number;
		filesMovedBetweenAlbums: number;
		filesMoveErrors: number;
		albumsSkipped: number;
		duplicateTrackGroups: number;
		manualReviewRequired: number;
		duplicateFilesBackedUp: number;
		backupErrors: number;
		backupRoot?: string;
		reportPath?: string | null;
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
			runId?: string;
			albumsScanned: number;
			duplicateAlbumGroups: number;
			duplicateAlbumDirs: number;
			albumsMerged: number;
			filesMovedBetweenAlbums: number;
			filesMoveErrors: number;
			albumsWithTrackDuplicates: number;
			albumsSkipped: number;
			duplicateTrackGroups: number;
			manualReviewRequired: number;
			duplicateFilesBackedUp: number;
			backupErrors: number;
			movedSamples: string[];
			backedUpSamples: string[];
			skippedSamples: string[];
			failedSamples: string[];
			backupRoot?: string;
		};
	} | null;
	result?: {
		scannedAt: number;
		dryRun: boolean;
		runId?: string;
		albumsScanned: number;
		duplicateAlbumGroups: number;
		duplicateAlbumDirs: number;
		albumsMerged: number;
		filesMovedBetweenAlbums: number;
		filesMoveErrors: number;
		albumsWithTrackDuplicates: number;
		albumsSkipped: number;
		duplicateTrackGroups: number;
		manualReviewRequired: number;
		duplicateFilesBackedUp: number;
		backupErrors: number;
		movedSamples: string[];
		backedUpSamples: string[];
		skippedSamples: string[];
		failedSamples: string[];
		backupRoot?: string;
	} | null;
	report?: {
		runId?: string;
		startedAt: number;
		finishedAt: number;
		durationMs: number;
		dryRun: boolean;
		albumsScanned: number;
		albumsMerged: number;
		filesMovedBetweenAlbums: number;
		filesMoveErrors: number;
		albumsSkipped: number;
		duplicateTrackGroups: number;
		manualReviewRequired: number;
		duplicateFilesBackedUp: number;
		backupErrors: number;
		backupRoot?: string;
		reportPath?: string | null;
	} | null;
	error?: string | null;
};

export type MediaLibrarySweepTemporaryResult = {
	success: boolean;
	runId?: string;
	reportPath?: string | null;
	scannedAt?: number;
	baseDir?: string;
	dryRun?: boolean;
	minAgeMs?: number;
	artistDirsScanned?: number;
	artifactDirsFound?: number;
	artifactDirsRemoved?: number;
	skippedTooFresh?: number;
	skippedActive?: number;
	samplePaths?: string[];
	error?: string;
};

export type MediaLibraryCorrectAndDeduplicateResult = {
	success: boolean;
	runId?: string;
	reportPath?: string | null;
	startedAt?: number;
	finishedAt?: number;
	durationMs?: number;
	dryRun?: boolean;
	sweep?: MediaLibrarySweepTemporaryResult;
	deduplicate?: MediaLibraryDeduplicateResult;
	partial?: {
		sweep?: MediaLibrarySweepTemporaryResult | null;
		deduplicate?: MediaLibraryDeduplicateResult | null;
	};
	error?: string;
};

export type MediaLibraryCorrectAndDeduplicateStatusResult = {
	success: boolean;
	status?: 'idle' | 'running' | 'completed' | 'failed';
	runId?: string | null;
	phase?: 'idle' | 'sweep' | 'deduplicate' | 'completed' | 'failed';
	startedAt?: number | null;
	finishedAt?: number | null;
	progress?: MediaLibraryDeduplicateStatusResult['progress'];
	result?: {
		runId: string;
		startedAt: number;
		finishedAt: number;
		durationMs: number;
		dryRun: boolean;
		sweep: MediaLibrarySweepTemporaryResult;
		deduplicate: MediaLibraryDeduplicateResult;
	} | null;
	error?: string | null;
};

export async function fetchAlbumLibraryStatus(
	albums: AlbumLibraryStatusInput[],
	options?: {
		force?: boolean;
	}
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
			body: JSON.stringify({
				albums,
				force: options?.force === true
			})
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

export async function fetchMediaLibrarySuggestions(input?: {
	artistLimit?: number;
	albumLimit?: number;
	force?: boolean;
}): Promise<MediaLibrarySuggestionsResult> {
	try {
		const params = new URLSearchParams();
		if (typeof input?.artistLimit === 'number' && Number.isFinite(input.artistLimit)) {
			params.set('artistLimit', String(Math.max(1, Math.trunc(input.artistLimit))));
		}
		if (typeof input?.albumLimit === 'number' && Number.isFinite(input.albumLimit)) {
			params.set('albumLimit', String(Math.max(1, Math.trunc(input.albumLimit))));
		}
		if (input?.force === true) {
			params.set('force', 'true');
		}

		const queryString = params.toString();
		const endpoint = queryString.length > 0 ? `/api/media-library/suggestions?${queryString}` : '/api/media-library/suggestions';
		const response = await fetch(endpoint);
		const payload = (await response.json()) as MediaLibrarySuggestionsResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to fetch media library suggestions'
			};
		}
		return {
			success: true,
			scannedAt: payload.scannedAt,
			totalArtists: payload.totalArtists,
			totalAlbums: payload.totalAlbums,
			artists: Array.isArray(payload.artists) ? payload.artists : [],
			albums: Array.isArray(payload.albums) ? payload.albums : []
		};
	} catch {
		return {
			success: false,
			error: 'Failed to fetch media library suggestions'
		};
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

export async function correctAndDeduplicateLibrary(input?: {
	dryRun?: boolean;
	forceRescan?: boolean;
	maxAlbums?: number;
}): Promise<MediaLibraryCorrectAndDeduplicateResult> {
	try {
		const response = await fetch('/api/media-library/correct-and-deduplicate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(input ?? {})
		});
		const payload = (await response.json()) as MediaLibraryCorrectAndDeduplicateResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to run correction sweep and deduplicate'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to run correction sweep and deduplicate'
		};
	}
}

export async function fetchCorrectAndDeduplicateStatus(): Promise<MediaLibraryCorrectAndDeduplicateStatusResult> {
	try {
		const response = await fetch('/api/media-library/correct-and-deduplicate');
		const payload = (await response.json()) as MediaLibraryCorrectAndDeduplicateStatusResult;
		if (!response.ok) {
			return {
				success: false,
				error: payload?.error || 'Failed to fetch correction + deduplicate status'
			};
		}
		return payload;
	} catch {
		return {
			success: false,
			error: 'Failed to fetch correction + deduplicate status'
		};
	}
}
