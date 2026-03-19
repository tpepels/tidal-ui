<script lang="ts">
	import { Search, Square } from 'lucide-svelte';
	import type { SearchTab } from '$lib/stores/searchStoreAdapter';
	import { getPlatformName } from '$lib/utils/songlink';
	import {
		isSearchSubmitDisabled,
		resolveSearchSubmitLabel,
		resolveSearchSubmitMode
	} from '$lib/features/search/searchSubmitController';

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
	const searchSubmitMode = $derived(resolveSearchSubmitMode(query, isSearchInProgress));
	const searchSubmitLabel = $derived(resolveSearchSubmitLabel(searchSubmitMode));
	const searchSubmitDisabled = $derived(isSearchSubmitDisabled(query, isSearchInProgress));
</script>

<section class="search-panel" aria-label="Catalog search">
	<form
		class="search-panel__form"
		onsubmit={(event) => {
			event.preventDefault();
			onSubmit();
		}}
	>
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
			class="search-panel__input search-panel__input--query"
		/>

		{#if !isQueryAUrl && isScopeSelected('albums')}
			<div class="search-panel__field search-panel__field--secondary">
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
		{/if}

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
		{/if}

		<button
			type="submit"
			class="ui-action-button ui-action-button--primary search-panel__submit"
			disabled={searchSubmitDisabled}
			aria-busy={isSearchInProgress}
		>
			{#if searchSubmitMode === 'search'}
				<Search size={16} />
			{:else}
				<Square size={16} />
			{/if}
			{searchSubmitLabel}
		</button>
	</form>
</section>

<style>
	.search-panel {
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
		padding: 0.15rem 0 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.search-panel__form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'query submit'
			'secondary strict'
			'scope scope';
		gap: 0.75rem 0.65rem;
		align-items: start;
		margin: 0;
	}

	.search-panel__field {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.34rem;
	}

	.search-panel__field--secondary {
		grid-area: secondary;
	}

	.search-panel__field-label {
		display: inline-flex;
		align-items: baseline;
		gap: 0.42rem;
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(212, 212, 212, 0.8);
	}

	.search-panel__field-label span {
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		text-transform: none;
		color: rgba(186, 186, 186, 0.78);
	}

	.search-panel__field-hint {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.45;
		color: rgba(190, 190, 190, 0.8);
	}

	.search-panel__input {
		width: 100%;
		min-width: 0;
		min-height: 3.2rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.035);
		padding: 0.78rem 0.92rem;
		font-size: 1rem;
		line-height: 1.35;
		color: rgba(245, 245, 245, 0.96);
		outline: none;
	}

	.search-panel__input:focus-visible {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.22));
		background: rgba(255, 255, 255, 0.05);
	}

	.search-panel__input--query {
		grid-area: query;
	}

	.search-panel__submit {
		grid-area: submit;
		flex-shrink: 0;
		min-width: 8.4rem;
		min-height: 3.2rem;
	}

	.search-panel__strict {
		grid-area: strict;
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		min-height: 3.2rem;
		padding: 0.78rem 0.95rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.03);
		font-size: 0.94rem;
		color: rgba(222, 222, 222, 0.88);
		white-space: nowrap;
	}

	.search-panel__strict input[type='checkbox'] {
		accent-color: #f2f2f2;
	}

	.search-panel__strict input[type='checkbox']:disabled {
		opacity: 0.5;
	}

	.search-panel__scope {
		grid-area: scope;
		display: flex;
		flex-wrap: wrap;
		gap: 0.58rem;
	}

	.search-scope-chip {
		min-height: 2.85rem;
		padding: 0.54rem 0.92rem;
		border-radius: 999px;
		font-size: 0.92rem;
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
		.search-panel__strict {
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 640px) {
		.search-panel__form {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'query'
				'secondary'
				'scope'
				'strict'
				'submit';
		}

		.search-panel__submit {
			width: 100%;
		}

		.search-panel__strict {
			white-space: normal;
		}

		.search-panel__scope {
			overflow-x: auto;
			padding-bottom: 0.1rem;
		}
	}
</style>
