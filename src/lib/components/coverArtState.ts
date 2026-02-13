export function normalizeCoverCandidates(values: unknown): string[] {
	if (!Array.isArray(values)) return [];

	const unique = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const trimmed = value.trim();
		if (!trimmed || unique.has(trimmed)) continue;
		unique.add(trimmed);
	}

	return Array.from(unique);
}

export function getNextCoverCandidate(
	candidates: string[],
	currentIndex: number
): { nextIndex: number; nextSrc: string | null; exhausted: boolean } {
	const safeIndex = Number.isFinite(currentIndex)
		? Math.max(-1, Math.trunc(currentIndex))
		: -1;
	const nextIndex = safeIndex + 1;
	if (nextIndex >= candidates.length) {
		return {
			nextIndex: safeIndex,
			nextSrc: null,
			exhausted: true
		};
	}

	return {
		nextIndex,
		nextSrc: candidates[nextIndex] ?? null,
		exhausted: false
	};
}
