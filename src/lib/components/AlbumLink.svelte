<script lang="ts">
	interface Props {
		album: { id?: number; title: string };
		class?: string;
		truncate?: boolean;
	}

	let { album, class: className = '', truncate = false }: Props = $props();
</script>

{#if album?.id}
	<a
		href={`/album/${album.id}`}
		class="transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 {truncate ? 'truncate' : ''} {className}"
		data-sveltekit-preload-data
		title="View album page"
	>
		{album.title}
	</a>
{:else}
	<span class="{truncate ? 'truncate' : ''} {className}">{album.title}</span>
{/if}
