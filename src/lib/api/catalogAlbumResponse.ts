import { prepareAlbum, prepareTrack } from './normalizers';
import {
	AlbumWithTracksSchema,
	ApiV2ContainerSchema,
	safeValidateApiResponse
} from '$lib/utils/schemas';
import type { Album, Track } from '$lib/types';
import type { CatalogAlbumLookupResult } from './catalogTypes';

function summarizeMissingAlbumTrackNumbers(
	album: Album,
	tracks: Track[]
): {
	expectedCount: number | null;
	missingTrackNumbers: number[];
} {
	const rawExpectedCount = Number(album.numberOfTracks);
	const expectedCount =
		Number.isFinite(rawExpectedCount) && rawExpectedCount > 0 ? Math.trunc(rawExpectedCount) : null;
	if (!expectedCount) {
		return { expectedCount: null, missingTrackNumbers: [] };
	}

	const observedTrackNumbers = new Set<number>();
	for (const track of tracks) {
		const trackNumber = Number(track.trackNumber);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			observedTrackNumbers.add(Math.trunc(trackNumber));
		}
	}

	const missingTrackNumbers: number[] = [];
	for (let expected = 1; expected <= expectedCount; expected += 1) {
		if (!observedTrackNumbers.has(expected)) {
			missingTrackNumbers.push(expected);
		}
	}

	return { expectedCount, missingTrackNumbers };
}

export function warnIfAlbumTrackListIncomplete(
	albumId: number,
	album: Album,
	tracks: Track[]
): void {
	const { expectedCount, missingTrackNumbers } = summarizeMissingAlbumTrackNumbers(album, tracks);
	if (!expectedCount) {
		return;
	}
	if (tracks.length >= expectedCount && missingTrackNumbers.length === 0) {
		return;
	}

	const missingPart =
		missingTrackNumbers.length > 0
			? ` Missing track number(s): ${missingTrackNumbers.join(', ')}.`
			: '';
	console.warn(
		`[Catalog] Album ${albumId} returned ${tracks.length}/${expectedCount} track item(s).${missingPart}`
	);
}

function validateAlbumLookupResult(result: CatalogAlbumLookupResult): CatalogAlbumLookupResult {
	const finalValidation = safeValidateApiResponse(result, AlbumWithTracksSchema, {
		endpoint: 'catalog.album'
	});
	if (!finalValidation.success) {
		throw new Error('Album response validation failed');
	}
	return result;
}

export function parseAlbumLookupPayload(
	data: unknown
): CatalogAlbumLookupResult | null {
	safeValidateApiResponse({ data }, ApiV2ContainerSchema, {
		endpoint: 'catalog.album.container',
		allowUnvalidated: true
	});

	if (data && typeof data === 'object') {
		const container = data as { data?: { items?: unknown } };
		const items = container.data?.items;
		if (Array.isArray(items) && items.length > 0) {
			const firstItem = items[0];
			const firstTrack = firstItem.item || firstItem;

			if (firstTrack && firstTrack.album) {
				let albumEntry = prepareAlbum(firstTrack.album);

				if (!albumEntry.artist && firstTrack.artist) {
					albumEntry = { ...albumEntry, artist: firstTrack.artist };
				}

				const tracks = items
					.map((item: unknown) => {
						if (!item || typeof item !== 'object') return null;
						const itemObj = item as { item?: unknown };
						const track = (itemObj.item || itemObj) as Track;

						if (!track) return null;
						return prepareTrack({ ...track, album: albumEntry });
					})
					.filter((track): track is Track => track !== null);

				return validateAlbumLookupResult({ album: albumEntry, tracks });
			}
		}
	}

	const entries = Array.isArray(data) ? data : [data];

	let albumEntry: Album | undefined;
	let trackCollection: { items?: unknown[] } | undefined;

	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') continue;

		if (!albumEntry && 'title' in entry && 'id' in entry && 'cover' in entry) {
			albumEntry = prepareAlbum(entry as Album);
			continue;
		}

		if (
			!trackCollection &&
			'items' in entry &&
			Array.isArray((entry as { items?: unknown[] }).items)
		) {
			trackCollection = entry as { items?: unknown[] };
		}
	}

	if (!albumEntry) {
		return null;
	}

	const tracks: Track[] = [];
	if (trackCollection?.items) {
		for (const rawItem of trackCollection.items) {
			if (!rawItem || typeof rawItem !== 'object') continue;

			let trackCandidate: Track | undefined;
			if ('item' in rawItem && rawItem.item && typeof rawItem.item === 'object') {
				trackCandidate = rawItem.item as Track;
			} else {
				trackCandidate = rawItem as Track;
			}

			if (!trackCandidate) continue;

			const candidateWithAlbum = trackCandidate.album
				? trackCandidate
				: ({ ...trackCandidate, album: albumEntry } as Track);
			tracks.push(prepareTrack(candidateWithAlbum));
		}
	}

	return validateAlbumLookupResult({ album: albumEntry, tracks });
}
