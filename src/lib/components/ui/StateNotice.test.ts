import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import StateNotice from './StateNotice.svelte';

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

	it('announces polite busy states by default', () => {
		render(StateNotice as never, {
			props: {
				title: 'Loading album',
				message: 'Fetching metadata.',
				busy: true
			}
		});

		const notice = screen.getByRole('status');
		expect(notice.getAttribute('aria-live')).toBe('polite');
		expect(notice.getAttribute('aria-busy')).toBe('true');
	});

	it('supports opting out of live announcements', () => {
		render(StateNotice as never, {
			props: {
				message: 'Already in library.',
				liveRegion: 'off'
			}
		});

		expect(screen.queryByRole('status')).toBeNull();
		expect(screen.getByText('Already in library.')).not.toBeNull();
	});
});
