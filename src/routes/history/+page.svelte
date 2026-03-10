<script lang="ts">
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';
	import { Library, User, Trash2, Clock3, ArrowUpRight } from 'lucide-svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';

	const meta = getRouteMeta('/history');

	const formatVisitedAt = (value: number): string => {
		if (!Number.isFinite(value)) return 'Unknown time';
		return new Date(value).toLocaleString();
	};

	const hasHistory = $derived(
		$navigationHistoryStore.albums.length > 0 || $navigationHistoryStore.artists.length > 0
	);

	const latestAlbum = $derived($navigationHistoryStore.albums[0] ?? null);
	const latestArtist = $derived($navigationHistoryStore.artists[0] ?? null);

	function clearHistory(): void {
		navigationHistoryStore.clear();
	}

	function clearAlbumHistory(): void {
		navigationHistoryStore.clearAlbums();
	}

	function clearArtistHistory(): void {
		navigationHistoryStore.clearArtists();
	}
</script>

<svelte:head>
	<title>{meta?.title ?? 'History'} | BiniLossless</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
	<div class="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
		<div>
			<p class="text-xs uppercase tracking-[0.2em] text-slate-400">Navigation</p>
			<h1 class="text-3xl font-bold text-slate-100 md:text-4xl">{meta?.title ?? 'History'}</h1>
			<p class="mt-2 text-sm text-slate-300">Last 25 visited albums and last 10 visited artists.</p>
		</div>
		<button
			type="button"
			class="inline-flex items-center gap-2 self-start rounded-lg border border-slate-600/60 bg-slate-900/50 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={clearHistory}
			disabled={!hasHistory}
		>
			<Trash2 size={16} />
			<span>Clear all history</span>
		</button>
	</div>

	<section class="mb-4 grid gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/45 p-4 lg:grid-cols-2">
		<div class="flex items-start gap-3">
			<Clock3 size={16} class="mt-0.5 text-slate-300" />
			<div>
				<p class="text-xs uppercase tracking-[0.18em] text-slate-400">Resume</p>
				{#if latestAlbum}
					<a class="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-100 hover:text-white" href={latestAlbum.href}>
						<span>Last album: {latestAlbum.title}</span>
						<ArrowUpRight size={14} />
					</a>
				{:else}
					<p class="mt-1 text-sm text-slate-400">No recent album.</p>
				{/if}
			</div>
		</div>
		<div class="flex items-start gap-3">
			<Clock3 size={16} class="mt-0.5 text-slate-300" />
			<div>
				<p class="text-xs uppercase tracking-[0.18em] text-slate-400">Resume</p>
				{#if latestArtist}
					<a class="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-100 hover:text-white" href={latestArtist.href}>
						<span>Last artist: {latestArtist.name}</span>
						<ArrowUpRight size={14} />
					</a>
				{:else}
					<p class="mt-1 text-sm text-slate-400">No recent artist.</p>
				{/if}
			</div>
		</div>
	</section>

	<div class="grid gap-4 lg:grid-cols-2">
		<section class="rounded-2xl border border-slate-700/60 bg-slate-900/45 p-4">
			<div class="mb-3 flex items-center justify-between gap-2 text-slate-100">
				<div class="flex items-center gap-2">
					<Library size={16} />
					<h2 class="text-lg font-semibold">Albums ({$navigationHistoryStore.albums.length}/25)</h2>
				</div>
				<button
					type="button"
					class="rounded-md border border-slate-600/60 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-slate-400 hover:bg-slate-800/60 disabled:opacity-50"
					onclick={clearAlbumHistory}
					disabled={$navigationHistoryStore.albums.length === 0}
				>
					Clear albums
				</button>
			</div>
			{#if $navigationHistoryStore.albums.length === 0}
				<p class="text-sm text-slate-400">No album visits yet.</p>
			{:else}
				<ul class="space-y-2">
					{#each $navigationHistoryStore.albums as entry (entry.id)}
						<li class="rounded-lg border border-slate-700/50 bg-slate-950/40 px-3 py-2">
							<a class="block text-sm font-semibold text-slate-100 hover:text-white" href={entry.href}>
								{entry.title}
							</a>
							<p class="text-xs text-slate-400">{entry.artistName}</p>
							<p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
								{formatVisitedAt(entry.visitedAt)}
							</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="rounded-2xl border border-slate-700/60 bg-slate-900/45 p-4">
			<div class="mb-3 flex items-center justify-between gap-2 text-slate-100">
				<div class="flex items-center gap-2">
					<User size={16} />
					<h2 class="text-lg font-semibold">Artists ({$navigationHistoryStore.artists.length}/10)</h2>
				</div>
				<button
					type="button"
					class="rounded-md border border-slate-600/60 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-slate-400 hover:bg-slate-800/60 disabled:opacity-50"
					onclick={clearArtistHistory}
					disabled={$navigationHistoryStore.artists.length === 0}
				>
					Clear artists
				</button>
			</div>
			{#if $navigationHistoryStore.artists.length === 0}
				<p class="text-sm text-slate-400">No artist visits yet.</p>
			{:else}
				<ul class="space-y-2">
					{#each $navigationHistoryStore.artists as entry (entry.id)}
						<li class="rounded-lg border border-slate-700/50 bg-slate-950/40 px-3 py-2">
							<a class="block text-sm font-semibold text-slate-100 hover:text-white" href={entry.href}>
								{entry.name}
							</a>
							<p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
								{formatVisitedAt(entry.visitedAt)}
							</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
