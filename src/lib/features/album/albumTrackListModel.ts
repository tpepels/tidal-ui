import type { Album, Track } from '$lib/types';

export function resolveExpectedTrackCount(album: Album | null): number | null {
	const count = Number(album?.numberOfTracks);
	if (!Number.isFinite(count) || count <= 0) {
		return null;
	}
	return Math.trunc(count);
}

export function findMissingTrackNumbers(
	tracks: Track[],
	expectedTrackCount: number | null
): number[] {
	if (!expectedTrackCount) {
		return [];
	}

	const observedTrackNumbers = new Set<number>();
	for (const track of tracks) {
		const trackNumber = Number(track.trackNumber);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			observedTrackNumbers.add(Math.trunc(trackNumber));
		}
	}

	const missing: number[] = [];
	for (let expected = 1; expected <= expectedTrackCount; expected += 1) {
		if (!observedTrackNumbers.has(expected)) {
			missing.push(expected);
		}
	}
	return missing;
}
