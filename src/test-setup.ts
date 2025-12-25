// Test setup for vitest
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend expect with jest-dom matchers
expect.extend(matchers);

// Mock SvelteKit $lib and $app imports
vi.mock('$lib/utils/audioQuality', () => ({
	deriveTrackQuality: vi.fn(() => 'LOSSLESS')
}));

vi.mock('$lib/utils/urlParser', () => ({
	parseTidalUrl: vi.fn(() => ({ type: 'track', id: '123' }))
}));

vi.mock('$lib/utils', () => ({
	formatArtistsForMetadata: vi.fn(() => 'Artist'),
	formatArtists: vi.fn(() => 'Artist')
}));

vi.mock('$lib/stores/region', () => ({
	type: 'RegionOption',
	defaultRegion: { code: 'US', name: 'United States' }
}));

vi.mock('$lib/config', () => ({
	API_CONFIG: {
		baseUrl: 'http://localhost:3000',
		targets: [{ name: 'local', baseUrl: 'http://localhost:3000', weight: 1 }],
		useProxy: false,
		proxyUrl: ''
	},
	fetchWithCORS: vi.fn(),
	selectApiTargetForRegion: vi.fn(() => ({
		name: 'local',
		baseUrl: 'http://localhost:3000',
		weight: 1
	}))
}));

vi.mock('$lib/version', () => ({
	APP_VERSION: 'v3.3'
}));

vi.mock('$app/environment', () => ({
	dev: false,
	browser: false,
	building: false,
	version: '3.3'
}));

// Cleanup after each test
afterEach(() => {
	cleanup();
});
