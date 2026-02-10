/// <reference types="vitest" />
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode, ssrBuild }) => {
	const env = loadEnv(mode, process.cwd(), '');
	process.env = { ...process.env, ...env };

	const parsedPort = env.PORT ? Number.parseInt(env.PORT, 10) : undefined;
	const certPath = resolve(process.cwd(), '.certs/cert.pem');
	const keyPath = resolve(process.cwd(), '.certs/key.pem');
	const httpsEnabled =
		env.VITE_DISABLE_HTTPS !== 'true' && existsSync(certPath) && existsSync(keyPath);
	const httpsConfig = httpsEnabled ? { key: keyPath, cert: certPath } : undefined;

	const isTest = mode === 'test';
	const shouldVisualize = env.VITE_VISUALIZE === 'true' && !ssrBuild;
	const vizPlugin = shouldVisualize
		? visualizer({
				filename: 'stats/client-stats.json',
				template: 'raw-data',
				gzipSize: true,
				brotliSize: true
			})
		: null;
	const plugins = [tailwindcss(), sveltekit(), ...(isTest ? [] : [devtoolsJson()])];
	if (vizPlugin) {
		plugins.push(vizPlugin);
	}
	const manualChunks = (id: string) => {
		if (!id.includes('node_modules')) return undefined;
		if (id.includes('/node_modules/jszip/')) return 'vendor-zip';
		if (id.includes('/node_modules/lucide-svelte/')) return 'vendor-ui';
		return undefined;
	};

	return {
		logLevel: (env.VITE_LOG_LEVEL as 'info' | 'warn' | 'error' | 'silent' | undefined) || 'info',
		clearScreen: false,
		plugins,
		resolve: {
			alias: {
				$lib: 'src/lib',
				$app: '.svelte-kit/runtime/app'
			}
		},
		server: {
			https: httpsConfig,
			watch: { usePolling: true },
			host: '0.0.0.0',
			port: Number.isFinite(parsedPort) ? parsedPort : undefined
		},
		preview: {
			https: httpsConfig,
			host: '0.0.0.0',
			port: Number.isFinite(parsedPort) ? parsedPort : undefined
		},
		optimizeDeps: {
			exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		},
		build: {
			chunkSizeWarningLimit: 900,
			rollupOptions: {
				output: {
					manualChunks
				}
			}
		},
		ssr: {
			external: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		},
		coverage: {
			reporter: ['text', 'html', 'lcov'],
			exclude: [
				'coverage/**',
				'packages/*/test{,s}/**',
				'**/*.d.ts',
				'cypress/**',
				'test{,s}/**',
				'test{,-*}.{js,cjs,mjs,ts,tsx,jsx}',
				'**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}',
				'**/*{.,-}spec.{js,cjs,mjs,ts,tsx,jsx}',
				'**/__tests__/**',
				'**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
				'**/.{eslint,mocha,prettier}rc.{js,cjs,yml}',
				'**/eslint.config.js',
				'**/*.config.js',
				'**/*.config.ts'
			],
			thresholds: {
				global: {
					branches: 70,
					functions: 70,
					lines: 70,
					statements: 70
				}
			}
		}
	};
});
