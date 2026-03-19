import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8');

describe('app detail layout contract', () => {
	it('keeps the detail sidebar narrower than the main column on desktop layouts', () => {
		expect(source).toContain('@media (min-width: 900px)');
		expect(source).toContain('grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);');
		expect(source).toContain('max-width: 24rem;');
		expect(source).toContain('justify-self: end;');
	});
});
