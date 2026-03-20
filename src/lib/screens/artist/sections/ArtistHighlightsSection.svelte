<script lang="ts">
	import LegacyArtistDiscographyHighlights from '$lib/components/artist/ArtistDiscographyHighlights.svelte';
	import type { ArtistFeaturedDiscographyAlbum } from '$lib/screens/artist/artistViewModel';
	import type { Album } from '$lib/types';

	type Props = {
		artistId: number;
		artistName: string;
		featuredDiscographyAlbums: ArtistFeaturedDiscographyAlbum[];
		albumCoverOverrides: Record<number, string>;
		albumCoverFailures: Record<number, boolean>;
		coverHydrationGeneration: number;
		formatAlbumMeta: (album: Album) => string | null;
		onAlbumCoverError: (event: Event) => void;
		onAlbumCoverLoad: (event: Event) => void;
	};

	let {
		artistId,
		artistName,
		featuredDiscographyAlbums,
		albumCoverOverrides,
		albumCoverFailures,
		coverHydrationGeneration,
		formatAlbumMeta,
		onAlbumCoverError,
		onAlbumCoverLoad
	}: Props = $props();
</script>

<LegacyArtistDiscographyHighlights
	{artistId}
	{artistName}
	{featuredDiscographyAlbums}
	{albumCoverOverrides}
	{albumCoverFailures}
	{coverHydrationGeneration}
	{formatAlbumMeta}
	{onAlbumCoverError}
	{onAlbumCoverLoad}
/>
