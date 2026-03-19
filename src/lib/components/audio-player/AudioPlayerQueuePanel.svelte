<script lang="ts">
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { formatArtists } from '$lib/utils/formatters';
	import type { PlayableTrack, Track } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import { ListMusic, Shuffle, Trash2, X } from 'lucide-svelte';

	const {
		queue = [],
		queueIndex = -1,
		onPlayFromQueue = () => {},
		onRemoveFromQueue = () => {},
		onShuffleQueue = () => {},
		onClearQueue = () => {},
		onClose = () => {}
	} = $props<{
		queue: PlayableTrack[];
		queueIndex: number;
		onPlayFromQueue: (index: number) => void;
		onRemoveFromQueue: (index: number, event?: MouseEvent) => void;
		onShuffleQueue: () => void;
		onClearQueue: () => void | Promise<void>;
		onClose: () => void;
	}>();

	function asTrack(track: PlayableTrack): Track {
		return track as Track;
	}
</script>

<div
	class="queue-panel mt-4 space-y-3 rounded-2xl border p-4 text-sm shadow-inner"
	transition:slide={{ duration: 220, easing: cubicOut }}
>
	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2 text-gray-300">
			<ListMusic size={18} />
			<span class="font-medium">Playback Queue</span>
			<span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
				{queue.length}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<button
				onclick={onShuffleQueue}
				class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-white/35 hover:text-white disabled:opacity-40"
				type="button"
				disabled={queue.length <= 1}
				aria-label="Shuffle queue"
			>
				<Shuffle size={14} />
				Shuffle Queue
			</button>
			<button
				onclick={onClearQueue}
				class="flex items-center gap-1 rounded-full border border-transparent px-3 py-1 text-xs tracking-wide text-gray-400 uppercase transition-colors hover:border-red-500 hover:text-red-400"
				type="button"
				disabled={queue.length === 0}
				aria-label="Clear queue"
			>
				<Trash2 size={14} />
				Clear Queue
			</button>
			<button
				type="button"
				onclick={onClose}
				class="rounded-full p-1 text-gray-400 transition-colors hover:text-white"
				aria-label="Close queue panel"
			>
				<X size={16} />
			</button>
		</div>
	</div>

	{#if queue.length > 0}
		<ul class="max-h-60 space-y-2 overflow-y-auto pr-1">
			{#each queue as queuedTrack, index (queuedTrack.id)}
				<li>
					<div
						class="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors {index === queueIndex ? 'bg-white/10 text-white' : 'text-gray-200 hover:bg-gray-800/70'}"
					>
						<span class="w-6 text-xs font-semibold text-gray-500 group-hover:text-gray-300">
							{index + 1}
						</span>
						<div class="min-w-0 flex-1">
							<button
								type="button"
								class="audio-player-queue-panel__track-button truncate text-left text-sm font-medium"
								onclick={() => onPlayFromQueue(index)}
								aria-label={`Play ${queuedTrack.title} from queue`}
							>
								{queuedTrack.title}{!isSonglinkTrack(queuedTrack) && asTrack(queuedTrack).version
									? ` (${asTrack(queuedTrack).version})`
									: ''}
							</button>
							{#if isSonglinkTrack(queuedTrack)}
								<p class="truncate text-xs text-gray-400">{queuedTrack.artistName}</p>
							{:else}
								<a
									href={`/artist/${asTrack(queuedTrack).artist.id}`}
									onclick={(event) => event.stopPropagation()}
									class="truncate text-xs text-gray-400 hover:text-white hover:underline inline-block"
									data-sveltekit-preload-data
								>
									{formatArtists(asTrack(queuedTrack).artists)}
								</a>
							{/if}
						</div>
						<button
							type="button"
							onclick={(event) => onRemoveFromQueue(index, event)}
							class="rounded-full p-1 text-gray-500 transition-colors hover:text-red-400"
							aria-label={`Remove ${queuedTrack.title} from queue`}
						>
							<X size={14} />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 px-3 py-8 text-center text-gray-400">
			Queue is empty
		</p>
	{/if}
</div>
