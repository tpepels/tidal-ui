<script lang="ts">
	import { Share2, Link, Copy, Check, Code } from 'lucide-svelte';
	import { scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	interface Props {
		type: 'track' | 'album' | 'artist' | 'playlist';
		id: string | number;
		title?: string;
		size?: number;
		iconOnly?: boolean;
		variant?: 'ghost' | 'primary' | 'secondary';
	}

let { 
		type, 
		id, 
		title = 'Share', 
		size = 20, 
		iconOnly = false,
		variant = 'ghost'
	}: Props = $props();

	let showMenu = $state(false);
	let copied = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);
	let buttonRef = $state<HTMLButtonElement | null>(null);
	let prefersReducedMotion = $state(false);

	function getLongLink() {
		return `${$page.url.protocol}//${$page.url.host}/${type}/${id}`;
	}

	function getEmbedUrl() {
		return `${$page.url.protocol}//${$page.url.host}/embed/${type}/${id}`;
	}

	function getShortLink() {
		const prefixMap = {
			track: 't',
			album: 'al',
			artist: 'ar',
			playlist: 'p'
		};
		return `https://okiw.me/${prefixMap[type]}/${id}`;
	}

	function getEmbedCode() {
        if (type === "track") return `<iframe src="${getEmbedUrl()}" width="100%" height="150" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
		return `<iframe src="${getEmbedUrl()}" width="100%" height="450" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
	}

	async function copyToClipboard(text: string) {
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				// Fallback for non-secure contexts
				const textArea = document.createElement('textarea');
				textArea.value = text;
				textArea.style.position = 'fixed';
				textArea.style.left = '-9999px';
				textArea.style.top = '0';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				try {
					document.execCommand('copy');
				} catch (err) {
					console.error('Fallback: Oops, unable to copy', err);
					throw err;
				}
				document.body.removeChild(textArea);
			}
			copied = true;
			showMenu = false;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	function handleClickOutside(event: MouseEvent) {
		if (showMenu && 
			menuRef && 
			!menuRef.contains(event.target as Node) && 
			buttonRef && 
			!buttonRef.contains(event.target as Node)) {
			showMenu = false;
		}
	}

	onMount(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const handleMotionPreference = () => {
			prefersReducedMotion = media.matches;
		};
		handleMotionPreference();

		document.addEventListener('click', handleClickOutside);
		media.addEventListener('change', handleMotionPreference);
		return () => {
			document.removeEventListener('click', handleClickOutside);
			media.removeEventListener('change', handleMotionPreference);
		};
	});

	const variantClasses = {
		ghost:
			'border border-white/8 bg-white/[0.02] text-gray-300 hover:border-white/16 hover:bg-white/[0.05] hover:text-white',
		primary: 'border border-white/16 bg-white text-black hover:border-white/22 hover:bg-white/95',
		secondary:
			'border border-white/8 bg-white/[0.02] text-gray-100 hover:border-white/16 hover:bg-white/[0.05]'
	};
</script>

<div class="relative inline-block">
	<button
		bind:this={buttonRef}
		class="share-trigger flex items-center gap-2 rounded-full transition-[background-color,border-color,color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] {variantClasses[variant]} {iconOnly ? 'p-2' : 'px-4 py-2'}"
		onclick={(e) => {
			e.stopPropagation();
			showMenu = !showMenu;
		}}
		{title}
		aria-label={title}
		aria-haspopup="true"
		aria-expanded={showMenu}
	>
		{#if copied && iconOnly}
			<Check size={size} class="text-green-500" />
		{:else}
			<Share2 size={size} />
		{/if}
		{#if !iconOnly}
			<span>{copied ? 'Copied!' : 'Share'}</span>
		{/if}
	</button>

	{#if showMenu}
		<div
			bind:this={menuRef}
			transition:scale={{ duration: prefersReducedMotion ? 0 : 120, start: prefersReducedMotion ? 1 : 0.97 }}
			class="share-menu absolute right-0 top-full z-50 mt-2 w-48 origin-top-right rounded-2xl border border-white/10 bg-[#090909]/98 p-1 shadow-none"
		>
			<button
				class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
				onclick={(e) => {
					e.stopPropagation();
					copyToClipboard(getLongLink());
				}}
			>
				<Link size={16} />
				Copy Link
			</button>
			<button
				class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
				onclick={(e) => {
					e.stopPropagation();
					copyToClipboard(getShortLink());
				}}
			>
				<Copy size={16} />
				Copy Short Link
			</button>
			<button
				class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
				onclick={(e) => {
					e.stopPropagation();
					copyToClipboard(getEmbedCode());
				}}
			>
				<Code size={16} />
				Copy Embed Code
			</button>
		</div>
	{/if}
</div>

<style>
	@media (prefers-reduced-motion: reduce) {
		.share-trigger,
		.share-menu,
		.share-menu button {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
