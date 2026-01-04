/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	resolve: {
		alias: {
			$lib: resolve(__dirname, '../../src/lib'),
			$app: resolve(__dirname, '../../src/test/mocks/app'),
			'$env/dynamic/private': resolve(__dirname, '../../src/test/mocks/env/dynamic/private')
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		setupFiles: ['./src/test-setup.ts'],
		globals: true,
		coverage: {
			provider: 'v8',
			include: ['src/lib/**/*.ts'],
			exclude: ['src/lib/**/*.test.ts', 'src/lib/**/*.d.ts', '**/*.d.ts'],
			reporter: ['text', 'json', 'html']
		}
	}
});
