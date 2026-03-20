<script lang="ts">
	import ShareButton from '$lib/components/ShareButton.svelte';
	import SectionBlock from '$lib/components/ui/SectionBlock.svelte';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';
	import type { ActionButtonVM, StateNoticeVM } from '$lib/presentation/viewModels';

	type Props = {
		albumId: number;
		actions: ActionButtonVM[];
		notices: StateNoticeVM[];
		onAction: (actionId: string) => void;
	};

	let { albumId, actions, notices, onAction }: Props = $props();
</script>

<SectionBlock
	title="Actions"
	subtitle="Play, download, and maintain this album."
	tone="secondary"
>
	<div class="ui-action-row ui-action-row--progressive">
		{#each actions as action (action.id ?? action.label)}
			<button
				onclick={() => action.id && onAction(action.id)}
				class={`ui-action-button ${action.tone === 'primary' ? 'ui-action-button--primary' : ''}`.trim()}
				disabled={action.disabled}
				aria-label={action.ariaLabel}
				aria-busy={action.busy ? 'true' : undefined}
				title={action.title ?? action.ariaLabel}
			>
				{#if action.busy}
					<span class="animate-pulse">{action.label}</span>
				{:else}
					{action.label}
				{/if}
			</button>
		{/each}
		<ShareButton type="album" id={albumId} variant="secondary" />
	</div>

	{#each notices as notice, index (`${notice.tone}:${index}`)}
		<StateNotice
			tone={notice.tone}
			title={notice.title}
			message={notice.message}
			busy={notice.busy}
			compact={true}
			liveRegion={notice.liveRegion}
		/>
	{/each}
</SectionBlock>
