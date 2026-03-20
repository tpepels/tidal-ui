import { describe, expect, it } from 'vitest';
import type { Track } from '$lib/types';
import { buildTrackActionButtons, buildTrackHeroViewModel } from './trackViewModel';

function createTrack(): Track {
	return {
		id: 8,
		title: 'Teardrop',
		duration: 330,
		allowStreaming: true,
		streamReady: true,
		premiumStreamingOnly: false,
		trackNumber: 1,
		volumeNumber: 1,
		version: 'Remastered',
		popularity: 90,
		url: '',
		editable: false,
		explicit: false,
		audioQuality: 'LOSSLESS',
		audioModes: [],
		artist: { id: 4, name: 'Massive Attack', type: 'Artist', picture: 'artist-picture' },
		artists: [{ id: 4, name: 'Massive Attack', type: 'Artist' }],
		album: { id: 22, title: 'Mezzanine', cover: 'album-cover', videoCover: null }
	};
}

describe('trackViewModel', () => {
	it('builds hero relations for artist and album', () => {
		const hero = buildTrackHeroViewModel(createTrack());

		expect(hero.relatedItems).toHaveLength(2);
		expect(hero.relatedItems?.[0]?.href).toBe('/artist/4');
		expect(hero.relatedItems?.[1]?.href).toBe('/album/22');
	});

	it('switches the action button when a track is downloading', () => {
		const actions = buildTrackActionButtons({
			isDownloading: true,
			isCancelled: false,
			downloadActionLabel: 'Download'
		});

		expect(actions[1]?.id).toBe('cancel-download');
		expect(actions[1]?.label).toBe('Cancel');
	});
});
