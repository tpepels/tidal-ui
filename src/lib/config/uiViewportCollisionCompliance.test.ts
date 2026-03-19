import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.resolve(root, relativePath), 'utf8');

const layoutSource = read('src/routes/+layout.svelte');
const pageSectionNavSource = read('src/lib/components/ui/PageSectionNav.svelte');
const toastContainerSource = read('src/lib/components/ToastContainer.svelte');
const downloadManagerCss = read('src/lib/components/download-manager.css');
const audioPlayerCss = read('src/lib/components/audio-player.css');
const appDialogSource = read('src/lib/components/ui/AppDialog.svelte');
const lyricsPopupSource = read('src/lib/components/LyricsPopup.svelte');
const embedFiles = [
	'src/routes/embed/album/[id]/+page.svelte',
	'src/routes/embed/artist/[id]/+page.svelte',
	'src/routes/embed/playlist/[id]/+page.svelte',
	'src/routes/embed/track/[id]/+page.svelte'
];

describe('UI viewport collision compliance', () => {
	it('defines the shared layout chrome contract in the root layout', () => {
		expect(layoutSource).toContain('--ui-top-stack-offset');
		expect(layoutSource).toContain('--ui-bottom-stack-offset');
		expect(layoutSource).toContain('--ui-page-bottom-clearance');
		expect(layoutSource).toContain('--ui-safe-top');
		expect(layoutSource).toContain('--ui-safe-bottom');
		expect(layoutSource).toContain('data-ui-tight-viewport');
		expect(layoutSource).toContain('--ui-z-sticky');
		expect(layoutSource).toContain('--ui-z-utility');
		expect(layoutSource).toContain('--ui-z-overlay');
		expect(layoutSource).toContain('--ui-z-modal');
	});

	it('forces sticky nav and toast rail to consume the shared top offset', () => {
		expect(pageSectionNavSource).toContain('var(--ui-top-stack-offset, 0px)');
		expect(pageSectionNavSource).toContain("[data-ui-tight-viewport='true']");
		expect(toastContainerSource).toContain('var(--ui-top-stack-offset, 0px)');
		expect(toastContainerSource).toContain('var(--ui-z-utility, 48)');
	});

	it('forces floating utilities to consume the shared bottom offset', () => {
		expect(downloadManagerCss).toContain('var(--ui-bottom-stack-offset, 20px)');
		expect(audioPlayerCss).toContain('var(--ui-bottom-stack-offset, 20px)');
		expect(downloadManagerCss).not.toContain('calc(20px + var(--player-height');
		expect(audioPlayerCss).not.toContain('calc(20px + var(--player-height');
	});

	it('uses the approved overlay and modal z layers for shared fullscreen surfaces', () => {
		expect(appDialogSource).toContain('var(--ui-z-modal, 100)');
		expect(lyricsPopupSource).toContain('var(--ui-z-overlay, 80)');
	});

	it('keeps embed routes free of viewport-fixed utility bars and raw 100vh layout sizing', () => {
		const violations = embedFiles.flatMap((relativePath) => {
			const source = read(relativePath);
			const fileViolations: string[] = [];
			if (/position:\s*fixed/.test(source)) {
				fileViolations.push(`${relativePath}:fixed`);
			}
			if (/100vh/.test(source)) {
				fileViolations.push(`${relativePath}:100vh`);
			}
			return fileViolations;
		});

		expect(violations).toEqual([]);
	});
});
