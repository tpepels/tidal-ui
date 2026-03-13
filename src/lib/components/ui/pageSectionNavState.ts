export function normalizeSectionId(value: string | null | undefined): string {
	return String(value ?? '')
		.replace(/^#/, '')
		.trim();
}

export function resolveHashSectionId(
	hashValue: string | null | undefined,
	knownIds: Iterable<string>
): string {
	const normalizedHash = normalizeSectionId(hashValue);
	if (!normalizedHash) {
		return '';
	}
	for (const id of knownIds) {
		if (id === normalizedHash) {
			return normalizedHash;
		}
	}
	return '';
}

export function buildSectionHashUrl(
	location: Pick<Location, 'pathname' | 'search'>,
	sectionId: string
): string {
	const normalizedId = normalizeSectionId(sectionId);
	return `${location.pathname}${location.search}${normalizedId ? `#${normalizedId}` : ''}`;
}

export function shouldSkipInitialSectionHashSync(params: {
	lastObservedId: string;
	currentHash: string | null | undefined;
	nextId: string;
	firstVisibleId: string;
}): boolean {
	return (
		!normalizeSectionId(params.lastObservedId) &&
		!normalizeSectionId(params.currentHash) &&
		normalizeSectionId(params.nextId) === normalizeSectionId(params.firstVisibleId)
	);
}
