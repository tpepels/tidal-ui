export function parseAlbumResponse(data: unknown): {
	album: Record<string, unknown>;
	tracks: Array<Record<string, unknown>>;
} {
	if (!data) {
		throw new Error('Empty response from API');
	}

	if (data && typeof data === 'object' && 'data' in data) {
		const dataObj = data as { data?: unknown };
		if (dataObj.data && typeof dataObj.data === 'object' && 'items' in dataObj.data) {
			const items = (dataObj.data as { items?: unknown }).items;
			if (Array.isArray(items) && items.length > 0) {
				const firstItem = items[0];
				const firstTrack =
					firstItem && typeof firstItem === 'object' && 'item' in firstItem
						? (firstItem as { item: unknown }).item
						: firstItem;

				if (firstTrack && typeof firstTrack === 'object' && 'album' in firstTrack) {
					const albumData = (firstTrack as { album?: unknown }).album;
					if (!albumData || typeof albumData !== 'object') {
						throw new Error('Invalid album data in API response');
					}
					const album = albumData as Record<string, unknown>;

					const tracks = items
						.map((item: unknown) => {
							if (!item || typeof item !== 'object') return null;
							const resolved = 'item' in item ? (item as { item: unknown }).item : item;
							if (!resolved || typeof resolved !== 'object') return null;
							const track = resolved as Record<string, unknown>;
							if (!track.id || typeof track.id !== 'number') return null;
							return track;
						})
						.filter((track): track is Record<string, unknown> => track !== null);

					if (tracks.length === 0) {
						throw new Error('No valid tracks found in album');
					}

					return { album, tracks };
				}
			}
		}
	}

	const entries = Array.isArray(data) ? data : [data];
	let album: Record<string, unknown> | undefined;
	let trackCollection: { items?: unknown[] } | undefined;

	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') continue;

		if (!album && 'title' in entry && 'id' in entry) {
			album = entry as Record<string, unknown>;
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

	if (!album) {
		throw new Error('Album not found in response');
	}

	const tracks: Array<Record<string, unknown>> = [];
	if (trackCollection?.items) {
		for (const rawItem of trackCollection.items) {
			if (!rawItem || typeof rawItem !== 'object') continue;

			const trackObj =
				'item' in rawItem && rawItem.item && typeof rawItem.item === 'object'
					? (rawItem.item as Record<string, unknown>)
					: (rawItem as Record<string, unknown>);

			if (trackObj.id && typeof trackObj.id === 'number') {
				tracks.push(trackObj);
			}
		}
	}

	if (tracks.length === 0) {
		throw new Error('No valid tracks found in album response');
	}

	return { album, tracks };
}

export function warnIfAlbumTrackListIncomplete(
	albumId: number,
	album: Record<string, unknown>,
	tracks: Array<Record<string, unknown>>
): void {
	const rawExpectedCount = Number(album.numberOfTracks);
	if (!Number.isFinite(rawExpectedCount) || rawExpectedCount <= 0) {
		return;
	}
	const expectedCount = Math.trunc(rawExpectedCount);
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

	if (tracks.length >= expectedCount && missingTrackNumbers.length === 0) {
		return;
	}

	const missingPart =
		missingTrackNumbers.length > 0
			? ` Missing track number(s): ${missingTrackNumbers.join(', ')}.`
			: '';
	console.warn(
		`[Worker] Album ${albumId} metadata incomplete: received ${tracks.length}/${expectedCount} track item(s).${missingPart}`
	);
}
