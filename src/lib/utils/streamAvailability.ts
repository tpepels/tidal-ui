import type { AudioQuality, TrackLookup } from '$lib/types';

export function isPreviewAssetPresentation(assetPresentation: string | null | undefined): boolean {
	return assetPresentation?.trim().toUpperCase() === 'PREVIEW';
}

export function isPreviewClipError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.message.includes('preview clip') || error.message.includes('assetPresentation');
}

export function assertFullTrackStream(
	lookup: Pick<TrackLookup, 'info'>,
	context: { trackId: number; quality: AudioQuality }
): void {
	if (!isPreviewAssetPresentation(lookup.info?.assetPresentation)) {
		return;
	}

	throw new Error(
		`TIDAL returned a 30-second preview clip instead of the full track ` +
			`(assetPresentation: PREVIEW). Track ${context.trackId} may not be available in ` +
			`${context.quality} quality on this account.`
	);
}
