interface CacheEntry<T> {
	data: T;
	timestamp: number;
	ttl: number;
}

class ApiCache {
	private cache = new Map<string, CacheEntry<any>>();
	private maxSize = 100;

	set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
		if (this.cache.size >= this.maxSize) {
			// Remove oldest entry
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			ttl: ttlMs
		});
	}

	get<T>(key: string): T | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		if (Date.now() - entry.timestamp > entry.ttl) {
			this.cache.delete(key);
			return null;
		}

		return entry.data as T;
	}

	clear(): void {
		this.cache.clear();
	}

	delete(key: string | undefined): void {
		if (key) {
			this.cache.delete(key);
		}
	}

	size(): number {
		return this.cache.size;
	}
}

export const apiCache = new ApiCache();

export { ApiCache };
