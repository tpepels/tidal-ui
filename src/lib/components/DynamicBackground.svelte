<script lang="ts">
	// Intentionally disabled:
	// Dynamic background was causing excessive GPU usage and thermal issues.
</script>

<div class="webgl-background" aria-hidden="true">
	<div class="default-background"></div>
</div>

<style>
	.webgl-background {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
		background: #0a0e1a;
	}

	.default-background {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse at 20% 30%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
			radial-gradient(ellipse at 80% 70%, rgba(99, 102, 241, 0.12) 0%, transparent 50%),
			radial-gradient(ellipse at 50% 50%, rgba(139, 92, 246, 0.08) 0%, transparent 60%),
			linear-gradient(135deg, #0a0e1a 0%, #0f172a 50%, #1e293b 100%);
	}
</style>
