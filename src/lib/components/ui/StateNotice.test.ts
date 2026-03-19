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
		render(StateNotice, {
			props: {
				title: 'Loading album',
				message: 'Fetching metadata.',
				busy: true
			}
		});

		const notice = screen.getByRole('status');
		expect(notice).toHaveAttribute('aria-live', 'polite');
		expect(notice).toHaveAttribute('aria-busy', 'true');
	});

	it('supports opting out of live announcements', () => {
		render(StateNotice, {
			props: {
				message: 'Already in library.',
				liveRegion: 'off'
			}
		});

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.getByText('Already in library.')).toBeInTheDocument();
	});
});
