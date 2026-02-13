import { describe, expect, it } from 'vitest';
import { losslessAPI } from './api';

describe('LosslessAPI artwork URL helpers', () => {
	it('normalizes a resources.tidal.com artist picture URL to the requested size', () => {
		const pictureUrl =
			'https://resources.tidal.com/images/19f754b8/4882/4cef/86e6/440e7dd57afb/320x320.jpg';
		expect(losslessAPI.getArtistPictureUrl(pictureUrl, '750')).toBe(
			'https://resources.tidal.com/images/19f754b8/4882/4cef/86e6/440e7dd57afb/750x750.jpg'
		);
	});

	it('passes through external absolute artist picture URLs unchanged', () => {
		const externalUrl = 'https://cdn.example.com/artist.jpg';
		expect(losslessAPI.getArtistPictureUrl(externalUrl, '750')).toBe(externalUrl);
	});

	it('returns direct cover URL candidates before proxy fallbacks', () => {
		const expectedDirectUrl =
			'https://resources.tidal.com/images/19f754b8/4882/4cef/86e6/440e7dd57afb/640x640.jpg';
		const candidates = losslessAPI.getCoverUrlFallbacks(
			'19f754b8-4882-4cef-86e6-440e7dd57afb',
			'640',
			{ proxy: true, includeLowerSizes: false }
		);
		expect(candidates[0]).toBe(expectedDirectUrl);

		const proxyCandidate = candidates.find((candidate) => candidate.includes('/api/proxy?url='));
		if (proxyCandidate) {
			expect(candidates.indexOf(proxyCandidate)).toBeGreaterThan(0);
			expect(proxyCandidate).toBe(`/api/proxy?url=${encodeURIComponent(expectedDirectUrl)}`);
		}
	});
});
