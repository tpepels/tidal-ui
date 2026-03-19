<script lang="ts">
	type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
	type LiveRegion = 'off' | 'polite' | 'assertive';

	let {
		tone = 'neutral',
		title = null,
		message,
		stale = false,
		embedded = false,
		compact = false,
		liveRegion = tone === 'error' ? 'assertive' : 'polite',
		busy = false,
		actionLabel = null,
		onAction = null,
		className = ''
	}: {
		tone?: Tone;
		title?: string | null;
		message: string;
		stale?: boolean;
		embedded?: boolean;
		compact?: boolean;
		liveRegion?: LiveRegion;
		busy?: boolean;
		actionLabel?: string | null;
		onAction?: (() => void) | null;
		className?: string;
	} = $props();

	const role = $derived(
		liveRegion === 'off' ? undefined : liveRegion === 'assertive' ? 'alert' : 'status'
	);
	const ariaLive = $derived(liveRegion === 'off' ? undefined : liveRegion);
</script>

<div
	class={`ui-state-notice ${embedded ? 'ui-state-notice--embedded' : ''} ${compact ? 'ui-state-notice--compact' : ''} ${className}`.trim()}
	data-tone={tone === 'neutral' ? undefined : tone}
	role={role}
	aria-live={ariaLive}
	aria-atomic={liveRegion === 'off' ? undefined : 'true'}
	aria-busy={busy ? 'true' : undefined}
>
	{#if busy}
		<span class="ui-state-notice__busy-indicator" aria-hidden="true"></span>
	{/if}
	<div class="ui-state-notice__copy">
		{#if title || stale}
			<div class="ui-state-notice__header">
				{#if title}
					<p class="ui-state-notice__title">{title}</p>
				{/if}
				{#if stale}
					<span class="ui-state-notice__badge">Stale</span>
				{/if}
			</div>
		{/if}
		<p class="ui-state-notice__message">{message}</p>
	</div>
	{#if onAction && actionLabel}
		<button type="button" class="ui-chip-button ui-chip-button--compact" onclick={onAction}>
			{actionLabel}
		</button>
	{/if}
</div>
