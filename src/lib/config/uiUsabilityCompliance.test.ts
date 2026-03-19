import { describe, expect, it } from 'vitest';
import { parse } from 'svelte/compiler';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type SvelteNode = {
	type?: string;
	name?: string;
	attributes?: Array<{
		type?: string;
		name?: string;
		value?: Array<{ type?: string; data?: string }>;
	}>;
	children?: SvelteNode[];
	html?: { children?: SvelteNode[] };
	then?: { children?: SvelteNode[] };
	catch?: { children?: SvelteNode[] };
	else?: { children?: SvelteNode[] };
	pending?: { children?: SvelteNode[] };
};

const ROOTS = ['src/lib/components', 'src/routes'];
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);

function collectSvelteFiles(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...collectSvelteFiles(fullPath));
			continue;
		}
		if (fullPath.endsWith('.svelte')) {
			files.push(fullPath);
		}
	}

	return files;
}

function getAttribute(node: SvelteNode, name: string) {
	return node.attributes?.find((attribute) => attribute.type === 'Attribute' && attribute.name === name);
}

function getAttributeText(node: SvelteNode, name: string): string {
	const attribute = getAttribute(node, name);
	if (!attribute?.value) {
		return '';
	}
	return attribute.value
		.map((value) => (value.type === 'Text' ? value.data ?? '' : '{expr}'))
		.join('');
}

function walk(node: SvelteNode | null | undefined, visit: (node: SvelteNode) => void): void {
	if (!node) {
		return;
	}

	visit(node);

	const groups = [
		node.children,
		node.html?.children,
		node.then?.children,
		node.catch?.children,
		node.else?.children,
		node.pending?.children
	].filter(Array.isArray) as SvelteNode[][];

	for (const group of groups) {
		for (const child of group) {
			walk(child, visit);
		}
	}
}

function hasVisibleButtonText(children: SvelteNode[] | undefined): boolean {
	if (!children || children.length === 0) {
		return false;
	}

	for (const child of children) {
		if (child.type === 'Text' && child.data?.trim()) {
			return true;
		}
		if (child.type === 'MustacheTag' || child.type === 'RawMustacheTag') {
			return true;
		}
		if (hasVisibleButtonText(child.children)) {
			return true;
		}
		if (hasVisibleButtonText(child.then?.children)) {
			return true;
		}
		if (hasVisibleButtonText(child.catch?.children)) {
			return true;
		}
		if (hasVisibleButtonText(child.else?.children)) {
			return true;
		}
		if (hasVisibleButtonText(child.pending?.children)) {
			return true;
		}
	}

	return false;
}

function hasNestedInteractiveDescendant(node: SvelteNode): boolean {
	let found = false;

	for (const child of node.children ?? []) {
		walk(child, (descendant) => {
			if (found || descendant === node) {
				return;
			}

			if (
				(descendant.type === 'Element' || descendant.type === 'RegularElement') &&
				INTERACTIVE_TAGS.has(descendant.name ?? '')
			) {
				found = true;
			}
		});
	}

	return found;
}

const componentFiles = ROOTS.flatMap((root) =>
	collectSvelteFiles(path.resolve(process.cwd(), root))
);

describe('UI usability compliance', () => {
	it('disallows role=button wrappers with nested interactive descendants', () => {
		const violations: string[] = [];

		for (const file of componentFiles) {
			const source = readFileSync(file, 'utf8');
			const ast = parse(source);

			walk(ast.html as unknown as SvelteNode, (node) => {
				if (
					(node.type === 'Element' || node.type === 'RegularElement') &&
					getAttributeText(node, 'role') === 'button' &&
					hasNestedInteractiveDescendant(node)
				) {
					violations.push(path.relative(process.cwd(), file));
				}
			});
		}

		expect(violations).toEqual([]);
	});

	it('requires noopener noreferrer on target=_blank links', () => {
		const violations: string[] = [];

		for (const file of componentFiles) {
			const source = readFileSync(file, 'utf8');
			const ast = parse(source);

			walk(ast.html as unknown as SvelteNode, (node) => {
				if (
					(node.type === 'Element' || node.type === 'RegularElement') &&
					node.name === 'a' &&
					getAttributeText(node, 'target') === '_blank'
				) {
					const relTokens = new Set(getAttributeText(node, 'rel').split(/\s+/).filter(Boolean));
					if (!relTokens.has('noopener') || !relTokens.has('noreferrer')) {
						violations.push(path.relative(process.cwd(), file));
					}
				}
			});
		}

		expect(violations).toEqual([]);
	});

	it('requires aria-label on icon-only buttons', () => {
		const violations: string[] = [];

		for (const file of componentFiles) {
			const source = readFileSync(file, 'utf8');
			const ast = parse(source);

			walk(ast.html as unknown as SvelteNode, (node) => {
				if (
					(node.type === 'Element' || node.type === 'RegularElement') &&
					node.name === 'button' &&
					!getAttribute(node, 'aria-label') &&
					!hasVisibleButtonText(node.children)
				) {
					violations.push(path.relative(process.cwd(), file));
				}
			});
		}

		expect(violations).toEqual([]);
	});

	it('disallows direct native confirm usage in user-facing Svelte files', () => {
		const violations = componentFiles
			.filter((file) => {
				const source = readFileSync(file, 'utf8');
				return /\bwindow\.confirm\(|(^|[^\w.])confirm\(/m.test(source);
			})
			.map((file) => path.relative(process.cwd(), file));

		expect(violations).toEqual([]);
	});
});
