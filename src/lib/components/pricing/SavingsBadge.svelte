<script lang="ts">
	import { onMount, untrack } from 'svelte';

	let { amount, compact = false }: { amount: number; compact?: boolean } = $props();

	let displayValue = $state(0);
	let el: HTMLDivElement | undefined = $state();
	let hasAnimated = $state(false);

	function animateCount(target: number) {
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

	// Re-animate when amount changes — only track `amount`, untrack the rest to avoid infinite loop
	$effect(() => {
		const target = amount;
		untrack(() => {
			if (hasAnimated) {
				hasAnimated = false;
				animateCount(target);
			}
		});
	});
</script>

<div
	bind:this={el}
	class="{compact
		? 'inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
		: 'inline-flex items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2 text-sm font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'}"
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
			d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
		/>
	</svg>
	{#if compact}
		&#3647;{displayValue.toLocaleString()} in OTA fees
	{:else}
		&#3647;{displayValue.toLocaleString()} in OTA fees avoided
	{/if}
</div>
