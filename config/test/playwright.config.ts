import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const requestedBrowsers = (process.env.PLAYWRIGHT_BROWSERS ?? 'chromium,firefox')
	.split(',')
	.map((browser) => browser.trim())
	.filter(Boolean);

export default defineConfig({
	testDir: resolve(__dirname, '../../tests/e2e'),
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: 'https://127.0.0.1:5000',
		ignoreHTTPSErrors: true,
		trace: 'retain-on-failure',
		video: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		requestedBrowsers.includes('chromium')
			? {
					name: 'chromium',
					use: { ...devices['Desktop Chrome'] }
				}
			: null,
		requestedBrowsers.includes('firefox')
			? {
					name: 'firefox',
					use: { ...devices['Desktop Firefox'] }
				}
			: null,
		requestedBrowsers.includes('webkit')
			? {
					name: 'webkit',
					use: { ...devices['Desktop Safari'] }
				}
			: null
	].filter(Boolean),
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5000',
		url: 'https://127.0.0.1:5000',
		env: {
			E2E_OFFLINE: 'true',
			VITE_E2E: 'true',
			VITE_PLAYBACK_MACHINE_QUALITY_SOT: 'true',
			VITE_PLAYBACK_MACHINE_QUEUE_SOT: 'true',
			REDIS_DISABLED: 'true'
		},
		ignoreHTTPSErrors: true,
		reuseExistingServer: !process.env.CI
	}
});
