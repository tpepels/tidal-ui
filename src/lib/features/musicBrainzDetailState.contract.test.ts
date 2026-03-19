import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('MusicBrainz detail stale-state handling', () => {
	it('clears stale album release results when refresh fails', () => {
		const source = readFileSync(
			resolve(__dirname, '..', 'components/pages/AlbumPageContent.svelte'),
			'utf8'
		);
		expect(source).toContain('musicBrainzReleaseOptions = [];');
		expect(source).toContain("selectedMusicBrainzReleaseId = '';");
	});

	it('clears stale artist matches when refresh fails', () => {
		const source = readFileSync(
			resolve(__dirname, '..', '..', 'routes/artist/[id]/+page.svelte'),
			'utf8'
		);
		expect(source).toContain('musicBrainzArtistOptions = [];');
		expect(source).toContain("selectedMusicBrainzArtistId = '';");
	});
});
