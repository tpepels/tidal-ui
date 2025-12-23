<script lang="ts">

	interface Props {
		src: string;
		alt: string;
		class?: string;
		placeholder?: string;
		rootMargin?: string;
	}

	let {
		src,
		alt,
		class: className = '',
		placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMTExIi8+PC9zdmc+',
		rootMargin = '50px'
	}: Props = $props();

	let imgElement = $state<HTMLImageElement>();
	let isLoaded = $state(false);
	let isInView = $state(false);
	let observer: IntersectionObserver | null = null;

	$effect(() => {
		if (typeof window !== 'undefined' && imgElement && !isInView) {
			observer = new IntersectionObserver(
				(entries) => {
					entries.forEach((entry) => {
						if (entry.isIntersecting) {
							isInView = true;
							observer?.disconnect();
						}
					});
				},
				{ rootMargin }
			);
			observer.observe(imgElement);
		}

		return () => {
			observer?.disconnect();
		};
	});

	function handleLoad() {
		isLoaded = true;
	}
</script>

<img
	bind:this={imgElement}
	src={isInView ? src : placeholder}
	{alt}
	class="{className} transition-opacity duration-300 {isLoaded ? 'opacity-100' : 'opacity-0'}"
	onload={handleLoad}
	style={isInView ? '' : 'filter: blur(10px); transform: scale(1.1);'}
/>