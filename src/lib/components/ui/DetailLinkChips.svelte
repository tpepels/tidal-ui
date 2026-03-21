<script lang="ts">
	import type { DetailLinkVM } from '$lib/presentation/viewModels';

	type Props = {
		links: DetailLinkVM[];
	};

	let { links }: Props = $props();
</script>

{#if links.length > 0}
	<div class="ui-action-row ui-action-row--compact ui-detail-link-chips">
		{#each links as link (link.id)}
			<a
				href={link.href}
				target={link.external ? '_blank' : undefined}
				rel={link.external ? 'noopener noreferrer' : undefined}
				aria-label={link.ariaLabel ?? (link.external ? `${link.label} (opens in a new tab)` : undefined)}
				data-sveltekit-preload-data={link.preload !== false && !link.external ? '' : undefined}
				class="ui-chip-button ui-chip-button--compact ui-chip-button--detail"
			>
				{link.label}
			</a>
		{/each}
	</div>
{/if}
