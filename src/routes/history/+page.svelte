<script lang="ts">
	import { navigationHistoryStore } from '$lib/stores/navigationHistory';
	import PageState from '$lib/components/ui/PageState.svelte';
	import EntityMediaCard from '$lib/components/ui/EntityMediaCard.svelte';
	import { Library, User, Trash2, Clock3 } from 'lucide-svelte';
	import { getRouteMeta } from '$lib/config/routeMeta';
	import { losslessAPI } from '$lib/api';

	const meta = getRouteMeta('/history');

	const formatVisitedAt = (value: number): string => {
		if (!Number.isFinite(value)) return 'Unknown time';
		return new Date(value).toLocaleString();
	};

	const getAlbumCoverSrc = (cover: string | null | undefined): string | null => {
		if (typeof cover !== 'string' || cover.trim().length === 0) {
			return null;
		}
		const src = losslessAPI.getCoverUrl(cover, '640');
		return src || null;
	};

	const getArtistPortraitSrc = (picture: string | null | undefined): string | null => {
		if (typeof picture !== 'string' || picture.trim().length === 0) {
			return null;
		}
		const src = losslessAPI.getArtistPictureUrl(picture);
		return src || null;
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

<section class="ui-page history-page" data-ui-archetype="collection" data-ui-route="history">
	<header class="ui-page__header" data-ui-block="page-header">
		<div class="ui-page__title-group">
			<p class="ui-page__eyebrow">Navigation</p>
			<h1 class="ui-page__title">{meta?.title ?? 'History'}</h1>
			<p class="ui-page__subtitle">{meta?.subtitle ?? 'Recently visited artists and albums'}</p>
		</div>
		<div class="ui-page__actions" data-ui-block="filters-actions">
			<button type="button" class="ui-chip-button" onclick={clearHistory} disabled={!hasHistory}>
				<Trash2 size={14} />
				<span>Clear all history</span>
			</button>
		</div>
	</header>

	<div class="ui-surface-grid history-page__overview" data-ui-block="results">
		<article class="ui-surface-card history-overview-card" data-tone="secondary">
			<div class="history-overview-card__heading">
				<Clock3 size={16} />
				<p>Resume last album</p>
			</div>
			{#if latestAlbum}
				{@const latestAlbumCoverSrc = getAlbumCoverSrc(latestAlbum.cover)}
				<EntityMediaCard
					type="album"
					href={latestAlbum.href}
					title={latestAlbum.title}
					subtitle={latestAlbum.artistName}
					meta={formatVisitedAt(latestAlbum.visitedAt)}
					imageSrc={latestAlbumCoverSrc}
					imageAlt={`Cover for ${latestAlbum.title}`}
					class="history-overview-entity"
					links={[{ href: latestAlbum.href, label: 'Open Album' }]}
				/>
			{:else}
				<PageState
					kind="empty"
					title="No album history yet"
					message="Visit albums to populate this shortcut."
				/>
			{/if}
		</article>

		<article class="ui-surface-card history-overview-card" data-tone="tertiary">
			<div class="history-overview-card__heading">
				<Clock3 size={16} />
				<p>Resume last artist</p>
			</div>
			{#if latestArtist}
				{@const latestArtistPortraitSrc = getArtistPortraitSrc(latestArtist.picture)}
				<EntityMediaCard
					type="artist"
					href={latestArtist.href}
					title={latestArtist.name}
					meta={formatVisitedAt(latestArtist.visitedAt)}
					imageSrc={latestArtistPortraitSrc}
					imageAlt={`Portrait of ${latestArtist.name}`}
					class="history-overview-entity"
					links={[{ href: latestArtist.href, label: 'Open Artist' }]}
				/>
			{:else}
				<PageState
					kind="empty"
					title="No artist history yet"
					message="Visit artists to populate this shortcut."
				/>
			{/if}
		</article>
	</div>

	<div class="history-page__columns" data-ui-block="results">
		<section class="ui-surface-card history-list-card" data-tone="secondary">
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
				<ol class="history-media-grid ui-media-grid ui-media-grid--albums">
					{#each $navigationHistoryStore.albums as entry, index (entry.id)}
						{@const entryCoverSrc = getAlbumCoverSrc(entry.cover)}
						<li>
							<EntityMediaCard
								type="album"
								href={entry.href}
								title={entry.title}
								subtitle={entry.artistName}
								meta={`#${index + 1}`}
								description={formatVisitedAt(entry.visitedAt)}
								imageSrc={entryCoverSrc}
								imageAlt={`Cover for ${entry.title}`}
								links={[{ href: entry.href, label: 'Album Page' }]}
							/>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section class="ui-surface-card history-list-card" data-tone="tertiary">
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
				<ol class="history-media-grid ui-media-grid ui-media-grid--artists">
					{#each $navigationHistoryStore.artists as entry, index (entry.id)}
						{@const entryPortraitSrc = getArtistPortraitSrc(entry.picture)}
						<li>
							<EntityMediaCard
								type="artist"
								href={entry.href}
								title={entry.name}
								meta={`#${index + 1}`}
								description={formatVisitedAt(entry.visitedAt)}
								imageSrc={entryPortraitSrc}
								imageAlt={`Portrait of ${entry.name}`}
								links={[{ href: entry.href, label: 'Artist Page' }]}
							/>
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

	.history-overview-card {
		display: flex;
		flex-direction: column;
		gap: 0.72rem;
	}

	.history-overview-card[data-tone='secondary'] .history-overview-card__heading {
		color: var(--ui-tone-secondary-text, rgba(224, 234, 255, 0.96));
	}

	.history-overview-card[data-tone='tertiary'] .history-overview-card__heading {
		color: var(--ui-tone-tertiary-text, rgba(220, 244, 233, 0.96));
	}

	.history-overview-card__heading {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.84rem;
		font-weight: 600;
		color: rgba(212, 212, 212, 0.85);
	}

	.history-overview-card__heading p {
		margin: 0;
	}

	:global(.history-overview-entity) {
		padding: 0.68rem;
		gap: 0.42rem;
	}

	:global(.history-overview-entity .ui-media-card__primary-link) {
		display: grid;
		grid-template-columns: 86px minmax(0, 1fr);
		gap: 0.62rem;
		align-items: center;
	}

	:global(.history-overview-entity .ui-media-card__artwork) {
		width: 86px;
		height: 86px;
		aspect-ratio: 1 / 1;
		margin: 0;
	}

	:global(.history-overview-entity .ui-media-card__body) {
		gap: 0.16rem;
	}

	:global(.history-overview-entity .ui-media-card__title) {
		font-size: 0.98rem;
	}

	:global(.history-overview-entity .ui-media-card__meta) {
		font-size: 0.8rem;
		line-height: 1.3;
	}

	:global(.history-overview-entity .ui-media-card__links) {
		margin-top: 0.2rem;
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

	.history-list-card[data-tone='secondary'] .history-list-card__title {
		color: var(--ui-tone-secondary-text, rgba(224, 234, 255, 0.96));
	}

	.history-list-card[data-tone='tertiary'] .history-list-card__title {
		color: var(--ui-tone-tertiary-text, rgba(220, 244, 233, 0.96));
	}

	.history-list-card__title h2 {
		margin: 0;
		font-size: 1.02rem;
	}

	.history-media-grid {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.history-media-grid li {
		min-width: 0;
	}

	@media (min-width: 960px) {
		.history-page__columns {
			grid-template-columns: repeat(2, minmax(260px, 1fr));
		}
	}
</style>
