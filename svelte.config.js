import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import vercel from '@sveltejs/adapter-vercel';
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
		})
	}
};

export default config;
