<script lang="ts">
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
</script>

{#if $breadcrumbStore.breadcrumbs.length > 1}
	<nav class="breadcrumb-nav" aria-label="Breadcrumb">
		{#each $breadcrumbStore.breadcrumbs as crumb, index (`${index}:${crumb.href}`)}
			{#if index > 0}
				<span class="breadcrumb-separator">/</span>
			{/if}
			{#if index === $breadcrumbStore.breadcrumbs.length - 1}
				<span class="breadcrumb-current">{crumb.label}</span>
			{:else}
				<a href={crumb.href} class="breadcrumb-link" data-sveltekit-preload-data>{crumb.label}</a>
			{/if}
		{/each}
	</nav>
{/if}

<style>
	.breadcrumb-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		font-size: 0.875rem;
		color: #9ca3af;
	}

	.breadcrumb-separator {
		color: #6b7280;
		font-weight: 500;
	}

	.breadcrumb-link {
		color: #9ca3af;
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.breadcrumb-link:hover {
		color: #60a5fa;
	}

	.breadcrumb-current {
		color: #d1d5db;
		font-weight: 500;
	}
</style>
