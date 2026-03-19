<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import type { Playlist, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import {
		machineCurrentTrack,
		machineIsPlaying,
		machineCurrentTime,
		machineDuration,
		machineQuality
	} from '$lib/stores/playerDerived';
	import { playbackFacade } from '$lib/controllers/playbackFacade';
	import { Play, Pause, ExternalLink } from 'lucide-svelte';
	import { APP_VERSION } from '$lib/version';
	import { isSonglinkTrack } from '$lib/types';
	import StateNotice from '$lib/components/ui/StateNotice.svelte';

	let playlist = $state<Playlist | null>(null);
    let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeRequestToken = 0;

	const playlistId = $derived($page.params.id);
    // Check if current playing track is from this playlist
    const isPlaying = $derived($machineIsPlaying && tracks.some(t => t.id === $machineCurrentTrack?.id));
    const isCurrentContext = $derived(tracks.some(t => t.id === $machineCurrentTrack?.id));
    const progress = $derived(
        isCurrentContext
            ? ($machineCurrentTime / ($machineDuration || 1)) * 100 
            : 0
    );

	onMount(async () => {
		try {
            const referrer = document.referrer;
            const host = referrer ? new URL(referrer).hostname : 'direct';
            umami?.track('embed_loaded', { host, type: 'playlist' });
        } catch {
			// Ignore umami tracking errors
		}
	});

	$effect(() => {
		const normalizedPlaylistId = (playlistId ?? '').trim();
		if (!normalizedPlaylistId) {
			playlist = null;
			tracks = [];
			error = 'Invalid playlist id';
			isLoading = false;
			return;
		}
		const requestToken = ++activeRequestToken;
		void loadPlaylist(normalizedPlaylistId, requestToken);
	});

	async function loadPlaylist(id: string, requestToken: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getPlaylist(id);
			if (requestToken !== activeRequestToken) {
				return;
			}
			playlist = data.playlist;
            tracks = data.items.map((item) => item.item);
		} catch (err) {
			if (requestToken === activeRequestToken) {
				error = err instanceof Error ? err.message : 'Failed to load playlist';
			}
			if (requestToken === activeRequestToken && typeof window !== 'undefined' && umami) {
				try {
					const referrer = document.referrer;
					const host = referrer ? new URL(referrer).hostname : 'direct';
					umami.track('embed_error', { 
						host, 
						error, 
						version: APP_VERSION,
						type: 'playlist',
						page: window.location.href,
						id
					});
				} catch {
					// Ignore umami tracking errors
				}
			}
		} finally {
			if (requestToken === activeRequestToken) {
				isLoading = false;
			}
		}
	}

    function togglePlay() {
        if (!playlist || tracks.length === 0) return;
        
        if (isPlaying) {
            playbackFacade.pause();
        } else {
            // If not playing this playlist, start from beginning
            if (!tracks.some(t => t.id === $machineCurrentTrack?.id)) {
                playbackFacade.loadQueue(tracks, 0, { autoPlay: true });
            } else {
                playbackFacade.play();
            }
        }
    }

    function playTrack(track: Track, index: number) {
        playbackFacade.loadQueue(tracks, index, { autoPlay: true });
    }
</script>

<div class="embed-card" data-ui-archetype="embed" data-ui-route="embed-playlist">
    {#if isLoading}
        <div class="loading">
            <StateNotice
                tone="info"
                title="Loading playlist"
                message="Fetching playlist details and tracks for this embed."
                busy={true}
                liveRegion="polite"
            />
        </div>
    {:else if error}
        <div class="error">
            <StateNotice
                tone="error"
                title="Playlist unavailable"
                message={error}
                liveRegion="assertive"
            />
        </div>
    {:else if playlist}
        <div class="header" data-ui-block="entity-hero">
            <div class="cover-art">
                {#if playlist.image}
                    <img src={losslessAPI.getCoverUrl(playlist.image, '320')} alt={playlist.title} />
                {:else}
                    <div class="placeholder-cover"></div>
                {/if}
                <button class="play-button" onclick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                    {#if isPlaying}
                        <Pause size={24} fill="currentColor" />
                    {:else}
                        <Play size={24} fill="currentColor" class="ml-1" />
                    {/if}
                </button>
            </div>
            <div class="details" data-ui-block="primary-actions">
                <h1 class="title" title={playlist.title}>{playlist.title}</h1>
                <p class="subtitle" title={playlist.description}>{playlist.description || 'Playlist'}</p>
                <a
                    href="/playlist/{playlist.uuid}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="open-link"
                    aria-label="Open playlist in BiniLossless in a new tab"
                >
                    <span>Open Playlist in BiniLossless (opens in a new tab)</span>
                    <ExternalLink size={12} />
                </a>
            </div>
        </div>

        <div class="track-list" data-ui-block="main-sections">
            {#each tracks as track, i (track.id)}
                <button class="track-item" onclick={() => playTrack(track, i)} class:active={$machineCurrentTrack?.id === track.id}>
                    <span class="track-number">{i + 1}</span>
                    <div class="track-meta">
                        <span class="track-title">{track.title}</span>
                        <span class="track-duration">{losslessAPI.formatDuration(track.duration)}</span>
                    </div>
                </button>
            {/each}
        </div>
        
        <!-- Background blur -->
        {#if playlist.image}
            <div class="background" style="background-image: url({losslessAPI.getCoverUrl(playlist.image, '320')})"></div>
        {:else}
            <div class="background" style="background-color: #161616"></div>
        {/if}
        
        <!-- Progress Bar -->
        {#if isCurrentContext}
            <div class="progress-container">
                <div class="progress-bar" style="width: {progress}%"></div>
            </div>
        {/if}

        {#if $machineCurrentTrack && !isSonglinkTrack($machineCurrentTrack) && $machineCurrentTrack.album}
            <div class="now-playing-bar">
                <img
                    src={losslessAPI.getCoverUrl($machineCurrentTrack.album.cover, '80')}
                    alt={$machineCurrentTrack.title}
                    class="np-cover"
                />
                <div class="np-info">
                    <div class="np-title">{$machineCurrentTrack.title}</div>
                    <div class="np-meta">
                        <span class="np-quality">
                            {$machineQuality === 'HI_RES_LOSSLESS' ? 'Hi-Res' : 
                             $machineQuality === 'LOSSLESS' ? 'CD' : $machineQuality}
                        </span>
                    </div>
                </div>
				<button
					class="np-play-button"
					onclick={() => playbackFacade.toggle()}
					aria-label={$machineIsPlaying ? 'Pause now playing' : 'Play now playing'}
				>
                    {#if $machineIsPlaying}
                        <Pause size={20} fill="currentColor" />
                    {:else}
                        <Play size={20} fill="currentColor" />
                    {/if}
                </button>
            </div>
        {/if}
    {/if}
</div>

<style>
    :global(html), :global(body) {
        margin: 0;
        min-height: 100%;
        overflow: auto;
        background: transparent;
    }

    .embed-card {
        position: relative;
        width: 100%;
        min-height: 100dvh;
        height: 100%;
        overflow: auto;
        display: flex;
        flex-direction: column;
        color: white;
        font-family: var(--ui-font-sans, 'Figtree', system-ui, -apple-system, sans-serif);
        background: #090909;
    }

    .background {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        opacity: 0.16;
        z-index: -1;
    }

    .progress-container {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: rgba(255, 255, 255, 0.1);
        z-index: 10;
    }

    .progress-bar {
        height: 100%;
        background: rgba(255, 255, 255, 0.92);
        transition: width var(--ui-motion-fast, 140ms) linear;
    }

    .loading, .error {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100dvh;
        padding: 1rem;
    }

    .header {
        display: flex;
        align-items: center;
        padding: 1rem;
        gap: 1rem;
        flex-shrink: 0;
        background: rgba(8, 8, 8, 0.74);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .cover-art {
        position: relative;
        width: 64px;
        height: 64px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.12);
        flex-shrink: 0;
        background: #1b1b1b;
    }

    .cover-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .placeholder-cover {
        width: 100%;
        height: 100%;
        background: rgba(255, 255, 255, 0.08);
    }

    .play-button {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.42);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        opacity: 1;
        transition: background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
        border: none;
        cursor: pointer;
    }

    .play-button:hover {
        background: rgba(0, 0, 0, 0.62);
    }

    .details {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .title {
        font-size: 1rem;
        font-weight: 700;
        margin: 0 0 0.25rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtitle {
        font-size: 0.875rem;
        color: rgba(255,255,255,0.8);
        margin: 0 0 0.5rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .open-link {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        color: rgba(255,255,255,0.6);
        text-decoration: none;
        transition: color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    .open-link:hover {
        color: white;
    }

    .play-button:focus-visible,
    .open-link:focus-visible,
    .track-item:focus-visible,
    .np-play-button:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.92);
        outline-offset: 2px;
    }

    .track-list {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem 0;
        background: rgba(8, 8, 8, 0.64);
    }

    .track-item {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 0.5rem 1rem;
        gap: 0.75rem;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        text-align: left;
        transition:
            background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
            color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    .track-item:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
    }

    .track-item.active {
        color: #fff;
        background: rgba(255, 255, 255, 0.16);
    }

    .track-number {
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.5);
        width: 1.5rem;
        text-align: center;
    }

    .track-meta {
        flex: 1;
        min-width: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }

    .track-title {
        font-size: 0.875rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-duration {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .now-playing-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(8, 8, 8, 0.96);
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        padding: 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        z-index: 50;
    }

    .np-cover {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.25rem;
        object-fit: cover;
    }

    .np-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .np-title {
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: white;
    }

    .np-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .np-quality {
        font-size: 0.65rem;
        font-weight: 700;
        color: rgba(232, 232, 232, 0.92);
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.16);
        padding: 0.1rem 0.3rem;
        border-radius: 0.2rem;
    }

    .np-play-button {
        background: rgba(255, 255, 255, 0.95);
        color: #0b0b0b;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        width: 2.5rem;
        height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
    }

    .np-play-button:hover {
        transform: scale(1.05);
    }
    
    .track-list {
        padding-bottom: 4.5rem;
    }

	@media (prefers-reduced-motion: reduce) {
		.embed-card,
		.embed-card *,
		.progress-bar {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
