import { downloadLogStore } from '$lib/stores/downloadLog';

export interface DownloadLogPort {
	log: (message: string) => void;
	success: (message: string) => void;
	warning: (message: string) => void;
	error: (message: string) => void;
}

export const createDownloadLogPort = (): DownloadLogPort => ({
	log: (message) => downloadLogStore.log(message),
	success: (message) => downloadLogStore.success(message),
	warning: (message) => downloadLogStore.warning(message),
	error: (message) => downloadLogStore.error(message)
});
