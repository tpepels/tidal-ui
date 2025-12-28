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
		plugins: [tailwindcss(), sveltekit(), ...(isTest ? [] : [devtoolsJson()])],
		resolve: {
			alias: {
				$lib: 'src/lib',
				$app: '.svelte-kit/runtime/app'
			}
		},
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
