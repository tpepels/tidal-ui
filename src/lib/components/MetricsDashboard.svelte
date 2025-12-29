<script lang="ts">
	import { onMount } from 'svelte';
	import { logger } from '$lib/core/logger';

	type HealthData = {
		status?: string;
		issues?: string[];
		responseTime?: number;
		system?: {
			memory?: { usagePercent?: number };
			uptime?: number;
		};
	};

	type MetricsData = {
		summary?: {
			totalMetrics?: number;
			averageResponseTime?: number;
			p95ResponseTime?: number;
			errorRate?: number;
		};
		alerts?: {
			alerts: string[];
			warnings: string[];
		};
	};

	type ErrorsData = {
		summary?: {
			totalErrors?: number;
			uniqueErrors?: number;
			criticalErrors?: number;
			errorRate?: number;
			topErrors?: Array<{
				error: string;
				count: number;
				lastSeen: number;
				severity: string;
			}>;
		};
	};

	let healthData: HealthData | null = null;
	let metricsData: MetricsData | null = null;
	let errorsData: ErrorsData | null = null;
	let loading = true;
	let error: string | null = null;

	async function loadDashboardData() {
		try {
			loading = true;
			error = null;

			// Load health check data
			const healthResponse = await fetch('/api/health');
			if (healthResponse.ok) {
				healthData = await healthResponse.json();
			}

			// Load metrics data
			const metricsResponse = await fetch('/api/metrics?range=3600000'); // Last hour
			if (metricsResponse.ok) {
				metricsData = await metricsResponse.json();
			}

			// Load errors data
			const errorsResponse = await fetch('/api/errors?range=3600000&summary=true');
			if (errorsResponse.ok) {
				errorsData = await errorsResponse.json();
			}

			logger.info('Dashboard data loaded', {
				component: 'MetricsDashboard',
				hasHealth: !!healthData,
				hasMetrics: !!metricsData,
				hasErrors: !!errorsData
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load dashboard data';
			logger.error('Dashboard data load failed', {
				component: 'MetricsDashboard',
				error: err instanceof Error ? err : new Error(String(err))
			});
		} finally {
			loading = false;
		}
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'healthy': return 'text-green-600';
			case 'degraded': return 'text-yellow-600';
			case 'unhealthy': return 'text-red-600';
			default: return 'text-gray-600';
		}
	}

	function getSeverityColor(severity: string): string {
		switch (severity) {
			case 'critical': return 'text-red-600 bg-red-50';
			case 'high': return 'text-orange-600 bg-orange-50';
			case 'medium': return 'text-yellow-600 bg-yellow-50';
			case 'low': return 'text-blue-600 bg-blue-50';
			default: return 'text-gray-600 bg-gray-50';
		}
	}

	onMount(() => {
		loadDashboardData();

		// Refresh data every 30 seconds
		const interval = setInterval(loadDashboardData, 30000);

		return () => clearInterval(interval);
	});
</script>

<div class="metrics-dashboard p-6 bg-gray-50 min-h-screen">
	<div class="max-w-7xl mx-auto">
		<h1 class="text-3xl font-bold text-gray-900 mb-8">System Monitoring Dashboard</h1>

		{#if loading}
			<div class="flex items-center justify-center py-12">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
				<span class="ml-2 text-gray-600">Loading dashboard data...</span>
			</div>
		{:else if error}
			<div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
				<div class="flex">
					<div class="flex-shrink-0">
						<svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
							<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
						</svg>
					</div>
					<div class="ml-3">
						<h3 class="text-sm font-medium text-red-800">Error loading dashboard</h3>
						<div class="mt-2 text-sm text-red-700">{error}</div>
					</div>
				</div>
			</div>
		{:else}
			<!-- Health Status -->
			{#if healthData}
				<div class="bg-white rounded-lg shadow mb-6">
					<div class="px-6 py-4 border-b border-gray-200">
						<h2 class="text-xl font-semibold text-gray-900">System Health</h2>
					</div>
					<div class="p-6">
						<div class="flex items-center mb-4">
							<span class="text-sm font-medium text-gray-500 mr-2">Status:</span>
							<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {getStatusColor(healthData.status)} bg-{healthData.status === 'healthy' ? 'green' : healthData.status === 'degraded' ? 'yellow' : 'red'}-100">
								{healthData.status?.toUpperCase()}
							</span>
						</div>

						{#if healthData.issues && healthData.issues.length > 0}
							<div class="mb-4">
								<h3 class="text-sm font-medium text-gray-900 mb-2">Issues:</h3>
								<ul class="list-disc list-inside text-sm text-gray-600">
									{#each healthData.issues as issue (issue)}
										<li>{issue}</li>
									{/each}
								</ul>
							</div>
						{/if}

						<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div class="bg-gray-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-gray-500">Response Time</div>
								<div class="text-2xl font-bold text-gray-900">{healthData.responseTime}ms</div>
							</div>
							<div class="bg-gray-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-gray-500">Memory Usage</div>
								<div class="text-2xl font-bold text-gray-900">{healthData.system?.memory?.usagePercent || 0}%</div>
							</div>
							<div class="text-sm font-medium text-gray-500">Uptime</div>
							<div class="text-2xl font-bold text-gray-900">{Math.floor((healthData.system?.uptime || 0) / 3600)}h</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Performance Metrics -->
			{#if metricsData}
				<div class="bg-white rounded-lg shadow mb-6">
					<div class="px-6 py-4 border-b border-gray-200">
						<h2 class="text-xl font-semibold text-gray-900">Performance Metrics</h2>
					</div>
					<div class="p-6">
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
							<div class="bg-blue-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-blue-600">Total Metrics</div>
								<div class="text-2xl font-bold text-blue-900">{metricsData.summary?.totalMetrics || 0}</div>
							</div>
							<div class="bg-green-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-green-600">Avg Response Time</div>
								<div class="text-2xl font-bold text-green-900">{metricsData.summary?.averageResponseTime || 0}ms</div>
							</div>
							<div class="bg-yellow-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-yellow-600">P95 Response Time</div>
								<div class="text-2xl font-bold text-yellow-900">{metricsData.summary?.p95ResponseTime || 0}ms</div>
							</div>
							<div class="bg-red-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-red-600">Error Rate</div>
								<div class="text-2xl font-bold text-red-900">{metricsData.summary?.errorRate || 0}%</div>
							</div>
						</div>

						{#if metricsData.alerts && (metricsData.alerts.alerts.length > 0 || metricsData.alerts.warnings.length > 0)}
							<div class="mb-4">
								<h3 class="text-sm font-medium text-gray-900 mb-2">Alerts:</h3>
								{#each metricsData.alerts.alerts as alert (alert)}
									<div class="flex items-center p-3 mb-2 bg-red-50 border border-red-200 rounded-lg">
										<svg class="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
											<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
										</svg>
										<span class="text-sm text-red-800">{alert}</span>
									</div>
								{/each}
								{#each metricsData.alerts.warnings as warning (warning)}
									<div class="flex items-center p-3 mb-2 bg-yellow-50 border border-yellow-200 rounded-lg">
										<svg class="w-5 h-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
											<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
										</svg>
										<span class="text-sm text-yellow-800">{warning}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error Tracking -->
			{#if errorsData}
				<div class="bg-white rounded-lg shadow mb-6">
					<div class="px-6 py-4 border-b border-gray-200">
						<h2 class="text-xl font-semibold text-gray-900">Error Tracking</h2>
					</div>
					<div class="p-6">
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
							<div class="bg-gray-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-gray-500">Total Errors</div>
								<div class="text-2xl font-bold text-gray-900">{errorsData.summary?.totalErrors || 0}</div>
							</div>
							<div class="bg-purple-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-purple-600">Unique Errors</div>
								<div class="text-2xl font-bold text-purple-900">{errorsData.summary?.uniqueErrors || 0}</div>
							</div>
							<div class="bg-red-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-red-600">Critical Errors</div>
								<div class="text-2xl font-bold text-red-900">{errorsData.summary?.criticalErrors || 0}</div>
							</div>
							<div class="bg-orange-50 p-4 rounded-lg">
								<div class="text-sm font-medium text-orange-600">Error Rate</div>
								<div class="text-2xl font-bold text-orange-900">{errorsData.summary?.errorRate || 0}/min</div>
							</div>
						</div>

						{#if errorsData.summary?.topErrors && errorsData.summary.topErrors.length > 0}
							<div class="mb-4">
								<h3 class="text-sm font-medium text-gray-900 mb-2">Top Errors:</h3>
								<div class="space-y-2">
									{#each errorsData.summary.topErrors.slice(0, 5) as error (error.error)}
										<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
											<div class="flex-1">
												<div class="text-sm font-medium text-gray-900 truncate">{error.error}</div>
												<div class="text-xs text-gray-500">Last seen: {new Date(error.lastSeen).toLocaleString()}</div>
											</div>
											<div class="flex items-center space-x-2">
												<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium {getSeverityColor(error.severity)}">
													{error.severity}
												</span>
												<span class="text-sm font-medium text-gray-900">{error.count}x</span>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Recent Activity -->
			<div class="bg-white rounded-lg shadow">
				<div class="px-6 py-4 border-b border-gray-200">
					<h2 class="text-xl font-semibold text-gray-900">Recent Activity</h2>
				</div>
				<div class="p-6">
					<div class="text-sm text-gray-600">
						<p class="mb-2">📊 Dashboard last updated: {new Date().toLocaleString()}</p>
						<p class="mb-2">🔄 Auto-refresh every 30 seconds</p>
						<p>📈 Monitoring system active and collecting data</p>
					</div>

					<div class="mt-4 flex space-x-4">
						<button
							class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
							onclick={loadDashboardData}
						>
							Refresh Now
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.metrics-dashboard {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}
</style>
