export type AlbumDownloadStatus =
	| 'idle'
	| 'submitting'
	| 'queued'
	| 'processing'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'cancelled';

export type AlbumDownloadEvent =
	| 'submit'
	| 'queue'
	| 'start'
	| 'pause'
	| 'resume'
	| 'complete'
	| 'fail'
	| 'cancel'
	| 'reset';

export function reduceAlbumDownloadStatus(
	current: AlbumDownloadStatus,
	event: AlbumDownloadEvent
): AlbumDownloadStatus {
	switch (event) {
		case 'submit':
			return 'submitting';
		case 'queue':
			return 'queued';
		case 'start':
			return 'processing';
		case 'pause':
			return 'paused';
		case 'resume':
			return 'queued';
		case 'complete':
			return 'completed';
		case 'fail':
			return 'failed';
		case 'cancel':
			return 'cancelled';
		case 'reset':
			return 'idle';
		default:
			return current;
	}
}

export function isAlbumDownloadQueueActive(status: AlbumDownloadStatus): boolean {
	return status === 'queued' || status === 'processing';
}

export function canResumeAlbumDownload(status: AlbumDownloadStatus): boolean {
	return status === 'paused';
}

export function isAlbumDownloadTerminal(status: AlbumDownloadStatus): boolean {
	return status === 'completed' || status === 'failed' || status === 'cancelled';
}
