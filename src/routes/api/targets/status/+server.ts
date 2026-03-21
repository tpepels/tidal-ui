import { json, type RequestHandler } from '@sveltejs/kit';
import {
	API_CONFIG,
	getApiTargetRefreshState,
	refreshApiTargets,
	refreshApiTargetsIfStale
} from '$lib/config/targets';

function shouldForceRefresh(url: URL): boolean {
	const refreshParam = (url.searchParams.get('refresh') || '').trim().toLowerCase();
	return refreshParam === '1' || refreshParam === 'true' || refreshParam === 'force';
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const force = shouldForceRefresh(url);
		const refreshResult = force
			? await refreshApiTargets({ force: true })
			: await refreshApiTargetsIfStale();
		const state = getApiTargetRefreshState();

		return json({
			success: true,
			source: state.source,
			lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt,
			lastSuccessfulRefreshIso:
				state.lastSuccessfulRefreshAt > 0
					? new Date(state.lastSuccessfulRefreshAt).toISOString()
					: null,
			targetCount: state.targetCount,
			browseTargetCount: state.browseTargetCount,
			streamTargetCount: state.streamTargetCount,
			error: state.error ?? null,
			targets: API_CONFIG.targets.map((target) => ({
				name: target.name,
				baseUrl: target.baseUrl,
				weight: target.weight
			})),
			browseTargets: API_CONFIG.browseTargets.map((target) => ({
				name: target.name,
				baseUrl: target.baseUrl,
				weight: target.weight
			})),
			streamTargets: API_CONFIG.streamTargets.map((target) => ({
				name: target.name,
				baseUrl: target.baseUrl,
				weight: target.weight
			})),
			refresh: refreshResult
		});
	} catch (error) {
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to read target refresh status'
			},
			{ status: 500 }
		);
	}
};
