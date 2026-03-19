export function resolveSearchAlbumMusicBrainzReleaseId(options: {
	albumId: number;
	experimentalMusicBrainzTagging: boolean;
	albumMusicBrainzReleaseMatches: Record<number, string>;
}): string | undefined {
	if (!options.experimentalMusicBrainzTagging) {
		return undefined;
	}
	const releaseId = options.albumMusicBrainzReleaseMatches[options.albumId];
	return typeof releaseId === 'string' && releaseId.trim().length > 0 ? releaseId : undefined;
}
