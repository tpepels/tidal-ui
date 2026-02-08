/**
 * Audio format detection via magic bytes.
 * This module has no dependencies on api.ts or downloads.ts to avoid circular imports.
 */

/**
 * Detect audio format from magic bytes in a Uint8Array.
 * FLAC starts with "fLaC" (0x664C6143), MP4 has "ftyp" at offset 4.
 */
export function detectAudioFormat(
	data: Uint8Array
): { extension: string; mimeType: string } | null {
	if (!data || data.length < 12) return null;

	// FLAC: bytes 0-3 = 0x66 0x4C 0x61 0x43 ("fLaC")
	if (data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) {
		return { extension: 'flac', mimeType: 'audio/flac' };
	}

	// MP4/M4A: bytes 4-7 = 0x66 0x74 0x79 0x70 ("ftyp")
	if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
		return { extension: 'm4a', mimeType: 'audio/mp4' };
	}

	return null;
}

/**
 * Detect audio format from a Blob by reading its first 12 bytes.
 */
export async function detectAudioFormatFromBlob(
	blob: Blob
): Promise<{ extension: string; mimeType: string } | null> {
	const slice = blob.slice(0, 12);
	const buffer = await slice.arrayBuffer();
	return detectAudioFormat(new Uint8Array(buffer));
}
