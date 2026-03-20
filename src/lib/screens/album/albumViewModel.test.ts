import { describe, expect, it } from 'vitest';
import type { Album } from '$lib/types';
import {
	buildAlbumActionSectionViewModel,
	buildAlbumHeroViewModel,
	buildAlbumMusicBrainzSectionViewModel
} from './albumViewModel';

describe('albumViewModel', () => {
	it('builds warning notices for incomplete tracklists', () => {
		const album = {
			id: 11,
			title: 'Album',
			cover: 'abc-def',
			videoCover: null,
			artist: { id: 1, name: 'Artist', type: 'Artist' }
		} as unknown as Album;

		const hero = buildAlbumHeroViewModel({
			album,
			trackCount: 8,
			totalDuration: 3600,
			hasIncompleteTrackList: true,
			expectedTrackCount: 10,
			missingTrackLabel: '#9, #10'
		});

		expect(hero.notices[0]?.tone).toBe('warning');
		expect(hero.hero.title).toBe('Album');
	});

	it('builds action notices for queued downloads', () => {
		const viewModel = buildAlbumActionSectionViewModel({
			queueStatus: 'queued',
			isQueueDownloadCancellable: true,
			isDownloadingAll: false,
			downloadedCount: 0,
			trackCount: 10,
			albumInLibrary: false,
			albumLibraryTrackCount: 0,
			isRepairingAlbum: false,
			repairMessage: null,
			downloadError: null,
			queueCompletedTracks: 0,
			queueTotalTracks: 10,
			downloadStoragePreference: 'server',
			isMusicBrainzReleaseLookupLoading: false,
			selectedMusicBrainzReleaseId: '',
			hasActiveQueueDownload: true
		});

		expect(viewModel.actions.some((action) => action.id === 'download')).toBe(true);
		expect(viewModel.notices[0]?.message).toContain('Queued on server');
	});

	it('maps selected MusicBrainz release facts and links', () => {
		const viewModel = buildAlbumMusicBrainzSectionViewModel({
			releases: [{ id: 'release-1', title: 'Album', date: '2024-01-01' } as never],
			selectedReleaseId: 'release-1',
			selectedRelease: {
				id: 'release-1',
				title: 'Album',
				date: '2024-01-01',
				country: 'US',
				trackCount: 10
			} as never,
			isLoading: false,
			hasAttempted: true,
			error: null,
			experimentalMusicBrainzTaggingPreference: true
		});

		expect(viewModel.hasSelection).toBe(true);
		expect(viewModel.facts.some((fact) => fact.label === 'Release MBID')).toBe(true);
		expect(viewModel.links[0]?.href).toContain('musicbrainz.org/release/');
	});
});
