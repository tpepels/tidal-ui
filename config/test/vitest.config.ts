/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';

const svelteTestTransform = {
	name: 'svelte-test-transform',
	transform(code: string, id: string) {
		if (!id.endsWith('.svelte')) {
			return null;
		}

		const result = compile(code, {
			filename: id,
			generate: 'client',
			css: 'injected',
			dev: true
		});

		return {
			code: result.js.code,
			map: result.js.map
		};
	}
};

export default defineConfig({
	plugins: [svelteTestTransform],
	resolve: {
		alias: {
			$lib: resolve(__dirname, '../../src/lib'),
			$app: resolve(__dirname, '../../src/test/mocks/app'),
			'$env/dynamic/private': resolve(__dirname, '../../src/test/mocks/env/dynamic/private'),
			'@testing-library/svelte': '@testing-library/svelte/svelte5'
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
