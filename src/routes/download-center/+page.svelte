<script lang="ts">
	import DownloadManager from '$lib/components/DownloadManager.svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/download-center');
</script>

<svelte:head>
	<title>{meta?.title ?? 'Download Center'} | BiniLossless</title>
</svelte:head>

<section class="download-center-page">
	<header class="download-center-page__header">
		<div>
			<h1>{meta?.title ?? 'Download Center'}</h1>
			<p>{meta?.subtitle ?? 'Live queue monitoring, controls, and failure recovery tools.'}</p>
		</div>
		<div class="download-center-page__links">
			<a href="/status">Status</a>
			<a href="/download-log">Download Log</a>
			<a href="/settings">Settings</a>
		</div>
	</header>
	<DownloadManager pageMode={true} />
</section>

<style>
	.download-center-page {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.download-center-page__header h1 {
		margin: 0;
		font-size: 1.2rem;
	}

	.download-center-page__header p {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		opacity: 0.78;
	}

	.download-center-page__header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
	}

	.download-center-page__links {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.download-center-page__links a {
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
