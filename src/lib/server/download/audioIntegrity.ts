import { execFile, spawnSync } from 'node:child_process';
import * as path from 'node:path';

type FfprobeStream = {
	codec_type?: unknown;
	codec_name?: unknown;
	duration?: unknown;
};

type FfprobeFormat = {
	format_name?: unknown;
	duration?: unknown;
};

type FfprobePayload = {
	streams?: unknown;
	format?: unknown;
};

type ProbeRunner = (ffprobePath: string, filePath: string) => Promise<FfprobePayload>;
type DecodeRunner = (
	ffmpegPath: string,
	filePath: string
) => Promise<void | number | null>;

type BinaryFinder = () => string | null;

export interface AudioIntegrityValidationInput {
	filePath: string;
	expectedExtension?: string;
	expectedDurationSeconds?: number;
}

interface AudioIntegrityValidationDeps {
	probeRunner?: ProbeRunner;
	decodeRunner?: DecodeRunner;
	binaryFinder?: BinaryFinder;
	ffmpegBinaryFinder?: BinaryFinder;
	durationToleranceSeconds?: number;
}

export interface AudioIntegrityValidationResult {
	ok: boolean;
	error?: string;
	durationSeconds?: number;
	codecName?: string;
	formatName?: string;
}

let resolvedFfprobePath: string | null | undefined = undefined;
let resolvedFfmpegPath: string | null | undefined = undefined;

function normalizeExtension(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return undefined;
	return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function parseDurationSeconds(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

function parseFfmpegTimestampSeconds(value: string): number | null {
	const trimmed = value.trim();
	const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(trimmed);
	if (!match) return null;
	const hours = Number.parseInt(match[1], 10);
	const minutes = Number.parseInt(match[2], 10);
	const seconds = Number.parseFloat(match[3]);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
		return null;
	}
	return hours * 3600 + minutes * 60 + seconds;
}

function parseLastDecodedDurationSeconds(progressText: string): number | null {
	let lastDecodedSeconds: number | null = null;
	for (const line of progressText.split(/\r?\n/)) {
		if (!line.startsWith('out_time=')) continue;
		const value = line.slice('out_time='.length);
		const parsed = parseFfmpegTimestampSeconds(value);
		if (parsed !== null && parsed > 0) {
			lastDecodedSeconds = parsed;
		}
	}
	return lastDecodedSeconds;
}

function getConfiguredDurationToleranceSeconds(expectedDurationSeconds: number): number {
	const explicit = Number(process.env.FFPROBE_DURATION_TOLERANCE_SECONDS || '');
	if (Number.isFinite(explicit) && explicit > 0) {
		return explicit;
	}
	return Math.max(2, Math.min(8, expectedDurationSeconds * 0.03));
}

function matchesExpectedContainer(
	expectedExtension: string | undefined,
	formatName: string,
	codecName: string | undefined
): boolean {
	if (!expectedExtension) return true;

	const names = formatName.toLowerCase();
	const codec = codecName?.toLowerCase();
	if (expectedExtension === '.flac') {
		return names.includes('flac') || codec === 'flac';
	}
	if (expectedExtension === '.m4a' || expectedExtension === '.mp4') {
		return names.includes('mp4') || names.includes('m4a') || names.includes('mov');
	}
	if (expectedExtension === '.mp3') {
		return names.includes('mp3') || codec === 'mp3';
	}
	return true;
}

function getFfprobeCandidates(): string[] {
	const ffmpegPath = process.env.FFMPEG_PATH;
	const siblingFfprobe = ffmpegPath ? path.join(path.dirname(ffmpegPath), 'ffprobe') : undefined;
	return [
		process.env.FFPROBE_PATH,
		siblingFfprobe,
		'ffprobe',
		'/usr/bin/ffprobe',
		'/usr/local/bin/ffprobe',
		'/opt/ffmpeg/ffprobe',
		'/snap/bin/ffprobe'
	].filter((entry): entry is string => Boolean(entry));
}

function getFfmpegCandidates(): string[] {
	return [
		process.env.FFMPEG_PATH,
		'ffmpeg',
		'/usr/bin/ffmpeg',
		'/usr/local/bin/ffmpeg',
		'/opt/ffmpeg/ffmpeg',
		'/snap/bin/ffmpeg'
	].filter((entry): entry is string => Boolean(entry));
}

function findFfprobeBinary(): string | null {
	if (resolvedFfprobePath !== undefined) return resolvedFfprobePath;

	for (const candidate of getFfprobeCandidates()) {
		try {
			const result = spawnSync(candidate, ['-version'], {
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 5000
			});
			if (!result.error && result.status === 0) {
				resolvedFfprobePath = candidate;
				return resolvedFfprobePath;
			}
		} catch {
			// Try next candidate.
		}
	}

	resolvedFfprobePath = null;
	return null;
}

function findFfmpegBinary(): string | null {
	if (resolvedFfmpegPath !== undefined) return resolvedFfmpegPath;

	for (const candidate of getFfmpegCandidates()) {
		try {
			const result = spawnSync(candidate, ['-version'], {
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 5000
			});
			if (!result.error && result.status === 0) {
				resolvedFfmpegPath = candidate;
				return resolvedFfmpegPath;
			}
		} catch {
			// Try next candidate.
		}
	}

	resolvedFfmpegPath = null;
	return null;
}

function runFfprobeJson(ffprobePath: string, filePath: string): Promise<FfprobePayload> {
	return new Promise((resolve, reject) => {
		execFile(
			ffprobePath,
			['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
			{ timeout: 15000 },
			(error, stdout, stderr) => {
				if (error) {
					const stderrText = stderr?.trim();
					reject(new Error(stderrText ? `ffprobe failed: ${stderrText}` : error.message));
					return;
				}
				try {
					const payload = JSON.parse(stdout || '{}') as FfprobePayload;
					resolve(payload);
				} catch (parseError) {
					reject(
						new Error(
							`ffprobe produced invalid JSON: ${
								parseError instanceof Error ? parseError.message : String(parseError)
							}`
						)
					);
				}
			}
		);
	});
}

function runFfmpegDecode(ffmpegPath: string, filePath: string): Promise<number | null> {
	return new Promise((resolve, reject) => {
		execFile(
			ffmpegPath,
			[
				'-v',
				'error',
				'-nostdin',
				'-i',
				filePath,
				'-map',
				'0:a:0',
				'-f',
				'null',
				'-',
				'-nostats',
				'-progress',
				'pipe:2'
			],
			{ timeout: 45000 },
			(error, _stdout, stderr) => {
				if (error) {
					const stderrText = stderr?.trim();
					reject(new Error(stderrText ? `ffmpeg decode failed: ${stderrText}` : error.message));
					return;
				}
				resolve(parseLastDecodedDurationSeconds(stderr || ''));
			}
		);
	});
}

function extractProbeValues(payload: FfprobePayload): {
	durationSeconds: number | null;
	codecName?: string;
	formatName: string;
	hasAudioStream: boolean;
} {
	const streams = Array.isArray(payload.streams)
		? (payload.streams as FfprobeStream[])
		: [];
	const audioStream = streams.find((stream) => stream?.codec_type === 'audio');
	const formatRecord =
		payload.format && typeof payload.format === 'object'
			? (payload.format as FfprobeFormat)
			: undefined;

	const streamDuration = audioStream ? parseDurationSeconds(audioStream.duration) : null;
	const formatDuration = parseDurationSeconds(formatRecord?.duration);
	const durationSeconds = streamDuration ?? formatDuration;
	const codecName =
		audioStream && typeof audioStream.codec_name === 'string'
			? audioStream.codec_name
			: undefined;
	const formatName =
		formatRecord && typeof formatRecord.format_name === 'string'
			? formatRecord.format_name
			: '';

	return {
		durationSeconds,
		codecName,
		formatName,
		hasAudioStream: Boolean(audioStream)
	};
}

export async function validateAudioFileIntegrity(
	input: AudioIntegrityValidationInput,
	deps?: AudioIntegrityValidationDeps
): Promise<AudioIntegrityValidationResult> {
	const binaryFinder = deps?.binaryFinder ?? findFfprobeBinary;
	const probeRunner = deps?.probeRunner ?? runFfprobeJson;
	const ffmpegBinaryFinder = deps?.ffmpegBinaryFinder ?? findFfmpegBinary;
	const decodeRunner = deps?.decodeRunner ?? runFfmpegDecode;
	const ffprobePath = binaryFinder();

	if (!ffprobePath) {
		return { ok: false, error: 'ffprobe binary not found' };
	}

	let payload: FfprobePayload;
	try {
		payload = await probeRunner(ffprobePath, input.filePath);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}

	const extracted = extractProbeValues(payload);
	if (!extracted.hasAudioStream) {
		return { ok: false, error: 'ffprobe found no audio stream' };
	}

	if (!extracted.durationSeconds || extracted.durationSeconds <= 0) {
		return { ok: false, error: 'ffprobe reported an invalid duration' };
	}

	const expectedExt = normalizeExtension(input.expectedExtension);
	if (!matchesExpectedContainer(expectedExt, extracted.formatName, extracted.codecName)) {
		return {
			ok: false,
			error: `Container/codec mismatch for ${expectedExt ?? 'output'}: format=${
				extracted.formatName || 'unknown'
			}, codec=${extracted.codecName || 'unknown'}`
		};
	}

	const expectedDuration = Number(input.expectedDurationSeconds);
	if (Number.isFinite(expectedDuration) && expectedDuration > 0) {
		const toleranceSeconds =
			typeof deps?.durationToleranceSeconds === 'number' && deps.durationToleranceSeconds > 0
				? deps.durationToleranceSeconds
				: getConfiguredDurationToleranceSeconds(expectedDuration);
		const delta = Math.abs(extracted.durationSeconds - expectedDuration);
		if (delta > toleranceSeconds) {
			return {
				ok: false,
				error:
					`Duration mismatch: expected ${expectedDuration}s ± ${toleranceSeconds}s, ` +
					`ffprobe reported ${extracted.durationSeconds.toFixed(3)}s`
			};
		}
	}

	const ffmpegPath = ffmpegBinaryFinder();
	if (!ffmpegPath) {
		return { ok: false, error: 'ffmpeg binary not found for decode validation' };
	}
	try {
		const decodedDuration = await decodeRunner(ffmpegPath, input.filePath);
		if (typeof decodedDuration === 'number' && Number.isFinite(decodedDuration) && decodedDuration > 0) {
			const referenceDuration =
				Number.isFinite(expectedDuration) && expectedDuration > 0
					? expectedDuration
					: extracted.durationSeconds;
			const decodeToleranceSeconds =
				typeof deps?.durationToleranceSeconds === 'number' && deps.durationToleranceSeconds > 0
					? deps.durationToleranceSeconds
					: getConfiguredDurationToleranceSeconds(referenceDuration);
			const decodedDelta = Math.abs(decodedDuration - referenceDuration);
			if (decodedDelta > decodeToleranceSeconds) {
				return {
					ok: false,
					error:
						`Decoded duration mismatch: expected ${referenceDuration}s ± ${decodeToleranceSeconds}s, ` +
						`ffmpeg decoded ${decodedDuration.toFixed(3)}s`
				};
			}
		}
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}

	return {
		ok: true,
		durationSeconds: extracted.durationSeconds,
		codecName: extracted.codecName,
		formatName: extracted.formatName
	};
}

export const __test = {
	normalizeExtension,
	matchesExpectedContainer,
	extractProbeValues,
	parseFfmpegTimestampSeconds,
	parseLastDecodedDurationSeconds,
	resetCache(): void {
		resolvedFfprobePath = undefined;
		resolvedFfmpegPath = undefined;
	}
};
