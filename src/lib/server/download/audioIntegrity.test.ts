import { describe, expect, it } from 'vitest';
import { __test, validateAudioFileIntegrity } from './audioIntegrity';

describe('audioIntegrity', () => {
	it('fails when ffprobe is unavailable', async () => {
		const result = await validateAudioFileIntegrity(
			{ filePath: '/tmp/example.flac' },
			{ binaryFinder: () => null }
		);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/ffprobe/i);
	});

	it('fails when ffmpeg is unavailable', async () => {
		const result = await validateAudioFileIntegrity(
			{ filePath: '/tmp/example.flac' },
			{
				binaryFinder: () => '/usr/bin/ffprobe',
				ffmpegBinaryFinder: () => null,
				probeRunner: async () => ({
					format: { format_name: 'flac', duration: '200.10' },
					streams: [{ codec_type: 'audio', codec_name: 'flac', duration: '200.05' }]
				})
			}
		);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/ffmpeg/i);
	});

	it('validates codec/container and duration from probe payload', async () => {
		const result = await validateAudioFileIntegrity(
			{
				filePath: '/tmp/example.flac',
				expectedExtension: '.flac',
				expectedDurationSeconds: 200
			},
			{
				binaryFinder: () => '/usr/bin/ffprobe',
				ffmpegBinaryFinder: () => '/usr/bin/ffmpeg',
				durationToleranceSeconds: 5,
				probeRunner: async () => ({
					format: { format_name: 'flac', duration: '200.10' },
					streams: [{ codec_type: 'audio', codec_name: 'flac', duration: '200.05' }]
				}),
				decodeRunner: async () => {}
			}
		);

		expect(result.ok).toBe(true);
		expect(result.durationSeconds).toBeCloseTo(200.05, 2);
		expect(result.codecName).toBe('flac');
	});

	it('fails when duration is outside tolerance', async () => {
		const result = await validateAudioFileIntegrity(
			{
				filePath: '/tmp/example.flac',
				expectedExtension: '.flac',
				expectedDurationSeconds: 180
			},
			{
				binaryFinder: () => '/usr/bin/ffprobe',
				ffmpegBinaryFinder: () => '/usr/bin/ffmpeg',
				durationToleranceSeconds: 2,
				probeRunner: async () => ({
					format: { format_name: 'flac', duration: '198' },
					streams: [{ codec_type: 'audio', codec_name: 'flac', duration: '198' }]
				}),
				decodeRunner: async () => {}
			}
		);

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/duration mismatch/i);
	});

	it('fails on container mismatch', async () => {
		const result = await validateAudioFileIntegrity(
			{
				filePath: '/tmp/example.flac',
				expectedExtension: '.flac'
			},
			{
				binaryFinder: () => '/usr/bin/ffprobe',
				ffmpegBinaryFinder: () => '/usr/bin/ffmpeg',
				probeRunner: async () => ({
					format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '120' },
					streams: [{ codec_type: 'audio', codec_name: 'aac', duration: '120' }]
				}),
				decodeRunner: async () => {}
			}
		);

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/container\/codec mismatch/i);
	});

	it('fails when ffmpeg decode step fails', async () => {
		const result = await validateAudioFileIntegrity(
			{
				filePath: '/tmp/example.flac',
				expectedExtension: '.flac'
			},
			{
				binaryFinder: () => '/usr/bin/ffprobe',
				ffmpegBinaryFinder: () => '/usr/bin/ffmpeg',
				probeRunner: async () => ({
					format: { format_name: 'flac', duration: '120' },
					streams: [{ codec_type: 'audio', codec_name: 'flac', duration: '120' }]
				}),
				decodeRunner: async () => {
					throw new Error('ffmpeg decode failed: invalid data');
				}
			}
		);

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/decode failed/i);
	});

	it('extracts stream and format values safely', () => {
		const extracted = __test.extractProbeValues({
			format: { format_name: 'flac', duration: '100.25' },
			streams: [{ codec_type: 'audio', codec_name: 'flac', duration: '100.20' }]
		});
		expect(extracted.hasAudioStream).toBe(true);
		expect(extracted.durationSeconds).toBeCloseTo(100.2, 2);
		expect(extracted.codecName).toBe('flac');
	});

	it('fails when decoded duration is much shorter than expected (partial file)', async () => {
		const result = await validateAudioFileIntegrity(
			{
				filePath: '/tmp/example.flac',
				expectedExtension: '.flac',
				expectedDurationSeconds: 211
			},
			{
				binaryFinder: () => '/usr/bin/ffprobe',
				ffmpegBinaryFinder: () => '/usr/bin/ffmpeg',
				durationToleranceSeconds: 3,
				probeRunner: async () => ({
					format: { format_name: 'flac', duration: '211' },
					streams: [{ codec_type: 'audio', codec_name: 'flac', duration: '211' }]
				}),
				decodeRunner: async () => 29.2
			}
		);

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/decoded duration mismatch/i);
	});

	it('parses ffmpeg progress timestamps', () => {
		expect(__test.parseFfmpegTimestampSeconds('00:03:31.245')).toBeCloseTo(211.245, 3);
		expect(__test.parseFfmpegTimestampSeconds('n/a')).toBeNull();

		const decoded = __test.parseLastDecodedDurationSeconds(
			'frame=1\nout_time=00:00:10.000\nout_time=00:00:29.123\nprogress=end'
		);
		expect(decoded).toBeCloseTo(29.123, 3);
	});
});
