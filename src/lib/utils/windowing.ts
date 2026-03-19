export interface VirtualWindowRange {
	startIndex: number;
	endIndex: number;
	paddingStart: number;
	paddingEnd: number;
	windowed: boolean;
}

export interface VirtualWindowInput {
	totalItems: number;
	itemHeight: number;
	viewportHeight: number;
	scrollOffset: number;
	overscan?: number;
	threshold?: number;
}

export interface ResponsiveItemHeightInput {
	itemHeight: number;
	itemHeightMobile?: number;
	mobileBreakpoint?: number;
	viewportWidth?: number | null;
}

export function createFullWindowRange(totalItems: number): VirtualWindowRange {
	return {
		startIndex: 0,
		endIndex: Math.max(0, totalItems),
		paddingStart: 0,
		paddingEnd: 0,
		windowed: false
	};
}

export function computeVirtualWindowRange(input: VirtualWindowInput): VirtualWindowRange {
	const totalItems = Math.max(0, Math.floor(input.totalItems));
	const itemHeight = Math.max(1, input.itemHeight || 1);
	const viewportHeight = Math.max(0, input.viewportHeight || 0);
	const scrollOffset = Math.max(0, input.scrollOffset || 0);
	const overscan = Math.max(0, Math.floor(input.overscan ?? 6));
	const threshold = Math.max(1, Math.floor(input.threshold ?? 40));

	if (totalItems === 0 || viewportHeight <= 0 || totalItems <= threshold) {
		return createFullWindowRange(totalItems);
	}

	const totalHeight = totalItems * itemHeight;
	if (totalHeight <= viewportHeight * 1.5) {
		return createFullWindowRange(totalItems);
	}

	const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemHeight));
	const rawStartIndex = Math.floor(scrollOffset / itemHeight) - overscan;
	const maxStartIndex = Math.max(0, totalItems - visibleCount);
	const startIndex = clamp(rawStartIndex, 0, maxStartIndex);
	const endIndex = clamp(startIndex + visibleCount + overscan * 2, startIndex, totalItems);

	return {
		startIndex,
		endIndex,
		paddingStart: startIndex * itemHeight,
		paddingEnd: Math.max(0, (totalItems - endIndex) * itemHeight),
		windowed: true
	};
}

export function resolveResponsiveItemHeight(input: ResponsiveItemHeightInput): number {
	const baseHeight = Math.max(1, Math.floor(input.itemHeight || 1));
	const mobileHeight = Math.floor(input.itemHeightMobile ?? 0);
	if (mobileHeight <= 0) {
		return baseHeight;
	}

	const viewportWidth = Math.max(0, Math.floor(input.viewportWidth ?? 0));
	if (viewportWidth <= 0) {
		return baseHeight;
	}

	const mobileBreakpoint = Math.max(1, Math.floor(input.mobileBreakpoint ?? 640));
	if (viewportWidth <= mobileBreakpoint) {
		return Math.max(1, mobileHeight);
	}

	return baseHeight;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
