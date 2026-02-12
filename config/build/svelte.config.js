import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import node from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: node({
			out: 'build',
			precompress: true,
			// Configure underlying HTTP server to accept large payloads (100MB for audio uploads)
			middlewareOptions: {
				bodyLimit: '100mb'
			}
		}),
		serviceWorker: {
			// Use explicit runtime gating in +layout.svelte to avoid LAN/self-signed SSL
			// registration errors and unexpected auto-registration behavior.
			register: false
		}
	}
};

export default config;
