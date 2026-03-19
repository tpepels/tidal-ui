import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('app mobile layout contract', () => {
	it('stacks actionable rows and allows row text to wrap on phone widths', () => {
		expect(source).toContain('@media (max-width: 639px)');
		expect(source).toContain('.ui-list-row--actionable,');
		expect(source).toContain('.ui-media-row--actionable');
		expect(source).toContain('.ui-list-row__title-text,');
		expect(source).toContain('.ui-list-row__meta,');
		expect(source).toContain('.ui-list-row__value,');
		expect(source).toContain('overflow-wrap: anywhere;');
		expect(source).toContain('.ui-list-row__action-label');
	});

	it('relaxes mobile card text and collapses paired footer links to one column', () => {
		expect(source).toContain('.ui-media-card__title.ui-media-card__title--truncate');
		expect(source).toContain('.ui-media-card__subtitle.ui-media-card__title--truncate,');
		expect(source).toContain('.ui-media-card__links--paired');
		expect(source).toContain('grid-template-columns: minmax(0, 1fr);');
	});
});
