/// <reference types="vitest" />
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	process.env = { ...process.env, ...env };

	const parsedPort = env.PORT ? Number.parseInt(env.PORT, 10) : undefined;

	const isTest = mode === 'test';

	return {
		plugins: [tailwindcss(), ...(isTest ? [] : [sveltekit(), devtoolsJson()])],
		server: {
			https: {
				key: './key.pem',
				cert: './cert.pem'
			},
			watch: { usePolling: true },
			host: '0.0.0.0',
			port: Number.isFinite(parsedPort) ? parsedPort : undefined
		},
		optimizeDeps: {
			exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		},
		ssr: {
			external: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		},
		test: {
			include: ['src/**/*.{test,spec}.{js,ts}'],
			environment: 'jsdom',
			setupFiles: ['./src/test-setup.ts'],
			globals: true,
			server: {
				deps: {
					inline: ['@sveltejs/kit']
				},
				hmr: false
			}
		}
	};
});
