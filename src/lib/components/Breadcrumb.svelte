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
		color: rgba(166, 166, 166, 0.9);
	}

	.breadcrumb-separator {
		color: rgba(132, 132, 132, 0.9);
		font-weight: 500;
	}

	.breadcrumb-link {
		color: rgba(176, 176, 176, 0.9);
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.breadcrumb-link:hover {
		color: rgba(236, 236, 236, 0.96);
	}

	.breadcrumb-current {
		color: rgba(220, 220, 220, 0.92);
		font-weight: 500;
	}
</style>
