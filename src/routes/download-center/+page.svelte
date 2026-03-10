<script lang="ts">
	import DownloadManager from '$lib/components/DownloadManager.svelte';
</script>

<svelte:head>
	<title>Download Center | BiniLossless</title>
</svelte:head>

<section class="download-center-page">
	<header class="download-center-page__header">
		<h1>Download Center</h1>
		<p>Live queue monitoring, controls, and failure recovery tools.</p>
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
</style>
