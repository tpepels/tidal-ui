<script lang="ts">
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';
	import PageState from '$lib/components/ui/PageState.svelte';
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
	const hasAlbumHistory = $derived($navigationHistoryStore.albums.length > 0);
	const hasArtistHistory = $derived($navigationHistoryStore.artists.length > 0);
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

<section class="ui-page history-page">
	<header class="ui-page__header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Navigation</p>
			<h1 class="ui-page__title">{meta?.title ?? 'History'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Recently visited artists and albums'}</p>
		</div>
		<div class="ui-page__actions">
			<button type="button" class="ui-chip-button" onclick={clearHistory} disabled={!hasHistory}>
				<Trash2 size={14} />
				<span>Clear all history</span>
			</button>
		</div>
	</header>

	<div class="ui-surface-grid history-page__overview">
		<article class="ui-surface-card history-highlight-card">
			<div class="history-highlight-card__heading">
				<Clock3 size={16} />
				<p>Resume last album</p>
			</div>
			{#if latestAlbum}
				<a class="history-highlight-card__link" href={latestAlbum.href}>
					<strong>{latestAlbum.title}</strong>
					<span>{latestAlbum.artistName}</span>
					<span class="history-highlight-card__timestamp">
						{formatVisitedAt(latestAlbum.visitedAt)}
						<ArrowUpRight size={13} />
					</span>
				</a>
			{:else}
				<PageState kind="empty" title="No album history yet" message="Visit albums to populate this shortcut." />
			{/if}
		</article>

		<article class="ui-surface-card history-highlight-card">
			<div class="history-highlight-card__heading">
				<Clock3 size={16} />
				<p>Resume last artist</p>
			</div>
			{#if latestArtist}
				<a class="history-highlight-card__link" href={latestArtist.href}>
					<strong>{latestArtist.name}</strong>
					<span class="history-highlight-card__timestamp">
						{formatVisitedAt(latestArtist.visitedAt)}
						<ArrowUpRight size={13} />
					</span>
				</a>
			{:else}
				<PageState kind="empty" title="No artist history yet" message="Visit artists to populate this shortcut." />
			{/if}
		</article>
	</div>

	<div class="history-page__columns">
		<section class="ui-surface-card history-list-card">
			<div class="history-list-card__header">
				<div class="history-list-card__title">
					<Library size={16} />
					<h2>Albums ({$navigationHistoryStore.albums.length}/25)</h2>
				</div>
				<button
					type="button"
					class="ui-chip-button ui-chip-button--compact"
					onclick={clearAlbumHistory}
					disabled={!hasAlbumHistory}
				>
					Clear albums
				</button>
			</div>

			{#if !hasAlbumHistory}
				<PageState kind="empty" title="No album visits yet" message="Visited albums will appear here." />
			{:else}
				<ol class="history-card-grid">
					{#each $navigationHistoryStore.albums as entry, index (entry.id)}
						<li>
							<a class="history-entry-card" href={entry.href}>
								<span class="history-entry-card__index">#{index + 1}</span>
								<span class="history-entry-card__body">
									<span class="history-entry-card__title">{entry.title}</span>
									<span class="history-entry-card__meta">{entry.artistName}</span>
									<span class="history-entry-card__timestamp">{formatVisitedAt(entry.visitedAt)}</span>
								</span>
								<ArrowUpRight size={14} />
							</a>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section class="ui-surface-card history-list-card">
			<div class="history-list-card__header">
				<div class="history-list-card__title">
					<User size={16} />
					<h2>Artists ({$navigationHistoryStore.artists.length}/10)</h2>
				</div>
				<button
					type="button"
					class="ui-chip-button ui-chip-button--compact"
					onclick={clearArtistHistory}
					disabled={!hasArtistHistory}
				>
					Clear artists
				</button>
			</div>

			{#if !hasArtistHistory}
				<PageState kind="empty" title="No artist visits yet" message="Visited artists will appear here." />
			{:else}
				<ol class="history-card-grid">
					{#each $navigationHistoryStore.artists as entry, index (entry.id)}
						<li>
							<a class="history-entry-card" href={entry.href}>
								<span class="history-entry-card__index">#{index + 1}</span>
								<span class="history-entry-card__body">
									<span class="history-entry-card__title">{entry.name}</span>
									<span class="history-entry-card__timestamp">{formatVisitedAt(entry.visitedAt)}</span>
								</span>
								<ArrowUpRight size={14} />
							</a>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	</div>
</section>

<style>
	.history-page {
		gap: 0.95rem;
	}

	.history-page__overview {
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	}

	.history-highlight-card {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.history-highlight-card__heading {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: rgba(212, 212, 212, 0.85);
	}

	.history-highlight-card__heading p {
		margin: 0;
	}

	.history-highlight-card__link {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.58rem 0.66rem;
		border-radius: 10px;
		border: 1px solid rgba(212, 212, 212, 0.2);
		background: rgba(255, 255, 255, 0.03);
		color: inherit;
		text-decoration: none;
		transition: border-color 140ms ease, background 140ms ease;
	}

	.history-highlight-card__link strong {
		font-size: 0.9rem;
		line-height: 1.28;
	}

	.history-highlight-card__link span {
		font-size: 0.72rem;
		color: rgba(212, 212, 212, 0.78);
	}

	.history-highlight-card__timestamp {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.history-highlight-card__link:hover {
		border-color: rgba(255, 255, 255, 0.45);
		background: rgba(255, 255, 255, 0.08);
	}

	.history-page__columns {
		display: grid;
		gap: 0.85rem;
	}

	.history-list-card {
		display: flex;
		flex-direction: column;
		gap: 0.62rem;
	}

	.history-list-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
	}

	.history-list-card__title {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.history-list-card__title h2 {
		margin: 0;
		font-size: 0.92rem;
	}

	.history-card-grid {
		list-style: none;
		display: grid;
		gap: 0.52rem;
		padding: 0;
		margin: 0;
	}

	.history-entry-card {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.62rem;
		padding: 0.56rem 0.66rem;
		border-radius: 10px;
		border: 1px solid rgba(212, 212, 212, 0.2);
		background: rgba(255, 255, 255, 0.03);
		color: inherit;
		text-decoration: none;
		transition: border-color 140ms ease, background 140ms ease;
	}

	.history-entry-card:hover {
		border-color: rgba(255, 255, 255, 0.45);
		background: rgba(255, 255, 255, 0.08);
	}

	.history-entry-card__index {
		display: inline-flex;
		min-width: 2.2rem;
		justify-content: center;
		padding: 0.18rem 0.36rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		border: 1px solid rgba(212, 212, 212, 0.28);
		background: rgba(0, 0, 0, 0.35);
		color: rgba(212, 212, 212, 0.85);
	}

	.history-entry-card__body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.history-entry-card__title {
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.26;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-entry-card__meta,
	.history-entry-card__timestamp {
		font-size: 0.68rem;
		color: rgba(212, 212, 212, 0.74);
	}

	@media (min-width: 960px) {
		.history-page__columns {
			grid-template-columns: repeat(2, minmax(260px, 1fr));
		}
	}
</style>
