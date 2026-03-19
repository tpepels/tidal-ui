import { describe, expect, it } from 'vitest';
import { resolveSearchAlbumMusicBrainzReleaseId } from './searchMusicBrainzDownload';

describe('searchMusicBrainzDownload', () => {
	it('returns the matched release id when tagging is enabled', () => {
		expect(
			resolveSearchAlbumMusicBrainzReleaseId({
				albumId: 42,
				experimentalMusicBrainzTagging: true,
				albumMusicBrainzReleaseMatches: {
					42: 'release-42'
				}
			})
		).toBe('release-42');
	});

	it('does not return a release id when tagging is disabled', () => {
		expect(
			resolveSearchAlbumMusicBrainzReleaseId({
				albumId: 42,
				experimentalMusicBrainzTagging: false,
				albumMusicBrainzReleaseMatches: {
					42: 'release-42'
				}
			})
		).toBeUndefined();
	});
});
