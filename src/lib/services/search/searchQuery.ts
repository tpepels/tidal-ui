export function normalizeToken(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

export function splitTokens(value: string): string[] {
	return normalizeToken(value)
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length > 1);
}

export function hasWildcardPattern(value: string): boolean {
	return /[*?]/.test(value);
}

export function stripWildcardOperators(value: string): string {
	return value
		.replace(/[*?]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function buildWildcardRegex(pattern: string): RegExp | null {
	const normalizedPattern = normalizeToken(pattern).replace(/\s+/g, ' ').trim();
	if (!normalizedPattern || !hasWildcardPattern(normalizedPattern)) {
		return null;
	}
	const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const wildcardPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${wildcardPattern}$`);
}

export function queryMatchesArtistName(
	normalizedName: string,
	artistQuery: string,
	strict = false
): boolean {
	const cleanedQuery = stripWildcardOperators(artistQuery);
	const normalizedQuery = normalizeToken(cleanedQuery);
	if (!normalizedQuery && !hasWildcardPattern(artistQuery)) {
		return true;
	}

	const wildcardRegex = buildWildcardRegex(artistQuery);

	if (strict) {
		if (wildcardRegex) {
			return wildcardRegex.test(normalizedName);
		}
		return normalizedName === normalizedQuery;
	}

	if (wildcardRegex && wildcardRegex.test(normalizedName)) {
		return true;
	}

	if (
		normalizedQuery &&
		(normalizedName === normalizedQuery ||
			normalizedName.includes(normalizedQuery) ||
			normalizedQuery.includes(normalizedName))
	) {
		return true;
	}

	const queryTokens = splitTokens(cleanedQuery);
	if (queryTokens.length === 0) {
		return false;
	}
	const matchedTokenCount = queryTokens.filter((token) => normalizedName.includes(token)).length;
	const minimumMatches = Math.max(1, Math.ceil(queryTokens.length * 0.5));
	return matchedTokenCount >= minimumMatches;
}

export function buildArtistSeedQueries(artistQuery: string): string[] {
	const cleaned = stripWildcardOperators(artistQuery);
	if (!cleaned) {
		return [];
	}

	const variants = new Set<string>();
	const addVariant = (candidate: string): void => {
		const trimmed = candidate.trim().replace(/\s+/g, ' ');
		if (trimmed.length > 1) {
			variants.add(trimmed);
		}
	};

	addVariant(cleaned);
	const tokens = cleaned
		.split(/[^A-Za-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length > 1);
	for (const token of tokens) {
		addVariant(token);
	}
	if (tokens.length >= 2) {
		addVariant(`${tokens[0]} ${tokens[tokens.length - 1]}`);
	}

	return Array.from(variants).slice(0, 6);
}

export function extractArtistHintsFromAlbumQuery(query: string): string[] {
	const hints = new Set<string>();
	const trimmed = query.trim();
	if (!trimmed) return [];

	const dashMatch = trimmed.match(/^(.+?)\s[-–—]\s(.+)$/);
	if (dashMatch) {
		const leftSide = dashMatch[1]?.trim();
		if (leftSide && leftSide.length > 1) {
			hints.add(leftSide);
		}
	}

	const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
	if (byMatch) {
		const artistSide = byMatch[2]?.trim();
		if (artistSide && artistSide.length > 1) {
			hints.add(artistSide);
		}
	}

	const commaMatch = trimmed.match(/^(.+?),\s*([^,]+)$/);
	if (commaMatch) {
		const rightSide = commaMatch[2]?.trim();
		if (rightSide && rightSide.length > 1) {
			hints.add(rightSide);
		}
	}

	return Array.from(hints);
}

export function expandAlbumQueryVariants(query: string): string[] {
	const variants = new Set<string>();
	const addVariant = (candidate: string): void => {
		const trimmed = candidate.trim().replace(/\s+/g, ' ');
		if (trimmed.length > 1) {
			variants.add(trimmed);
		}
	};

	addVariant(query);

	const withoutParentheses = query.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
	addVariant(withoutParentheses);

	const withoutEditionTerms = withoutParentheses.replace(
		/\b(deluxe|remaster(?:ed)?|anniversary|expanded|edition|version|clean|explicit|bonus|collector'?s?)\b/gi,
		' '
	);
	addVariant(withoutEditionTerms);

	const beforeColon = query.split(':')[0] ?? '';
	addVariant(beforeColon);

	const withoutPunctuation = query.replace(/[^\p{L}\p{N}\s]/gu, ' ');
	addVariant(withoutPunctuation);

	return Array.from(variants);
}
