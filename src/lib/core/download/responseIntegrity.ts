type ParsedContentRange = {
	start: number;
	end: number;
	total?: number;
};

function parsePositiveByteLength(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseContentRange(value: string | null): ParsedContentRange | null {
	if (!value) return null;
	const trimmed = value.trim();
	const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(trimmed);
	if (!match) return null;

	const start = Number.parseInt(match[1], 10);
	const end = Number.parseInt(match[2], 10);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		return null;
	}

	const rawTotal = match[3];
	const total =
		rawTotal === '*'
			? undefined
			: Number.isFinite(Number.parseInt(rawTotal, 10))
				? Number.parseInt(rawTotal, 10)
				: undefined;

	return { start, end, total };
}

export function assertCompleteResponseBody(
	response: Response,
	receivedBytes: number,
	contextLabel = 'HTTP response'
): void {
	const getHeader = (name: string): string | null => {
		if (!response || !response.headers || typeof response.headers.get !== 'function') {
			return null;
		}
		return response.headers.get(name);
	};

	const contentLength = parsePositiveByteLength(getHeader('Content-Length'));
	if (contentLength !== undefined && receivedBytes !== contentLength) {
		throw new Error(
			`${contextLabel} length mismatch: expected ${contentLength} bytes from Content-Length, received ${receivedBytes}`
		);
	}

	if (response.status !== 206) {
		return;
	}

	const contentRange = parseContentRange(getHeader('Content-Range'));
	if (!contentRange) {
		throw new Error(`${contextLabel} is 206 Partial Content without a valid Content-Range header`);
	}

	const rangeLength = contentRange.end - contentRange.start + 1;
	if (rangeLength !== receivedBytes) {
		throw new Error(
			`${contextLabel} length mismatch: Content-Range implies ${rangeLength} bytes, received ${receivedBytes}`
		);
	}

	if (contentLength !== undefined && contentLength !== rangeLength) {
		throw new Error(
			`${contextLabel} length mismatch: Content-Length ${contentLength} disagrees with Content-Range ${rangeLength}`
		);
	}

	if (contentRange.total === undefined) {
		throw new Error(
			`${contextLabel} cannot be fully validated: Content-Range total size is unknown`
		);
	}

	const isCompleteEntity =
		contentRange.start === 0 && contentRange.end + 1 === contentRange.total;
	if (!isCompleteEntity) {
		throw new Error(
			`${contextLabel} is incomplete: received range ${contentRange.start}-${contentRange.end}/${contentRange.total}`
		);
	}
}
