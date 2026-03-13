export type QueueActionResult = {
	success: boolean;
	error?: string;
};

export async function runQueueJobAction(
	jobId: string,
	action: 'cancel' | 'pause' | 'resume' | 'retry'
): Promise<QueueActionResult> {
	try {
		const response = await fetch(`/api/download-queue/${jobId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action })
		});
		const payload = (await response.json()) as { success?: boolean; error?: string };
		if (!response.ok || !payload.success) {
			return { success: false, error: payload.error ?? `Failed to ${action} job` };
		}
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : `Failed to ${action} job`
		};
	}
}

export async function removeQueueJob(jobId: string): Promise<QueueActionResult> {
	try {
		const response = await fetch(`/api/download-queue/${jobId}`, { method: 'DELETE' });
		const payload = (await response.json()) as { success?: boolean; error?: string };
		if (!response.ok || !payload.success) {
			return { success: false, error: payload.error ?? 'Failed to remove job' };
		}
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to remove job'
		};
	}
}
