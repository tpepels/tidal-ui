const clampFraction = (value: number): number => Math.max(0, Math.min(1, value));

export const calculateWeightedProgress = (
	downloadFraction: number,
	uploadFraction: number,
	downloadWeight: number
): number => {
	return clampFraction(downloadFraction * downloadWeight + uploadFraction * (1 - downloadWeight));
};

export const calculateDownloadFraction = (params: {
	receivedBytes: number;
	totalBytes?: number;
	previous: number;
}): number => {
	const { receivedBytes, totalBytes, previous } = params;
	if (typeof totalBytes === 'number' && totalBytes > 0) {
		return clampFraction(receivedBytes / totalBytes);
	}
	return Math.min(previous + 0.05, 0.9);
};

export const calculateEmbeddingFraction = (progress: number): number => {
	return clampFraction(0.85 + progress * 0.15);
};

export const calculateUploadFraction = (params: {
	uploadedBytes: number;
	totalBytes?: number;
	previous: number;
}): number => {
	const { uploadedBytes, totalBytes, previous } = params;
	if (typeof totalBytes === 'number' && totalBytes > 0) {
		return clampFraction(uploadedBytes / totalBytes);
	}
	return clampFraction(previous);
};
