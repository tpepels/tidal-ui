<script lang="ts">
	import DownloadLog from '$lib/components/DownloadLog.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/download-log');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Download Log'} | BiniLossless</title>
</svelte:head>

<section class="download-log-page">
	<header class="download-log-page__header">
		<div>
			<h1>{meta?.title ?? 'Download Log'}</h1>
			<p>{meta?.subtitle ?? 'Live download events, health checks, and cleanup tools.'}</p>
		</div>
		<div class="download-log-page__links">
			<a href="/download-center">Download Center</a>
			<a href="/status">Status</a>
		</div>
	</header>
	<DownloadLog />
</section>

<style>
	.download-log-page {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.download-log-page__header h1 {
		margin: 0;
		font-size: 1.2rem;
	}

	.download-log-page__header p {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		opacity: 0.78;
	}

	.download-log-page__header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
	}

	.download-log-page__links {
		display: inline-flex;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.download-log-page__links a {
		font-size: 0.72rem;
		font-weight: 600;
		text-decoration: none;
		color: inherit;
		padding: 0.35rem 0.52rem;
		border-radius: 10px;
		border: 1px solid rgba(212, 212, 212, 0.3);
		background: rgba(255, 255, 255, 0.05);
	}
</style>
