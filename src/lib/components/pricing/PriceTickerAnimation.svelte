<script lang="ts">
	import { onMount } from 'svelte';
	import { pricingState } from '$lib/stores/pricing.svelte';

	let el: HTMLDivElement | undefined = $state();
	let step = $state(0);
	let hasStarted = $state(false);

	const worstOta = $derived(
		pricingState.otaTotals.length > 0
			? pricingState.otaTotals.reduce((max, o) => (o.total > max.total ? o : max))
			: null
	);

	function runAnimation() {
		if (hasStarted) return;
		hasStarted = true;
		step = 0;

		const delays = [0, 600, 1200, 1800, 2600, 3200, 3800];
		delays.forEach((delay, i) => {
			setTimeout(() => {
				step = i + 1;
			}, delay);
		});
	}

	$effect(() => {
		if (worstOta && hasStarted) {
			hasStarted = false;
			runAnimation();
		}
	});

	onMount(() => {
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					runAnimation();
					observer.disconnect();
				}
			},
			{ threshold: 0.3 }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

{#if worstOta}
	<div bind:this={el} class="overflow-hidden rounded-xl border border-border bg-card p-4 md:p-6">
		<p class="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
			How OTA Prices Build Up
		</p>

		<div class="space-y-2">
			<div
				class="flex items-center justify-between rounded-lg px-3 py-2 transition-all duration-500 {step >= 1 ? 'bg-muted/50 opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}"
			>
				<span class="text-sm text-muted-foreground">{worstOta.displayName} base rate</span>
				<span class="text-sm font-medium text-card-foreground">
					&#3647;{worstOta.subtotal.toLocaleString()}
				</span>
			</div>

			<div
				class="flex items-center justify-between rounded-lg px-3 py-2 transition-all duration-500 {step >= 2 ? 'bg-red-500/5 opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}"
			>
				<span class="text-sm text-red-500 dark:text-red-400">+ Service fee</span>
				<span class="text-sm font-medium text-red-500 dark:text-red-400">
					+&#3647;{worstOta.serviceFee.toLocaleString()}
				</span>
			</div>

			<div
				class="flex items-center justify-between rounded-lg px-3 py-2 transition-all duration-500 {step >= 3 ? 'bg-red-500/5 opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}"
			>
				<span class="text-sm text-red-500 dark:text-red-400">+ Cleaning fee</span>
				<span class="text-sm font-medium text-red-500 dark:text-red-400">
					+&#3647;{worstOta.cleaningFee.toLocaleString()}
				</span>
			</div>

			<div
				class="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5 transition-all duration-500 {step >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}"
			>
				<span class="text-sm font-semibold text-muted-foreground">
					{worstOta.displayName} total
				</span>
				<span class="text-base font-bold text-muted-foreground line-through decoration-red-400 decoration-2">
					&#3647;{worstOta.total.toLocaleString()}
				</span>
			</div>
		</div>

		<div
			class="my-4 flex items-center gap-3 transition-all duration-500 {step >= 5 ? 'opacity-100' : 'opacity-0'}"
		>
			<div class="h-px flex-1 bg-emerald-500/30"></div>
			<span class="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">vs</span>
			<div class="h-px flex-1 bg-emerald-500/30"></div>
		</div>

		<div class="space-y-2">
			<div
				class="flex items-center justify-between rounded-lg px-3 py-2 transition-all duration-500 {step >= 6 ? 'bg-emerald-500/5 opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}"
			>
				<span class="text-sm text-emerald-600 dark:text-emerald-400">Direct base rate</span>
				<span class="text-sm font-medium text-emerald-600 dark:text-emerald-400">
					&#3647;{pricingState.directTotal.toLocaleString()}
				</span>
			</div>

			<div
				class="flex items-center justify-between rounded-lg border-2 border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 transition-all duration-500 {step >= 7 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}"
			>
				<span class="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
					Direct total
				</span>
				<span class="text-base font-bold text-emerald-600 dark:text-emerald-400">
					&#3647;{pricingState.directTotal.toLocaleString()}
				</span>
			</div>
		</div>
	</div>
{/if}
