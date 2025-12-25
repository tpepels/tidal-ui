import type { Track, Album, Playlist, ArtistDetails } from '../types';
import { LosslessAPI } from './client';

/**
 * Content fetching functionality for the Tidal API
 */
export class ContentAPI extends LosslessAPI {
	/**
	 * Get album details with tracks
	 */
	async getAlbum(id: number): Promise<{ album: Album; tracks: Track[] }> {
		const response = await this.fetch(`${this.baseUrl}/album/?id=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get album');
		const data = await response.json();

		// Handle v2/new API structure where response is { version, data: { items: [...] } }
		if (data && typeof data === 'object' && 'data' in data && 'items' in data.data) {
			const items = data.data.items;
			if (Array.isArray(items) && items.length > 0) {
				const firstItem = items[0];
				const firstTrack = firstItem.item || firstItem;

				if (firstTrack && firstTrack.album) {
					let albumEntry = this.prepareAlbum(firstTrack.album);

					// If album doesn't have artist info, try to get it from the track
					if (!albumEntry.artist && firstTrack.artist) {
						albumEntry = { ...albumEntry, artist: firstTrack.artist };
					}

					const tracks = items
						.map((i: unknown) => {
							if (!i || typeof i !== 'object') return null;
							const itemObj = i as { item?: unknown };
							const t = (itemObj.item || itemObj) as Track;

							if (!t) return null;
							// Ensure track has album reference
							return this.prepareTrack({ ...t, album: albumEntry });
						})
						.filter((t): t is Track => t !== null);

					return { album: albumEntry, tracks };
				}
			}
		}

		const entries = Array.isArray(data) ? data : [data];

		let albumEntry: Album | undefined;
		let trackCollection: { items?: unknown[] } | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;

			if (!albumEntry && 'title' in entry && 'id' in entry && 'cover' in entry) {
				albumEntry = this.prepareAlbum(entry as Album);
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
			throw new Error('Album not found');
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
				tracks.push(this.prepareTrack(candidateWithAlbum));
			}
		}

		return { album: albumEntry, tracks };
	}

	/**
	 * Get playlist details
	 */
	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		const response = await this.fetch(`${this.baseUrl}/playlist/?id=${uuid}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get playlist');
		const data = await response.json();

		// Handle v2 structure (object with playlist and items keys)
		if (data && typeof data === 'object' && 'playlist' in data && 'items' in data) {
			return {
				playlist: data.playlist,
				items: data.items
			};
		}

		return {
			playlist: Array.isArray(data) ? data[0] : data,
			items: Array.isArray(data) && data[1] ? data[1].items : []
		};
	}

	/**
	 * Get artist overview, including discography modules and top tracks
	 */
	async getArtist(id: number): Promise<ArtistDetails> {
		const response = await this.fetch(`${this.baseUrl}/artist/?f=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get artist');
		const data = await response.json();
		const entries = Array.isArray(data) ? data : [data];

		let artistDetails: ArtistDetails | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;

			if (!artistDetails) {
				artistDetails = entry as ArtistDetails;
				break;
			}
		}

		if (!artistDetails) {
			throw new Error('Artist not found');
		}

		return artistDetails;
	}
}
