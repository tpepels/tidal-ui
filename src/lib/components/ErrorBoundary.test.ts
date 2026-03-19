import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = () => readFileSync(resolve(__dirname, './ErrorBoundary.svelte'), 'utf8');

describe('ErrorBoundary source contract', () => {
	it('uses the shared dialog foundation as an alertdialog', () => {
		const source = readSource();
		expect(source).toContain('AppDialog');
		expect(source).toContain('dialogRole="alertdialog"');
		expect(source).toContain(`initialFocusSelector='[data-dialog-action="reload"]'`);
	});

	it('retains invariant-aware handling and recovery actions', () => {
		const source = readSource();
		expect(source).toContain('InvariantViolationError');
		expect(source).toContain('Something went wrong');
		expect(source).toContain('Try Again');
		expect(source).toContain('Reload App');
		expect(source).toContain('Error Details (for developers)');
	});
});
