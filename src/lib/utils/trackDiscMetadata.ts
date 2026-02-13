type TrackDiscMetadataInput = {
	trackNumber?: number | null;
	totalTracks?: number | null;
	discNumber?: number | null;
	totalDiscs?: number | null;
};

function normalizePositiveInteger(value: number | null | undefined): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return Math.trunc(parsed);
}

export function buildTrackDiscMetadataEntries(
	input: TrackDiscMetadataInput
): Array<[string, string]> {
	const entries: Array<[string, string]> = [];
	const trackNumber = normalizePositiveInteger(input.trackNumber);
	const totalTracks = normalizePositiveInteger(input.totalTracks);
	const discNumber = normalizePositiveInteger(input.discNumber);
	const totalDiscs = normalizePositiveInteger(input.totalDiscs);

	if (trackNumber !== null) {
		entries.push([
			'track',
			totalTracks !== null ? `${trackNumber}/${totalTracks}` : `${trackNumber}`
		]);
	}
	if (totalTracks !== null) {
		entries.push(['TRACKTOTAL', `${totalTracks}`]);
	}
	if (discNumber !== null) {
		entries.push([
			'disc',
			totalDiscs !== null ? `${discNumber}/${totalDiscs}` : `${discNumber}`
		]);
	}
	if (totalDiscs !== null) {
		entries.push(['DISCTOTAL', `${totalDiscs}`]);
	}

	return entries;
}
