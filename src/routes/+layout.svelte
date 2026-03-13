<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import LyricsPopup from '$lib/components/LyricsPopup.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import Breadcrumb from '$lib/components/Breadcrumb.svelte';
	import { breadcrumbStore } from '$lib/stores/breadcrumbStore';
	import { machineCurrentTrack, machineIsPlaying, machineQueue } from '$lib/stores/playerDerived';
	import { queueStats, serverQueue, workerStatus } from '$lib/stores/serverQueue.svelte';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { effectivePerformanceLevel } from '$lib/stores/performance';
	import { formatArtists } from '$lib/utils/formatters';
	import { navigating, page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { dev } from '$app/environment';
	import { logger } from '$lib/core/logger';
	import { getSessionId } from '$lib/core/session';
	import {
		Download,
		Settings,
		Search,
		Logs,
		Activity,
		PanelLeft,
		PanelRight,
		Music2,
		History,
		Library
	} from 'lucide-svelte';
	import { isSonglinkTrack } from '$lib/types';
	import { getRouteMeta } from '$lib/config/routeMeta';

	let { children, data } = $props();
	const pageTitle = $derived(data?.title ?? 'BiniLossless');
	let headerHeight = $state(0);
	let playerHeight = $state(0);
	let isPlayerVisible = $state(false);
	let AudioPlayerComponent = $state<typeof import('$lib/components/AudioPlayer.svelte').default | null>(
		null
	);
	let viewportHeight = $state(0);
	let isSidebarCollapsed = $state(false);
	let sidebarNavContainer = $state<HTMLElement | null>(null);

	const isServerStorage = $derived($downloadPreferencesStore.storage === 'server');
	const isEmbed = $derived($page.url.pathname.startsWith('/embed'));

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (isEmbed) return;
		if ($navigating) return;
		breadcrumbStore.visit($page.url.pathname);
	});

	$effect(() => {
		const current = $machineCurrentTrack;
		if (current && !isSonglinkTrack(current)) {
			const newPath = `/track/${current.id}`;
			const isTrackPage = $page.url.pathname.startsWith('/track/');

			if ($page.url.pathname !== newPath && !$navigating) {
				if (isTrackPage) {
					goto(newPath, { keepFocus: true, noScroll: true });
				}
			}
		}
	});
	const mainMinHeight = $derived(() => Math.max(0, viewportHeight - headerHeight - playerHeight));
	const queueTrackCount = $derived(Array.isArray($machineQueue) ? $machineQueue.length : 0);
	const DOWNLOAD_CENTER_BADGE_POLL_MS = 1_000;
	const downloadCenterCurrentDownloads = $derived.by(() => {
		const activeDownloads = Number($workerStatus.activeDownloads ?? 0);
		const processing = Number($queueStats.processing ?? 0);
		const normalizedActive = Number.isFinite(activeDownloads) ? Math.max(0, Math.trunc(activeDownloads)) : 0;
		const normalizedProcessing = Number.isFinite(processing) ? Math.max(0, Math.trunc(processing)) : 0;
		return Math.max(normalizedActive, normalizedProcessing);
	});
	const downloadCenterQueueSize = $derived.by(() => {
		const queued = Number($queueStats.queued ?? 0);
		const normalizedQueued = Number.isFinite(queued) ? Math.max(0, Math.trunc(queued)) : 0;
		return downloadCenterCurrentDownloads + normalizedQueued;
	});
	const showDownloadCenterBadge = $derived(
		downloadCenterCurrentDownloads > 0 || downloadCenterQueueSize > 0
	);
	const downloadCenterBadgeLabel = $derived(
		`${downloadCenterCurrentDownloads}/${downloadCenterQueueSize}`
	);
	const currentTrackRoute = $derived.by(() => {
		const current = $machineCurrentTrack;
		if (!current || isSonglinkTrack(current)) return null;
		const parsedId = Number(current.id);
		if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
		return `/track/${parsedId}`;
	});

	const mainMarginBottom = $derived(() => Math.max(playerHeight, 128));

	const ensureAudioPlayerLoaded = async () => {
		if (AudioPlayerComponent) return;
		const module = await import('$lib/components/AudioPlayer.svelte');
		AudioPlayerComponent = module.default;
	};

	$effect(() => {
		if ($machineCurrentTrack && !AudioPlayerComponent) {
			void ensureAudioPlayerLoaded();
		}
	});
	$effect(() => {
		if (isEmbed && !AudioPlayerComponent) {
			void ensureAudioPlayerLoaded();
		}
	});

	function toggleSidebarCollapsed(): void {
		isSidebarCollapsed = !isSidebarCollapsed;
	}

	function isRouteActive(href: string): boolean {
		const path = $page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(`${href}/`);
	}

	function routeNavLabel(path: string, fallback: string): string {
		return getRouteMeta(path)?.navLabel ?? fallback;
	}

	function handleSidebarNavKeydown(event: KeyboardEvent): void {
		if (!sidebarNavContainer) return;
		const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(event.key)) return;

		const items = Array.from(
			sidebarNavContainer.querySelectorAll<HTMLElement>('[data-sidebar-item]')
		).filter((item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true');
		if (items.length === 0) return;

		const activeIndex = items.findIndex((item) => item === document.activeElement);
		let nextIndex = activeIndex >= 0 ? activeIndex : 0;

		switch (event.key) {
			case 'ArrowDown':
				nextIndex = (activeIndex + 1 + items.length) % items.length;
				break;
			case 'ArrowUp':
				nextIndex = (activeIndex - 1 + items.length) % items.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = items.length - 1;
				break;
			default:
				return;
		}

		event.preventDefault();
		items[nextIndex]?.focus();
	}

	$effect(() => {
		if (!sidebarNavContainer) return;
		const listener = (event: KeyboardEvent) => handleSidebarNavKeydown(event);
		sidebarNavContainer.addEventListener('keydown', listener);
		return () => {
			sidebarNavContainer?.removeEventListener('keydown', listener);
		};
	});

	$effect(() => {
		if (!isPlayerVisible && typeof document !== 'undefined') {
			document.documentElement.style.setProperty('--player-height', '0px');
		}
	});

	$effect(() => {
		if (typeof window === 'undefined' || isEmbed) {
			serverQueue.stopPolling();
			return;
		}
		serverQueue.startPolling(DOWNLOAD_CENTER_BADGE_POLL_MS);
		return () => {
			serverQueue.stopPolling();
		};
	});

	// Update page title with currently playing song.
	$effect(() => {
		if (typeof document === 'undefined') return;

		const track = $machineCurrentTrack;
		const isPlaying = $machineIsPlaying;

		if (track) {
			const artist = isSonglinkTrack(track) ? track.artistName : formatArtists(track.artists);
			const title = track.title ?? 'Unknown Track';
			const prefix = isPlaying ? '▶' : '⏸';
			document.title = `${prefix} ${title} • ${artist} | BiniLossless`;
		} else {
			document.title = pageTitle;
		}
	});

	const handlePlayerHeight = (height: number) => {
		playerHeight = height;
	};

	let controllerChangeHandler: (() => void) | null = null;

	onMount(() => {
		try {
			logger.setCorrelationId(getSessionId());
			if (import.meta.env.VITE_E2E === 'true') {
				(window as Window & { __tidalE2E?: boolean }).__tidalE2E = true;
			}
			// Subscribe to performance level and update data attribute
			const unsubPerf = effectivePerformanceLevel.subscribe((level) => {
				try {

					if (typeof document !== 'undefined' && document.documentElement) {
						document.documentElement.setAttribute('data-performance', level);
					}
				} catch (error) {
					console.warn('Failed to update performance level:', error);
				}
			});

		const updateViewportHeight = () => {
			viewportHeight = window.innerHeight;
		};
		updateViewportHeight();
		window.addEventListener('resize', updateViewportHeight);

		// Check if we're in a local/dev environment where SW should be disabled
		const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
		const isLocalPreview =
			hostname === '127.0.0.1' ||
			hostname === 'localhost' ||
			// LAN IP ranges where self-signed certs may cause SW registration to fail
			/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
			/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

		// Additional check: if we're on HTTPS but not on a trusted domain, SSL issues likely
		const isUntrustedHttps =
			typeof window !== 'undefined' &&
			window.location.protocol === 'https:' &&
			isLocalPreview;

		const isSecureContext =
			typeof window !== 'undefined' ? window.isSecureContext : false;
		const shouldUseServiceWorker =
			!dev &&
			!isLocalPreview &&
			!isUntrustedHttps &&
			isSecureContext &&
			import.meta.env.VITE_E2E !== 'true';

		// Proactively unregister any existing service workers if we shouldn't use them
		if ('serviceWorker' in navigator && !shouldUseServiceWorker) {
			navigator.serviceWorker
				.getRegistrations()
				.then((registrations) => {
					registrations.forEach((registration) => {
						void registration.unregister();
					});
					if (registrations.length > 0) {
						console.info('[ServiceWorker] Unregistered existing service workers (local/LAN environment)');
					}
				})
				.catch((error) => {
					console.warn('Failed to unregister service workers', error);
				});
		}

		// Only attempt registration on trusted environments
		if ('serviceWorker' in navigator && shouldUseServiceWorker) {
			const registerServiceWorker = async () => {
				try {
					const registration = await navigator.serviceWorker.register('/service-worker.js');
					const sendSkipWaiting = () => {
						if (registration.waiting) {
							registration.waiting.postMessage({ type: 'SKIP_WAITING' });
						}
					};

					if (registration.waiting) {
						sendSkipWaiting();
					}

					registration.addEventListener('updatefound', () => {
						const newWorker = registration.installing;
						if (!newWorker) return;
						newWorker.addEventListener('statechange', () => {
							if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
								sendSkipWaiting();
							}
						});
					});
				} catch (error) {
					// Handle SSL/Security errors gracefully - these occur on LAN IPs with self-signed certs
					const isSecurityError =
						error instanceof Error &&
						(error.name === 'SecurityError' ||
							error.message.includes('SSL') ||
							error.message.includes('certificate') ||
							error.message.includes('secure context'));

					if (isSecurityError) {
						console.warn(
							'[ServiceWorker] Registration failed due to SSL/security issue (likely self-signed cert on LAN IP). ' +
								'Offline caching disabled. App will continue to work without offline support.',
							error
						);
						// Don't show a toast for this - it's expected on dev LAN setups
					} else {
						console.error('Service worker registration failed', error);
					}
				}
			};

			registerServiceWorker();

			let refreshing = false;
			controllerChangeHandler = () => {
				if (refreshing) return;
				refreshing = true;
				window.location.reload();
			};
			navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);
		}
		return () => {
			window.removeEventListener('resize', updateViewportHeight);
			unsubPerf();
			if (controllerChangeHandler) {
				navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);
			}
		};
		} catch (error) {
			console.error('Failed to initialize layout:', error);
			// Continue with degraded functionality
		}
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/site.webmanifest" />

	<meta name="theme-color" content="#0a0a0a" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

	{#if isEmbed}
		{@render children?.()}
		{#if AudioPlayerComponent}
			<AudioPlayerComponent headless={true} />
		{/if}
	{:else}
		<div class="app-root" data-sveltekit-preload-data="hover">
		<div class="app-shell">
					<div class={`app-workspace ${isSidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
					<aside
						class="app-sidebar"
						aria-label="Primary navigation"
						bind:this={sidebarNavContainer}
					>
						<div class="app-sidebar__header">
							<div class="app-sidebar__brand">
								<p class="app-sidebar__title">BiniLossless</p>
								<p class="app-sidebar__subtitle">Library Control</p>
							</div>
							<button
								type="button"
								class="sidebar-icon-btn"
								onclick={toggleSidebarCollapsed}
								aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
								title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
							>
								{#if isSidebarCollapsed}
									<PanelRight size={16} />
								{:else}
									<PanelLeft size={16} />
								{/if}
							</button>
						</div>

						<div class="app-sidebar__section">
							<p class="app-sidebar__section-title">Navigation</p>
							<a
								class={`sidebar-action ${isRouteActive('/') ? 'is-active' : ''}`}
								href="/"
								aria-current={isRouteActive('/') ? 'page' : undefined}
								title="Browse and search"
								data-sidebar-item
							>
								<Search size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/', 'Browse & Search')}</span>
							</a>
								<button
									type="button"
									class={`sidebar-action ${currentTrackRoute && isRouteActive(currentTrackRoute) ? 'is-active' : ''}`}
									onclick={() => {
										if (!currentTrackRoute) return;
										void goto(currentTrackRoute);
									}}
									disabled={!currentTrackRoute}
									title={currentTrackRoute ? 'Open currently playing track' : 'No active track'}
									data-sidebar-item
								>
									<Music2 size={16} />
									<span class="sidebar-action__label">
										{currentTrackRoute ? 'Now Playing' : 'No Track Active'}
									</span>
								</button>
									<a
										class={`sidebar-action ${isRouteActive('/history') ? 'is-active' : ''}`}
										href="/history"
										aria-current={isRouteActive('/history') ? 'page' : undefined}
										title="Navigation history"
										data-sidebar-item
									>
										<History size={16} />
										<span class="sidebar-action__label">{routeNavLabel('/history', 'History')}</span>
									</a>
									<a
										class={`sidebar-action ${isRouteActive('/library-suggestions') ? 'is-active' : ''}`}
										href="/library-suggestions"
										aria-current={isRouteActive('/library-suggestions') ? 'page' : undefined}
										title="Library suggestions"
										data-sidebar-item
									>
										<Library size={16} />
										<span class="sidebar-action__label">
											{routeNavLabel('/library-suggestions', 'Library Suggestions')}
										</span>
									</a>
								</div>

							<div class="app-sidebar__section">
								<p class="app-sidebar__section-title">Tools</p>
							<a
								class={`sidebar-action ${isRouteActive('/settings') ? 'is-active' : ''}`}
								href="/settings"
								aria-current={isRouteActive('/settings') ? 'page' : undefined}
								title="Open settings"
								data-sidebar-item
							>
								<Settings size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/settings', 'Settings')}</span>
							</a>
								<a
									class={`sidebar-action ${isRouteActive('/download-center') ? 'is-active' : ''}`}
									href="/download-center"
									aria-current={isRouteActive('/download-center') ? 'page' : undefined}
									title="Download center"
									data-sidebar-item
								>
									<Download size={16} />
									<span class="sidebar-action__label">{routeNavLabel('/download-center', 'Download Center')}</span>
									{#if showDownloadCenterBadge}
										<span class="sidebar-action__bubble" title="Current downloads / queue size">
											{downloadCenterBadgeLabel}
										</span>
									{/if}
								</a>
							<a
								class={`sidebar-action ${isRouteActive('/download-log') ? 'is-active' : ''}`}
								href="/download-log"
								aria-current={isRouteActive('/download-log') ? 'page' : undefined}
								title="Download log"
								data-sidebar-item
							>
								<Logs size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/download-log', 'Download Log')}</span>
							</a>
							<a
								class={`sidebar-action ${isRouteActive('/status') ? 'is-active' : ''}`}
								href="/status"
								aria-current={isRouteActive('/status') ? 'page' : undefined}
								title="System status"
								data-sidebar-item
							>
								<Activity size={16} />
								<span class="sidebar-action__label">{routeNavLabel('/status', 'Status')}</span>
							</a>
						</div>

						<div class="app-sidebar__meta">
							<span class="app-sidebar__meta-chip">Queue {queueTrackCount}</span>
							<span class="app-sidebar__meta-chip">{isServerStorage ? 'Server Save' : 'Client Save'}</span>
						</div>
					</aside>

					<main
						class="app-main app-main--workspace !sm:mb-40 !mb-56"
						style={`min-height: ${mainMinHeight}px; margin-bottom: ${mainMarginBottom}px;`}
					>
						<div class="app-main__inner">
							<Breadcrumb />
								{@render children?.()}
						</div>
					</main>
				</div>

			{#if $machineCurrentTrack && AudioPlayerComponent}
				<AudioPlayerComponent
					onHeightChange={handlePlayerHeight}
					onVisibilityChange={(visible) => {
						isPlayerVisible = visible;
					}}
				/>
			{/if}
		</div>
	</div>

	<LyricsPopup />
	<ToastContainer />
{/if}


<style>
	:global(:root) {
		--bloom-primary: #0a0a0a;
		--bloom-secondary: #121212;
		--bloom-accent: #f2f2f2;
		--bloom-glow: rgba(255, 255, 255, 0.2);
		--bloom-tertiary: rgba(255, 255, 255, 0.12);
		--bloom-quaternary: rgba(255, 255, 255, 0.12);
		--surface-color: #121212;
		--surface-border: rgba(255, 255, 255, 0.15);
		--surface-highlight: rgba(255, 255, 255, 0.08);
		--accent-color: var(--bloom-accent);
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family: var(--ui-font-sans, 'Figtree', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
		background:
			radial-gradient(circle at top left, rgba(255, 255, 255, 0.035) 0%, transparent 22%),
			radial-gradient(circle at top right, rgba(159, 185, 246, 0.035) 0%, transparent 20%),
			#070707;
		background-attachment: fixed;
		color: #f8fbff;
	}

	.app-root {
		position: relative;
		min-height: 100vh;
		color: inherit;
		overflow: clip;
	}

	.app-root::before,
	.app-root::after {
		content: none;
		position: fixed;
		pointer-events: none;
		filter: blur(64px);
		opacity: 0.24;
		z-index: 0;
		animation: ambient-float 22s ease-in-out infinite alternate;
	}

	.app-root::before {
		width: 480px;
		height: 480px;
		left: -160px;
		top: -140px;
		background: radial-gradient(circle, rgba(255, 255, 255, 0.12) 0%, transparent 72%);
	}

	.app-root::after {
		width: 440px;
		height: 440px;
		right: -180px;
		bottom: -180px;
		background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
		animation-delay: 4s;
	}

	.app-shell {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	.app-workspace {
		flex: 1;
		display: grid;
		grid-template-columns: clamp(230px, 20vw, 270px) minmax(0, 1fr);
		gap: clamp(0.8rem, 1.4vw, 1.1rem);
		padding: clamp(0.7rem, 1.4vw, 1.1rem);
		align-items: start;
		width: 100%;
	}

	.app-workspace.is-sidebar-collapsed {
		grid-template-columns: 84px minmax(0, 1fr);
	}

	.app-sidebar {
		position: sticky;
		top: clamp(0.8rem, 1.6vw, 1.4rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1rem 0 0;
		border-radius: 0;
		max-height: calc(100vh - clamp(1.6rem, 3.2vw, 2.8rem) - var(--player-height, 0px));
		overflow-y: auto;
		background: transparent;
		border-right: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: none;
		animation: none;
	}

	.app-sidebar__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-right: 0.2rem;
	}

	.app-sidebar__brand {
		min-width: 0;
	}

	.app-sidebar__title {
		margin: 0;
		font-size: 1.08rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: rgba(245, 245, 245, 0.95);
	}

	.app-sidebar__subtitle {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: rgba(212, 212, 212, 0.62);
	}

	.app-sidebar__section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding-top: 0.2rem;
	}

	.app-sidebar__section-title {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: rgba(161, 161, 161, 0.6);
	}

	.sidebar-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		color: rgba(236, 236, 236, 0.95);
		cursor: pointer;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.sidebar-icon-btn:hover {
		transform: none;
		border-color: rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.045);
	}

	.sidebar-icon-btn:active {
		transform: translateY(0);
	}

	.sidebar-action {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.74rem 0.82rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		color: rgba(236, 236, 236, 0.9);
		text-decoration: none;
		font-size: 0.92rem;
		font-weight: 600;
		line-height: 1.1;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.sidebar-action::after {
		content: '';
		position: absolute;
		inset: 0;
		background: none;
		opacity: 0;
		transition: opacity 160ms ease;
	}

	.sidebar-action:hover:not(:disabled) {
		transform: none;
		border-color: rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.045);
	}

	.sidebar-action:hover::after {
		opacity: 1;
	}

	.sidebar-action:active:not(:disabled) {
		transform: translateY(0);
	}

	.sidebar-action.is-active {
		border-color: rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.08);
		box-shadow: none;
	}

	.sidebar-action.is-active::after {
		opacity: 1;
	}

	.sidebar-action:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.sidebar-action__label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar-action__bubble {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.45rem;
		padding: 0.22rem 0.45rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.08);
		color: rgba(245, 245, 245, 0.96);
		font-size: 0.84rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		line-height: 1;
		position: relative;
		z-index: 1;
	}

	.app-sidebar__meta {
		margin-top: auto;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding-top: 0.35rem;
	}

	.app-sidebar__meta-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem 0.55rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		font-size: 0.82rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: rgba(215, 215, 215, 0.82);
	}

	.diagnostics-toggle {
		position: fixed;
		left: 1.5rem;
		bottom: calc(1.5rem + var(--player-height, 0px));
		z-index: 110;
		border-radius: var(--ui-radius-sm, 9px);
		padding: 0.45rem 1rem;
		background: rgba(255, 255, 255, 0.14);
		border: 1px solid rgba(255, 255, 255, 0.35);
		color: rgba(226, 226, 226, 0.94);
		font-size: 0.94rem;
		cursor: pointer;
		backdrop-filter: blur(10px);
		transition:
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.diagnostics-toggle:hover {
		background: rgba(255, 255, 255, 0.22);
		transform: translateY(-1px);
	}

	.diagnostics-toggle:active {
		transform: translateY(0);
	}

	.ui-shell-surface {
		background: transparent;
		border: 0;
		border-radius: 0;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		box-shadow: none;
		transition: none;
	}

	.app-main {
		flex: 1;
		padding: clamp(1rem, 1.9vw, 1.6rem);
		margin: 0;
		border-radius: 0;
		position: relative;
		z-index: 1;
		animation: none;
	}

	.app-main--workspace {
		margin: 0;
		min-width: 0;
	}

	.app-main__inner {
		width: 100%;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar {
		padding-inline: 0 0.35rem;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar__header {
		justify-content: center;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar__brand,
	.app-workspace.is-sidebar-collapsed .app-sidebar__section-title,
	.app-workspace.is-sidebar-collapsed .sidebar-action__label,
	.app-workspace.is-sidebar-collapsed .sidebar-action__bubble,
	.app-workspace.is-sidebar-collapsed .app-sidebar__meta {
		display: none;
	}

	.app-workspace.is-sidebar-collapsed .app-sidebar__section {
		align-items: center;
	}

	.app-workspace.is-sidebar-collapsed .sidebar-action {
		width: 100%;
		justify-content: center;
	}

	.navigation-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		background: rgba(7, 7, 7, 0.72);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		z-index: 50;
	}

	.navigation-overlay__progress {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		overflow: hidden;
		background: transparent;
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.15);
	}

	.navigation-progress {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -40%;
		width: 60%;
		background: rgba(255, 255, 255, 0.7);
		box-shadow: none;
		animation: none;
	}

	.navigation-overlay__content {
		font-size: 0.9rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: rgba(236, 236, 236, 0.9);
	}

	@keyframes shimmer {
		0% {
			transform: translateX(0);
			opacity: 0.2;
		}
		50% {
			transform: translateX(250%);
			opacity: 0.85;
		}
		100% {
			transform: translateX(400%);
			opacity: 0;
		}
	}

	:global(.animate-spin-slower) {
		animation: spin-slower 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes spin-slower {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 1023px) {
		.app-workspace {
			display: block;
			padding: 0.65rem;
		}

		.app-sidebar {
			display: none;
		}

		.app-main--workspace {
			margin: 0;
		}
	}

	@media (max-width: 640px) {
		.app-main {
			padding: 1rem;
			margin: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.app-sidebar,
		.app-main {
			animation: none;
		}

		.navigation-progress {
			animation: none;
			left: 0;
			width: 100%;
		}

		.sidebar-action,
		.sidebar-icon-btn,
		.diagnostics-toggle {
			transform: none !important;
		}
	}
</style>
