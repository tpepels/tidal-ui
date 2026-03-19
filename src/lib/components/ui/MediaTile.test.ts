import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
	path.resolve(process.cwd(), 'src/lib/components/ui/MediaTile.svelte'),
	'utf8'
);
const cssSource = readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('MediaTile source contract', () => {
	it('renders album cards with an artwork overlay instead of placing the primary copy fully below the cover', () => {
		expect(componentSource).toContain("const useArtworkOverlay = $derived(type === 'album');");
		expect(componentSource).toContain('class:ui-media-card__primary-link--overlay={useArtworkOverlay}');
		expect(componentSource).toContain('<div class="ui-media-card__artwork-overlay">');
		expect(componentSource).toContain('class="ui-media-card__body ui-media-card__body--overlay"');
	});

	it('keeps the overlay styling in the shared media-card CSS', () => {
		expect(cssSource).toContain('.ui-media-card__artwork-overlay {');
		expect(cssSource).toContain('min-height: 28%;');
		expect(cssSource).toContain('.ui-media-card__body--overlay .ui-media-card__title {');
	});
});
