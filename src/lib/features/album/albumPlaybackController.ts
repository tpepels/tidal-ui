import type { Track } from '$lib/types';

type PlaybackFacadeLike = {
	loadQueue: (tracks: Track[], startIndex: number, options: { autoPlay: boolean }) => void;
	pause: () => void;
	play: () => void;
};

export function playAlbumTracks(tracks: Track[], playbackFacade: PlaybackFacadeLike): void {
	if (!Array.isArray(tracks) || tracks.length === 0) {
		console.warn('No tracks available to play');
		return;
	}

	try {
		playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
	} catch (error) {
		console.error('Failed to play album:', error);
	}
}

export function toggleAlbumPlayback(options: {
	tracks: Track[];
	isAlbumPlaying: boolean;
	isAlbumQueue: boolean;
	currentTrackId?: number;
	playbackFacade: PlaybackFacadeLike;
}): void {
	if (!Array.isArray(options.tracks) || options.tracks.length === 0) {
		console.warn('No tracks available to play');
		return;
	}

	if (options.isAlbumPlaying) {
		options.playbackFacade.pause();
		return;
	}

	if (options.isAlbumQueue) {
		const firstTrackId = options.tracks[0]?.id;
		if (options.currentTrackId !== firstTrackId) {
			options.playbackFacade.loadQueue(options.tracks, 0, { autoPlay: true });
		} else {
			options.playbackFacade.play();
		}
		return;
	}

	playAlbumTracks(options.tracks, options.playbackFacade);
}

export function shuffleAlbumTracks(list: Track[]): Track[] {
	const items = list.slice();
	for (let i = items.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[items[i], items[j]] = [items[j]!, items[i]!];
	}
	return items;
}
