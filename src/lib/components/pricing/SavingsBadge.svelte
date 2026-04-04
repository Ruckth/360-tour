<script lang="ts">
	import { onMount } from 'svelte';

	let { amount, compact = false }: { amount: number; compact?: boolean } = $props();

	let displayValue = $state(0);
	let el: HTMLDivElement | undefined = $state();
	let hasAnimated = $state(false);

	function animateCount(target: number) {
		if (hasAnimated) return;
		hasAnimated = true;
		const duration = 1200;
		const start = performance.now();
		function tick(now: number) {
			const elapsed = now - start;
			const progress = Math.min(elapsed / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			displayValue = Math.round(eased * target);
			if (progress < 1) {
				requestAnimationFrame(tick);
			}
		}
		requestAnimationFrame(tick);
	}

	onMount(() => {
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					animateCount(amount);
					observer.disconnect();
				}
			},
			{ threshold: 0.3 }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (hasAnimated && amount !== displayValue) {
			hasAnimated = false;
			animateCount(amount);
		}
	});
</script>

<div
	bind:this={el}
	class="{compact
		? 'inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
		: 'inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'}"
>
	<svg
		class="{compact ? 'h-3 w-3' : 'h-4 w-4'}"
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
		/>
	</svg>
	{#if compact}
		Save &#3647;{displayValue.toLocaleString()}
	{:else}
		You save &#3647;{displayValue.toLocaleString()} vs OTAs
	{/if}
</div>
