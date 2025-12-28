import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = () =>
	readFileSync(resolve(__dirname, './ErrorBoundary.svelte'), 'utf8');

describe('ErrorBoundary Component Contract', () => {
	it('includes invariant-aware handling', () => {
		const source = readSource();
		expect(source).toContain('InvariantViolationError');
	});

	it('renders the fallback error UI text', () => {
		const source = readSource();
		expect(source).toContain('Something went wrong');
	});

	it('includes developer details section', () => {
		const source = readSource();
		expect(source).toContain('Error Details (for developers)');
	});
});
