<script lang="ts">
	import DownloadLog from '$lib/components/DownloadLog.svelte';
</script>

<svelte:head>
	<title>Download Log | BiniLossless</title>
</svelte:head>

<section class="download-log-page">
	<header class="download-log-page__header">
		<h1>Download Log</h1>
		<p>Live download events, health checks, and cleanup tools.</p>
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
</style>

