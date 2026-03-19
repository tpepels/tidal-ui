import { losslessAPI } from '$lib/api';
import type { Album, PlayableTrack, Playlist, Track } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import { formatArtists } from '$lib/utils/formatters';
import type { ArtworkVM } from '$lib/presentation/viewModels';

type CoverSize = Parameters<typeof losslessAPI.getCoverUrl>[1];
type ArtistPictureSize = Parameters<typeof losslessAPI.getArtistPictureUrl>[1];

function buildFallbackLabel(value: string | null | undefined, fallback: string): string {
	const normalized = value?.trim();
	return normalized?.slice(0, 1).toUpperCase() || fallback;
}

export function resolveAlbumCoverUrl(
	coverId: string | null | undefined,
	size: CoverSize = '640'
): string | null {
	if (typeof coverId !== 'string' || coverId.trim().length === 0) {
		return null;
	}
	return losslessAPI.getCoverUrl(coverId, size) || null;
}

export function resolveArtistPictureUrl(
	picture: string | null | undefined,
	size: ArtistPictureSize = '750'
): string | null {
	if (typeof picture !== 'string' || picture.trim().length === 0) {
		return null;
	}
	const resolved = losslessAPI.getArtistPictureUrl(picture, size);
	return resolved?.trim().length ? resolved : null;
}

export function formatTrackDurationLabel(seconds: number | null | undefined): string {
	return losslessAPI.formatDuration(Math.max(0, Number(seconds) || 0));
}

export function formatPlaylistDurationLabel(seconds: number | null | undefined): string {
	const total = Math.max(0, Number(seconds) || 0);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	if (hours > 0) {
		return `${hours} hr ${minutes} min`;
	}
	return `${minutes} min`;
}

export function formatSearchQualityLabel(quality?: string | null): string {
	if (!quality) return '—';
	const normalized = quality.toUpperCase();
	if (normalized === 'LOSSLESS') return 'CD';
	if (normalized === 'HI_RES_LOSSLESS') return 'Hi-Res';
	return quality;
}

export function buildAlbumArtworkVm(
	coverId: string | null | undefined,
	title: string,
	size: CoverSize = '640'
): ArtworkVM {
	return {
		src: resolveAlbumCoverUrl(coverId, size),
		alt: title,
		shape: 'square',
		fallbackLabel: buildFallbackLabel(title, 'A')
	};
}

export function buildArtistArtworkVm(
	picture: string | null | undefined,
	name: string,
	size: ArtistPictureSize = '750'
): ArtworkVM {
	return {
		src: resolveArtistPictureUrl(picture, size),
		alt: name,
		shape: 'circle',
		fallbackLabel: buildFallbackLabel(name, 'A')
	};
}

export function buildPlaylistArtworkVm(
	image: string | null | undefined,
	title: string,
	size: CoverSize = '640'
): ArtworkVM {
	return {
		src: resolveAlbumCoverUrl(image, size),
		alt: title,
		shape: 'square',
		fallbackLabel: buildFallbackLabel(title, 'P')
	};
}

export function buildTrackArtworkVm(track: PlayableTrack, size: CoverSize = '160'): ArtworkVM {
	if (isSonglinkTrack(track)) {
		return {
			src: track.thumbnailUrl?.trim() || null,
			alt: track.title,
			shape: 'square',
			fallbackLabel: buildFallbackLabel(track.title, '♪')
		};
	}
	return buildAlbumArtworkVm((track as Track).album?.cover, track.title, size);
}

export function formatTrackPrimaryMeta(track: PlayableTrack): string {
	if (isSonglinkTrack(track)) {
		return `${track.artistName} • ${formatSearchQualityLabel(track.audioQuality)}`;
	}
	const normalizedTrack = track as Track;
	return [
		formatArtists(normalizedTrack.artists),
		normalizedTrack.album?.title,
		formatSearchQualityLabel(track.audioQuality),
		formatTrackDurationLabel(track.duration)
	]
		.filter(Boolean)
		.join(' • ');
}

export function formatAlbumMetaLine(album: Album): string {
	const trackTotal = Number(album.numberOfTracks) || 0;
	return [
		album.artist?.name ?? 'Unknown artist',
		album.releaseDate ? album.releaseDate.split('-')[0] : null,
		`${trackTotal} track${trackTotal === 1 ? '' : 's'}`
	]
		.filter(Boolean)
		.join(' • ');
}

export function formatPlaylistMetaLine(playlist: Playlist): string {
	const trackTotal = Number(playlist.numberOfTracks) || 0;
	return [
		playlist.creator.name,
		`${trackTotal} track${trackTotal === 1 ? '' : 's'}`,
		playlist.duration ? formatTrackDurationLabel(playlist.duration) : null
	]
		.filter(Boolean)
		.join(' • ');
}
