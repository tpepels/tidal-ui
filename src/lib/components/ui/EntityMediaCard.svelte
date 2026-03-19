<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import MediaTile, { type MediaTileLink } from '$lib/components/ui/MediaTile.svelte';

	type Tone = 'default' | 'secondary' | 'tertiary';

	export type EntityCardLink = MediaTileLink;

	interface Props extends HTMLAttributes<HTMLElement> {
		type: 'album' | 'artist' | 'playlist';
		href: string;
		title: string;
		subtitle?: string | null;
		meta?: string | null;
		description?: string | null;
		intent?: string | null;
		imageSrc?: string | null;
		imageAlt?: string;
		coverCacheKey?: string | null;
		coverCandidates?: string[];
		links?: EntityCardLink[];
		preload?: boolean;
		tone?: Tone;
		badge?: Snippet;
		action?: Snippet;
		artwork?: Snippet;
		bodyExtra?: Snippet;
		linksContent?: Snippet;
		footer?: Snippet;
	}

	let props: Props = $props();
</script>

<MediaTile {...props} />
