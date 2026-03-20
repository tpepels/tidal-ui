<script lang="ts">
	import ShareButton from '$lib/components/ShareButton.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import type { ActionButtonVM } from '$lib/presentation/viewModels';

	type Props = {
		playlistId: string;
		actions: ActionButtonVM[];
		onAction: (actionId: string) => void;
	};

	let { playlistId, actions, onAction }: Props = $props();
</script>

<SectionBlock
	title="Actions"
	subtitle="Play or share this playlist."
	tone="secondary"
>
	<div class="ui-action-row ui-action-row--progressive">
		{#each actions as action (action.id ?? action.label)}
			<button
				onclick={() => action.id && onAction(action.id)}
				class={`ui-action-button ${action.tone === 'primary' ? 'ui-action-button--primary' : ''}`.trim()}
				aria-label={action.ariaLabel}
				title={action.title ?? action.ariaLabel}
			>
				{action.label}
			</button>
		{/each}
		<ShareButton type="playlist" id={playlistId} variant="secondary" />
	</div>
</SectionBlock>
