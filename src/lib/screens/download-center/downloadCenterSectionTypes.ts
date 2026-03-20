export type DownloadCenterStats = {
	running: number;
	queued: number;
	paused: number;
	completed: number;
	failed: number;
	total: number;
};

export type DownloadCenterCollapsibleSection = 'active' | 'queue' | 'failed';

export type DownloadCenterJob = {
	id: string;
	status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
	job: {
		type: 'track' | 'album';
		trackId?: number;
		trackTitle?: string;
		artistName?: string;
		albumTitle?: string;
		albumId?: number;
		quality?: string;
		experimentalMusicBrainzTagging?: boolean;
		strictMusicBrainzMatching?: boolean;
		musicBrainzReleaseId?: string;
	};
	progress: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	lastUpdatedAt?: number;
	error?: string;
	trackCount?: number;
	completedTracks?: number;
};

export type DownloadCenterActionKeys = {
	refresh: string;
	bulkPause: string;
	bulkStop: string;
	bulkResume: string;
	bulkReport: string;
	createBundle: string;
	clearHistory: string;
};

export type DownloadCenterActionNotice = {
	tone: 'success' | 'error' | 'info';
	message: string;
} | null;
