<script lang="ts">
	import { Activity, Download, History, Home, Logs, Settings } from 'lucide-svelte';

	let { current = '' }: { current?: string } = $props();

	type ToolNavItem = {
		href: string;
		title: string;
		description: string;
		icon: typeof Activity;
	};

	const items: ToolNavItem[] = [
		{
			href: '/',
			title: 'Search',
			description: 'Browse tracks, albums, and artists.',
			icon: Home
		},
		{
			href: '/history',
			title: 'History',
			description: 'Resume recent albums and artists.',
			icon: History
		},
		{
			href: '/download-center',
			title: 'Download Center',
			description: 'Monitor and control queue activity.',
			icon: Download
		},
		{
			href: '/download-log',
			title: 'Download Log',
			description: 'Inspect event stream and server health.',
			icon: Logs
		},
		{
			href: '/status',
			title: 'Status',
			description: 'Review diagnostics and backend telemetry.',
			icon: Activity
		},
		{
			href: '/settings',
			title: 'Settings',
			description: 'Configure streaming and metadata behavior.',
			icon: Settings
		}
	];
</script>

<nav class="ui-link-grid tool-nav-grid" aria-label="Workspace navigation">
	{#each items as item (item.href)}
		<a
			href={item.href}
			class="ui-link-card"
			data-active={item.href === current}
			data-sveltekit-preload-data
		>
			<span class="ui-link-card__icon">
				<item.icon size={15} />
			</span>
			<span class="ui-link-card__body">
				<span class="ui-link-card__title">{item.title}</span>
				<span class="ui-link-card__description">{item.description}</span>
			</span>
			<span class="ui-link-card__state">{item.href === current ? 'Current' : 'Open'}</span>
		</a>
	{/each}
</nav>

<style>
	.tool-nav-grid {
		margin: 0;
	}
</style>
