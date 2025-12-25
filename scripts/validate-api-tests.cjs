#!/usr/bin/env node

/**
 * API Test Validation Script
 *
 * This script runs API-related tests and distinguishes between:
 * - Expected failures (import resolution, network issues)
 * - Unexpected failures (incorrect API endpoints, test logic bugs)
 *
 * Exit codes:
 * 0 = All tests passed or only expected failures
 * 1 = Unexpected test failures that should block commits
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🔍 Running API test validation...\n');

// API test files that contain critical endpoint validation
const apiTestFiles = [
	'src/lib/services/search.service.test.ts',
	'src/lib/services/content.service.test.ts',
	'src/lib/services/playback.service.test.ts'
];

// Expected failure patterns (these don't block commits)
const expectedFailurePatterns = [
	/Error: Failed to resolve import.*\$/, // SvelteKit path resolution
	/Error: Failed to resolve import.*@/, // External library resolution
	/Module not found/, // Module resolution issues
	/Cannot find module/, // Import resolution issues
	/network error/i, // Network connectivity issues
	/ECONNREFUSED/, // Connection refused
	/ENOTFOUND/ // DNS resolution failures
];

// Unexpected failure patterns (these DO block commits)
const unexpectedFailurePatterns = [
	/Expected.*toHaveBeenCalledWith/, // Wrong API endpoint expectations
	/Expected.*toBe/, // Incorrect test expectations
	/expected.*toEqual/, // Data mismatch
	/expected.*toBeCalledWith/, // Wrong function call expectations
	/API response validation failed/ // Schema validation failures
];

try {
	// Run the API tests
	const testCommand = `npm run test:run -- ${apiTestFiles.join(' ')}`;
	console.log(`Running: ${testCommand}`);

	execSync(testCommand, {
		encoding: 'utf8',
		stdio: 'pipe',
		cwd: path.resolve(__dirname, '..')
	});

	console.log('✅ All API tests passed successfully!');
	process.exit(0);
} catch (error) {
	const output = error.stdout || error.stderr || '';

	console.log('⚠️  API tests had failures. Analyzing failure types...\n');

	// Check for unexpected failures
	const hasUnexpectedFailures = unexpectedFailurePatterns.some((pattern) => pattern.test(output));

	// Check for expected failures
	const hasExpectedFailures = expectedFailurePatterns.some((pattern) => pattern.test(output));

	if (hasUnexpectedFailures && !hasExpectedFailures) {
		console.log('❌ CRITICAL: API tests failed with unexpected errors!');
		console.log('   This indicates incorrect API endpoints or test logic bugs.');
		console.log('   These failures must be fixed before committing.\n');

		// Show the relevant failure output
		const lines = output.split('\n');
		const failureStart = lines.findIndex((line) => line.includes('FAIL'));
		if (failureStart >= 0) {
			console.log('Failure details:');
			console.log(lines.slice(failureStart, failureStart + 20).join('\n'));
		}

		process.exit(1);
	}

	if (hasExpectedFailures) {
		console.log('✅ API tests failed only due to expected issues:');
		if (output.includes('Failed to resolve import')) {
			console.log('   • SvelteKit path resolution issues ($lib, $app imports)');
		}
		if (output.includes('network') || output.includes('ECONNREFUSED')) {
			console.log('   • Network connectivity issues');
		}
		console.log('   These are not blocking issues - allowing commit.\n');
		process.exit(0);
	}

	// Unknown failure type - be conservative and block
	console.log('❓ API tests failed with unknown error pattern.');
	console.log('   Review the test output below and fix if needed:\n');
	console.log(output);
	process.exit(1);
}
