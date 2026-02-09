import { describe, it, expect } from 'vitest';
import { decodeBase64Manifest, parseManifest, extractStreamUrlFromManifest } from './manifestParser';

describe('manifestParser', () => {
	describe('decodeBase64Manifest', () => {
		it('should decode base64 manifest', () => {
			const base64 = btoa('https://example.com/audio.flac');
			const result = decodeBase64Manifest(base64);
			expect(result).toBe('https://example.com/audio.flac');
		});

		it('should handle direct proxy URLs', () => {
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent('https://upstream.example.com/track');
			const result = decodeBase64Manifest(proxyUrl);
			expect(result).toBe('https://upstream.example.com/track');
		});

		it('should handle base64-encoded proxy URLs', () => {
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent('https://upstream.example.com/track');
			const base64 = btoa(proxyUrl);
			const result = decodeBase64Manifest(base64);
			expect(result).toBe('https://upstream.example.com/track');
		});

		it('should handle URL-safe base64 with missing padding', () => {
			const original = 'https://example.com/audio.flac';
			// Create URL-safe base64 and remove padding
			let base64 = btoa(original).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
			const result = decodeBase64Manifest(base64);
			expect(result).toBe(original);
		});

		it('should return trimmed original if not valid base64', () => {
			const notBase64 = 'not-valid-base64!!!';
			const result = decodeBase64Manifest(notBase64);
			expect(result).toBe(notBase64);
		});

		it('should handle empty input', () => {
			expect(decodeBase64Manifest('')).toBe('');
			expect(decodeBase64Manifest('   ')).toBe('');
		});

		it('should handle complex proxy URL with query params', () => {
			const upstream = 'https://vogel.qqdl.site/track/?id=121091854&quality=HI_RES_LOSSLESS';
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent(upstream);
			const result = decodeBase64Manifest(proxyUrl);
			expect(result).toBe(upstream);
		});
	});

	describe('extractStreamUrlFromManifest', () => {
		it('should extract plain URL from manifest', () => {
			const url = 'https://example.com/audio.flac';
			const base64 = btoa(url);
			const result = extractStreamUrlFromManifest(base64);
			expect(result).toBe(url);
		});

		it('should extract URL from proxy-wrapped manifest', () => {
			const url = 'https://example.com/audio.flac';
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
			const result = extractStreamUrlFromManifest(proxyUrl);
			expect(result).toBe(url);
		});

		it('should extract URL from JSON manifest', () => {
			const url = 'https://example.com/audio.flac';
			const json = JSON.stringify({ url });
			const base64 = btoa(json);
			const result = extractStreamUrlFromManifest(base64);
			expect(result).toBe(url);
		});

		it('should extract URL from JSON manifest when url is proxied', () => {
			const url = 'https://example.com/audio.flac';
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
			const json = JSON.stringify({ url: proxyUrl });
			const base64 = btoa(json);
			const result = extractStreamUrlFromManifest(base64);
			expect(result).toBe(url);
		});

		it('should extract URL from JSON urls array', () => {
			const url = 'https://example.com/audio.flac';
			const json = JSON.stringify({ urls: [url] });
			const base64 = btoa(json);
			const result = extractStreamUrlFromManifest(base64);
			expect(result).toBe(url);
		});

		it('should extract URL from JSON urls array when proxied', () => {
			const url = 'https://example.com/audio.flac';
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
			const json = JSON.stringify({ urls: [proxyUrl] });
			const base64 = btoa(json);
			const result = extractStreamUrlFromManifest(base64);
			expect(result).toBe(url);
		});

		it('should return null for segmented DASH manifest', () => {
			const dashManifest = `<?xml version="1.0"?>
<MPD>
	<Period>
		<AdaptationSet>
			<Representation>
				<SegmentTemplate media="segment_$Number$.m4s" initialization="init.mp4" />
			</Representation>
		</AdaptationSet>
	</Period>
</MPD>`;
			const base64 = btoa(dashManifest);
			const result = extractStreamUrlFromManifest(base64);
			expect(result).toBeNull();
		});
	});

	describe('parseManifest', () => {
		it('should parse single URL manifest', () => {
			const url = 'https://example.com/audio.flac';
			const base64 = btoa(url);
			const result = parseManifest(base64);
			expect(result.type).toBe('single-url');
			expect(result.streamUrl).toBe(url);
		});

		it('should parse proxy URL manifest', () => {
			const url = 'https://example.com/audio.flac';
			const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
			const result = parseManifest(proxyUrl);
			expect(result.type).toBe('single-url');
			expect(result.streamUrl).toBe(url);
		});

		it('should parse segmented DASH manifest', () => {
			const dashManifest = `<?xml version="1.0"?>
<MPD>
	<Period>
		<AdaptationSet>
			<Representation mimeType="audio/mp4" codecs="ac-3">
				<SegmentTemplate media="https://example.com/segment_$Number$.m4s" initialization="https://example.com/init.mp4" duration="2147483648" timescale="1000" />
			</Representation>
		</AdaptationSet>
	</Period>
</MPD>`;
			const base64 = btoa(dashManifest);
			const result = parseManifest(base64);
			expect(result.type).toBe('segmented-dash');
			expect(result.initializationUrl).toBeDefined();
			expect(result.segmentUrls).toBeDefined();
		});

		it('should handle unknown manifest type', () => {
			const result = parseManifest('garbage-data');
			expect(result.type).toBe('unknown');
		});
	});
});
