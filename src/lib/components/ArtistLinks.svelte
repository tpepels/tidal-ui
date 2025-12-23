<script lang="ts">
	interface Props {
		artists: Array<{ id?: number; name: string }>;
		class?: string;
		showSeparators?: boolean;
	}

	let { artists, class: className = '', showSeparators = true }: Props = $props();
</script>

<span class={className}>
	{#each artists as artist, idx (artist?.id ?? `${artist.name}-${idx}`)}
		{#if artist?.id}
			<a
				href={`/artist/${artist.id}`}
				class="hover:text-blue-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
				data-sveltekit-preload-data
			>
				{artist.name}
			</a>
		{:else}
			<span>{artist.name}</span>
		{/if}
		{#if showSeparators && idx < artists.length - 1}
			<span class="text-gray-500">, </span>
		{/if}
	{/each}
</span>