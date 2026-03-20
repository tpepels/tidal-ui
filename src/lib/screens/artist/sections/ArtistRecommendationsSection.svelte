<script lang="ts">
	import LegacyArtistRecommendationsRail from '$lib/components/artist/ArtistRecommendationsRail.svelte';
	import type { Album, Artist, ArtistRecommendations } from '$lib/types';

	type Props = {
		artistId: number;
		artistName: string;
		recommendations: ArtistRecommendations | null;
		recommendationsLoading: boolean;
		recommendationsError: string | null;
		recommendedArtists: Artist[];
		recommendedAlbums: Album[];
		formatAlbumMeta: (album: Album) => string | null;
	};

	let {
		artistId,
		artistName,
		recommendations,
		recommendationsLoading,
		recommendationsError,
		recommendedArtists,
		recommendedAlbums,
		formatAlbumMeta
	}: Props = $props();
</script>

<LegacyArtistRecommendationsRail
	{artistId}
	{artistName}
	{recommendations}
	{recommendationsLoading}
	{recommendationsError}
	{recommendedArtists}
	{recommendedAlbums}
	{formatAlbumMeta}
/>
