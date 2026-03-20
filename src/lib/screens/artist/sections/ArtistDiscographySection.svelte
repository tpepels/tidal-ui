<script lang="ts">
	import ArtistDiscographySectionContent from '$lib/screens/artist/ArtistDiscographySectionContent.svelte';
	import type {
		ArtistDiscographyFilterState,
		ArtistScreenAlbumDownloadState
	} from '$lib/screens/artist/artistViewModel';
	import type { Album, ArtistDetails, AudioQuality } from '$lib/types';
	import type { DiscographyBestEditionRule, DiscographyGroup } from '$lib/utils/discography';

	type Props = {
		artistId: number;
		artistName: string;
		discography: Album[];
		visibleDiscography: Album[];
		discographyAlbums: DiscographyGroup[];
		discographyEps: DiscographyGroup[];
		discographySingles: DiscographyGroup[];
		discographyInfo: ArtistDetails['discographyInfo'] | null;
		downloadQuality: AudioQuality;
		bestEditionRule: DiscographyBestEditionRule;
		discographyFilterState: ArtistDiscographyFilterState;
		filtersHideAllDiscography: boolean;
		isDownloadingDiscography: boolean;
		discographyProgress: { completed: number; total: number };
		discographyError: string | null;
		discographyMissingCoverCount: number;
		albumCoverOverrides: Record<number, string>;
		albumCoverFailures: Record<number, boolean>;
		coverHydrationGeneration: number;
		albumDownloadStates: Record<number, ArtistScreenAlbumDownloadState>;
		albumLibraryPresence: Record<number, { exists: boolean; matchedTracks: number }>;
		albumMusicBrainzReleaseMatches: Record<number, string>;
		isDiscographyMusicBrainzLoading: boolean;
		pendingDiscographyMusicBrainzAlbumIds: Set<number>;
		displayTrackTotal: (total?: number | null) => number;
		formatAlbumMeta: (album: Album) => string | null;
		formatQualityLabel: (quality: AudioQuality) => string;
		onDownloadDiscography: () => Promise<void> | void;
		onBestEditionRuleChange: (rule: DiscographyBestEditionRule) => void;
		onToggleDiscographyFilter: (
			key: 'album' | 'ep' | 'single' | 'live' | 'remaster' | 'explicit' | 'clean'
		) => void;
		onResetDiscographyFilters: () => void;
		onCancelAlbumQueueDownload: (albumId: number, event?: MouseEvent) => Promise<void> | void;
		onAlbumDownload: (album: Album, event?: MouseEvent) => Promise<void> | void;
		onAlbumCoverError: (event: Event) => void;
		onAlbumCoverLoad: (event: Event) => void;
	};

	let props: Props = $props();
</script>

<ArtistDiscographySectionContent {...props} />
