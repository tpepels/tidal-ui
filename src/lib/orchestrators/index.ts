/**
 * Orchestrators - Business Logic Coordination Layer
 *
 * Orchestrators coordinate multi-service workflows and manage complex state machines.
 * They sit between components and services, calling stores directly for state updates.
 */

export {
	downloadOrchestrator,
	DownloadOrchestrator,
	type DownloadOrchestratorOptions,
	type DownloadOrchestratorResult,
	type DownloadOrchestratorError
} from './downloadOrchestrator';

export {
	searchOrchestrator,
	SearchOrchestrator,
	type SearchOrchestratorOptions,
	type SearchWorkflowResult,
	type UrlType
} from './searchOrchestrator';

export {
	playlistOrchestrator,
	PlaylistOrchestrator,
	type PlaylistConversionOptions,
	type PlaylistConversionResult,
	type PlaylistConversionError,
	type PlaylistConversionProgress,
	type PlaylistConversionPhase
} from './playlistOrchestrator';
