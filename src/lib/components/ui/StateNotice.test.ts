import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	path.resolve(process.cwd(), 'src/lib/components/ui/StateNotice.svelte'),
	'utf8'
);

describe('StateNotice source contract', () => {
	it('renders a stale badge when requested', () => {
		expect(source).toContain('{#if stale}');
		expect(source).toContain('ui-state-notice__badge">Stale');
	});

	it('renders an action button only when both callback and label are present', () => {
		expect(source).toContain('{#if onAction && actionLabel}');
		expect(source).toContain('onclick={onAction}');
		expect(source).toContain('{actionLabel}');
	});
});
