<script lang="ts">
	import ShareButton from '$lib/components/ShareButton.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import type { ActionButtonVM } from '$lib/presentation/viewModels';

	type Props = {
		trackId: number;
		actions: ActionButtonVM[];
		onAction: (actionId: string) => void;
	};

	let { trackId, actions, onAction }: Props = $props();
</script>

<SectionBlock
	title="Actions"
	subtitle="Playback and download controls."
	tone="secondary"
>
	<div class="ui-action-row ui-action-row--progressive">
		{#each actions as action (action.id ?? action.label)}
			<button
				onclick={() => action.id && onAction(action.id)}
				class={`ui-action-button ${action.tone === 'primary' ? 'ui-action-button--primary' : ''}`.trim()}
				disabled={action.disabled}
				aria-label={action.ariaLabel}
				title={action.title ?? action.ariaLabel}
			>
				{action.label}
			</button>
		{/each}
		<ShareButton type="track" id={trackId} variant="secondary" />
	</div>
</SectionBlock>
