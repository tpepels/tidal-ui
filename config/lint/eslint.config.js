import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from '../../svelte.config.js';

const gitignorePath = fileURLToPath(new URL('../../.gitignore', import.meta.url));

export default defineConfig(
	{
		ignores: ['*.cjs']
	},
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Temporarily disable Svelte 5 migration warnings
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			'svelte/prefer-writable-derived': 'off',
			// Allow require() in CommonJS files
			'@typescript-eslint/no-require-imports': 'off'
		}
	},
	{
		files: ['**/*.cjs'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off'
		}
	},
	{
		files: ['**/*.test.ts', '**/*.spec.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'prefer-const': 'off'
		}
	},
	// Architectural boundary enforcement
	{
		files: ['src/lib/services/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/stores/**', '$lib/stores/**'],
							message:
								'Services cannot import stores. Use callbacks instead to maintain unidirectional data flow.'
						}
					]
				}
			]
		}
	},
	{
		files: ['src/lib/stores/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/services/**', '$lib/services/**'],
							message:
								'Stores cannot import services directly. Services should be called from components or orchestrators.'
						}
					]
				}
			]
		}
	},
	{
		files: ['src/lib/orchestrators/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/orchestrators/*Orchestrator.ts', '!./playlistOrchestrator.ts'],
							message:
								'Orchestrators should not import other orchestrators (except delegation pattern like searchOrchestrator → playlistOrchestrator).'
						}
					]
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
