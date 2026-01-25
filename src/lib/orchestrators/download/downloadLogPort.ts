import { downloadLogStore } from '$lib/stores/downloadLog';

export interface DownloadLogPort {
	success: (message: string) => void;
	error: (message: string) => void;
}

export const createDownloadLogPort = (): DownloadLogPort => ({
	success: (message) => downloadLogStore.success(message),
	error: (message) => downloadLogStore.error(message)
});
