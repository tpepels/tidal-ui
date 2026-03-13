<script lang="ts">
	import { Search, Square } from 'lucide-svelte';
	import type { SearchTab } from '$lib/stores/searchStoreAdapter';
	import { getPlatformName } from '$lib/utils/songlink';

	type UiTone = 'default' | 'secondary' | 'tertiary';

	type SearchScopeOption = {
		tab: SearchTab;
		label: string;
		tone: UiTone;
	};

	interface Props {
		query: string;
		isLoading: boolean;
		isActiveTabLoading: boolean;
		isQueryATidalUrl: boolean;
		isQueryASpotifyPlaylist: boolean;
		isQueryAStreamingUrl: boolean;
		isQueryAUrl: boolean;
		selectedSearchScopes: SearchTab[];
		searchScopeOptions: SearchScopeOption[];
		albumArtistFilter: string;
		strictAlbumArtistMatch: boolean;
		onSubmit: () => void;
		onQueryInput: (value: string) => void;
		onToggleScope: (scope: SearchTab) => void;
		onAlbumArtistFilterInput: (value: string) => void;
		onStrictAlbumArtistMatchChange: (strict: boolean) => void;
	}

	let {
		query,
		isLoading,
		isActiveTabLoading,
		isQueryATidalUrl,
		isQueryASpotifyPlaylist,
		isQueryAStreamingUrl,
		isQueryAUrl,
		selectedSearchScopes,
		searchScopeOptions,
		albumArtistFilter,
		strictAlbumArtistMatch,
		onSubmit,
		onQueryInput,
		onToggleScope,
		onAlbumArtistFilterInput,
		onStrictAlbumArtistMatchChange
	}: Props = $props();

	function toneAttribute(tone: UiTone): Exclude<UiTone, 'default'> | undefined {
		return tone === 'default' ? undefined : tone;
	}

	function isScopeSelected(scope: SearchTab): boolean {
		return selectedSearchScopes.includes(scope);
	}

	const isSearchInProgress = $derived(isLoading || isActiveTabLoading);
</script>

<section class="ui-tool-panel search-panel" data-tone="secondary" aria-label="Catalog search">
	<p class="search-panel__label">Search</p>
	<form
		class="search-panel__form"
		onsubmit={(event) => {
			event.preventDefault();
			onSubmit();
		}}
	>
		<div class="search-panel__row">
			<input
				id="catalog-search-input"
				type="text"
				value={query}
				oninput={(event) => {
					const target = event.currentTarget as HTMLInputElement | null;
					if (target) {
						onQueryInput(target.value);
					}
				}}
				placeholder={isQueryATidalUrl
					? 'TIDAL URL detected'
					: isQueryASpotifyPlaylist
						? 'Spotify playlist detected'
						: isQueryAStreamingUrl
							? `${getPlatformName(query)} URL detected`
							: 'Album, song, artist, or URL'}
				class="search-panel__input"
			/>
			<button
				type="submit"
				class="ui-action-button ui-action-button--primary search-panel__submit"
				disabled={!query.trim() && !isSearchInProgress}
				aria-busy={isSearchInProgress}
			>
				{#if isSearchInProgress}
					<Square size={16} />
					Stop
				{:else}
					<Search size={16} />
					Search
				{/if}
			</button>
		</div>

		{#if !isQueryAUrl}
			<div class="search-panel__scope" role="group" aria-label="Search sections">
				{#each searchScopeOptions as option (option.tab)}
					<button
						type="button"
						class={`ui-filter-chip search-scope-chip ${isScopeSelected(option.tab) ? 'is-active is-selected' : ''}`}
						data-tone={toneAttribute(option.tone)}
						aria-pressed={isScopeSelected(option.tab)}
						onclick={() => onToggleScope(option.tab)}
					>
						{option.label}
					</button>
				{/each}
			</div>
		{/if}

		{#if !isQueryAUrl && isScopeSelected('albums')}
			<div class="search-panel__row search-panel__row--secondary">
				<div class="search-panel__field">
					<label class="search-panel__field-label" for="album-artist-filter">
						Album Artist Filter
						<span>Album search only</span>
					</label>
					<input
						id="album-artist-filter"
						type="text"
						value={albumArtistFilter}
						oninput={(event) => {
							const target = event.currentTarget as HTMLInputElement | null;
							if (target) {
								onAlbumArtistFilterInput(target.value);
							}
						}}
						placeholder="Artist name or wildcard (*, ?)"
						class="search-panel__input"
					/>
					<p class="search-panel__field-hint">
						Applies only to album results. Artist/track/playlist results stay unfiltered.
					</p>
				</div>
				<label class="search-panel__strict">
					<input
						type="checkbox"
						checked={strictAlbumArtistMatch}
						onchange={(event) => {
							const target = event.currentTarget as HTMLInputElement | null;
							if (target) {
								onStrictAlbumArtistMatchChange(target.checked);
							}
						}}
						disabled={!albumArtistFilter.trim()}
					/>
					<span>Strict album artist match</span>
				</label>
			</div>
		{/if}
	</form>
</section>

<style>
	.search-panel {
		gap: 0.6rem;
	}

	.search-panel__form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
	}

	.search-panel__label {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: rgba(214, 214, 214, 0.72);
	}

	.search-panel__row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.search-panel__row--secondary {
		align-items: stretch;
	}

	.search-panel__field {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.34rem;
	}

	.search-panel__field-label {
		display: inline-flex;
		align-items: baseline;
		gap: 0.42rem;
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(232, 232, 232, 0.88);
	}

	.search-panel__field-label span {
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: none;
		color: rgba(186, 186, 186, 0.8);
	}

	.search-panel__field-hint {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.3;
		color: rgba(186, 186, 186, 0.8);
	}

	.search-panel__input {
		width: 100%;
		min-width: 0;
		min-height: 2.7rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--ui-surface-0, #0d0d0d);
		padding: 0.58rem 0.75rem;
		font-size: 1rem;
		color: rgba(245, 245, 245, 0.96);
		outline: none;
	}

	.search-panel__input:focus-visible {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
	}

	.search-panel__submit {
		flex-shrink: 0;
		min-width: 8.2rem;
	}

	.search-panel__strict {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		border-radius: var(--ui-radius-sm, 9px);
		background: var(--ui-surface-0, #0d0d0d);
		font-size: 0.88rem;
		color: rgba(212, 212, 212, 0.86);
		white-space: nowrap;
	}

	.search-panel__strict input[type='checkbox'] {
		accent-color: #f2f2f2;
	}

	.search-panel__strict input[type='checkbox']:disabled {
		opacity: 0.5;
	}

	.search-panel__scope {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.search-scope-chip {
		min-height: 2.1rem;
		padding: 0.42rem 0.76rem;
		border-radius: 999px;
		font-size: 0.86rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.search-scope-chip:not(.is-selected):not([data-tone]) {
		border-color: rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.035);
		color: rgba(202, 202, 202, 0.82);
	}

	.search-scope-chip.is-selected:not([data-tone]) {
		border-color: rgba(255, 255, 255, 0.74);
		background: rgba(248, 248, 248, 0.98);
		color: #0a0a0a;
		box-shadow: inset 0 0 0 1px rgba(10, 10, 10, 0.08);
	}

	.search-scope-chip.is-selected:not([data-tone]):hover {
		border-color: rgba(255, 255, 255, 0.9);
		background: #ffffff;
		color: #040404;
	}

	@media (max-width: 780px) {
		.search-panel__row--secondary {
			flex-direction: column;
		}

		.search-panel__strict {
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 640px) {
		.search-panel__row {
			flex-direction: column;
			align-items: stretch;
		}

		.search-panel__submit {
			width: 100%;
		}
	}
</style>
