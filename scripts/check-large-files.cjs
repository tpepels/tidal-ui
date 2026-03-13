#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const limits = [
	{
		name: 'route/component',
		limit: 1200,
		match: (file) =>
			file.endsWith('.svelte') &&
			(file.startsWith('src/routes/') || file.startsWith('src/lib/components/'))
	},
	{
		name: 'helper',
		limit: 900,
		match: (file) =>
			file.endsWith('.ts') &&
			!file.endsWith('.test.ts') &&
			(file.startsWith('src/lib/utils/') ||
				file.startsWith('src/lib/features/') ||
				file.startsWith('src/lib/controllers/') ||
				file.startsWith('src/lib/services/') ||
				file === 'src/lib/api.ts')
	}
];

function getTrackedFiles() {
	const output = execSync('git ls-files', { encoding: 'utf8' });
	return output
		.split('\n')
		.map((value) => value.trim())
		.filter(Boolean);
}

function countLines(filePath) {
	const absolutePath = path.resolve(process.cwd(), filePath);
	const content = fs.readFileSync(absolutePath, 'utf8');
	if (content.length === 0) {
		return 0;
	}
	return content.split('\n').length;
}

function resolveViolations() {
	const files = getTrackedFiles();
	const violations = [];
	for (const file of files) {
		for (const rule of limits) {
			if (!rule.match(file)) continue;
			const lineCount = countLines(file);
			if (lineCount <= rule.limit) continue;
			violations.push({
				file,
				lineCount,
				rule: rule.name,
				limit: rule.limit
			});
		}
	}
	return violations.sort((left, right) => right.lineCount - left.lineCount);
}

function printViolations(violations) {
	if (violations.length === 0) {
		console.log('[large-file-contract] OK: no files exceed configured thresholds.');
		return;
	}
	console.log('[large-file-contract] Warning: files above threshold:');
	for (const violation of violations) {
		console.log(
			` - ${violation.file}: ${violation.lineCount} LOC (${violation.rule} threshold ${violation.limit})`
		);
	}
}

const failOnViolation = process.argv.includes('--fail-on-violation');
const violations = resolveViolations();
printViolations(violations);

if (failOnViolation && violations.length > 0) {
	process.exitCode = 1;
}
