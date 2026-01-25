import type { DownloadExecutionPort } from '../downloadExecutionPort';
import { createClientExecutor } from './clientExecutor';
import { createCoordinatorExecutor } from './coordinatorExecutor';
import { createServerExecutor } from './serverExecutor';

export const createDownloadExecutors = (execution: DownloadExecutionPort) => ({
	coordinator: createCoordinatorExecutor(execution),
	server: createServerExecutor(execution),
	client: createClientExecutor(execution)
});
