/**
 * Download Queue Manager
 * 
 * Manages sequential download processing to prevent overwhelming the server
 * with concurrent requests. Handles re-queueing of failed downloads and
 * provides visibility into queued items.
 */

export interface QueuedDownload {
	id: string;
	trackId: number | string;
	trackTitle?: string;
	artistName?: string;
	albumId?: number | string;
	albumTitle?: string;
	priority: number;
	retryCount: number;
	maxRetries: number;
	error?: string;
	enqueuedAt: number;
	lastAttemptAt?: number;
}

export interface DownloadQueueConfig {
	maxConcurrent?: number;
	maxRetries?: number;
	autoRetryFailures?: boolean;
}

export interface DownloadQueueCallbacks {
	onStarted?: (item: QueuedDownload) => void;
	onCompleted?: (item: QueuedDownload) => void;
	onFailed?: (item: QueuedDownload, error: Error) => void;
	onRetry?: (item: QueuedDownload, attempt: number) => void;
}

export class DownloadQueue {
	private queue: Map<string, QueuedDownload> = new Map();
	private running: Set<string> = new Set();
	private paused: Set<string> = new Set();
	private maxConcurrent: number;
	private maxRetries: number;
	private autoRetryFailures: boolean;
	private callbacks: DownloadQueueCallbacks;
	private executor?: (downloadId: string) => Promise<void>;
	private processingPromises: Map<string, Promise<void>> = new Map();
	private isPaused: boolean = false;

	constructor(config: DownloadQueueConfig = {}, callbacks: DownloadQueueCallbacks = {}) {
		this.maxConcurrent = config.maxConcurrent ?? 4;
		this.maxRetries = config.maxRetries ?? 3;
		this.autoRetryFailures = config.autoRetryFailures ?? true;
		this.callbacks = callbacks;
	}

	/**
	 * Set the executor function for processing downloads
	 */
	setExecutor(executor: (downloadId: string) => Promise<void>): void {
		this.executor = executor;
	}

	/**
	 * Queue a download for processing
	 */
	enqueue(
		id: string,
		trackId: number | string,
		options?: {
			priority?: number;
			maxRetries?: number;
			trackTitle?: string;
			artistName?: string;
			albumId?: number | string;
			albumTitle?: string;
		}
	): void {
		if (this.queue.has(id)) {
			// Already queued, update priority if higher
			const existing = this.queue.get(id)!;
			existing.priority = Math.max(existing.priority, options?.priority ?? 0);
			return;
		}

		this.queue.set(id, {
			id,
			trackId,
			trackTitle: options?.trackTitle,
			artistName: options?.artistName,
			albumId: options?.albumId,
			albumTitle: options?.albumTitle,
			priority: options?.priority ?? 0,
			retryCount: 0,
			maxRetries: options?.maxRetries ?? this.maxRetries,
			enqueuedAt: Date.now()
		});

		this.processQueue();
	}

	/**
	 * Re-queue a failed download
	 */
	requeueFailed(id: string, error: string): void {
		const item = this.queue.get(id);
		if (!item) return;

		item.error = error;
		item.lastAttemptAt = Date.now();

		// Re-queue if retries remaining
		if (item.retryCount < item.maxRetries) {
			item.retryCount++;
			this.callbacks.onRetry?.(item, item.retryCount);
			this.running.delete(id);
			this.processQueue();
		} else {
			// Max retries exceeded - notify caller
			this.callbacks.onFailed?.(item, new Error(error));
			this.queue.delete(id);
		}
	}

	/**
	 * Mark a download as completed
	 */
	markCompleted(id: string): void {
		const item = this.queue.get(id);
		if (!item) return;

		this.callbacks.onCompleted?.(item);
		this.running.delete(id);
		this.queue.delete(id);
		this.processQueue();
	}

	/**
	 * Process the queue - start downloads up to max concurrent
	 */
	private async processQueue(): Promise<void> {
		if (!this.executor || this.isPaused) return;

		while (this.running.size < this.maxConcurrent && this.queue.size > 0) {
			// Get highest priority queued item
			const nextItem = Array.from(this.queue.values())
				.filter(item => !this.running.has(item.id) && !this.paused.has(item.id))
				.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)[0];

			if (!nextItem) break;

			this.running.add(nextItem.id);
			this.callbacks.onStarted?.(nextItem);

			// Process asynchronously without blocking
			const promise = this.executor(nextItem.id)
				.then(() => {
					this.markCompleted(nextItem.id);
				})
				.catch(() => {
					// Error handling delegated to caller via requeueFailed
				});

			this.processingPromises.set(nextItem.id, promise);
		}
	}

	/**
	 * Get current queue status
	 */
	getStatus() {
		const queuedItems = Array.from(this.queue.values());
		
		// Group items by album
		const albumGroups = new Map<string, QueuedDownload[]>();
		for (const item of queuedItems) {
			const albumKey = item.albumId ? String(item.albumId) : 'ungrouped';
			if (!albumGroups.has(albumKey)) {
				albumGroups.set(albumKey, []);
			}
			albumGroups.get(albumKey)!.push(item);
		}

		return {
			queued: this.queue.size,
			running: this.running.size,
			processing: this.processingPromises.size,
			paused: this.paused.size,
			isPaused: this.isPaused,
			queuedItems,
			albumGroups: Array.from(albumGroups.entries()).map(([albumId, tracks]) => ({
				albumId,
				albumTitle: tracks[0]?.albumTitle || 'Unknown Album',
				artistName: tracks[0]?.artistName || 'Unknown Artist',
				trackCount: tracks.length,
				tracks
			}))
		};
	}

	/**
	 * Pause all queue processing
	 */
	pause(): void {
		this.isPaused = true;
	}

	/**
	 * Resume queue processing
	 */
	resume(): void {
		if (!this.isPaused) return;
		this.isPaused = false;
		this.processQueue();
	}

	/**
	 * Stop all downloads (clears queue, removes running tasks)
	 */
	stop(): void {
		this.isPaused = true;
		this.queue.clear();
		this.running.clear();
		this.paused.clear();
		this.processingPromises.clear();
	}

	/**
	 * Restart the queue (resume and continue processing)
	 */
	restart(): void {
		this.paused.clear();
		this.resume();
	}

	/**
	 * Clear the queue
	 */
	clear(): void {
		this.queue.clear();
		this.running.clear();
		this.processingPromises.clear();
	}

	/**
	 * Wait for specific download to complete
	 */
	async waitFor(id: string, timeout = 300000): Promise<void> {
		const startTime = Date.now();
		while (this.queue.has(id) || this.running.has(id)) {
			if (Date.now() - startTime > timeout) {
				throw new Error(`Download timeout: ${id}`);
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}
}
