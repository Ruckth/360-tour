<script lang="ts">
	import { bookingState } from '$lib/stores/booking.svelte';
	import { DISCOUNT_PERCENT } from '$lib/data/urgency';

	let remaining = $state(Math.max(0, bookingState.discountEndTime - Date.now()));

	$effect(() => {
		const timer = setInterval(() => {
			remaining = Math.max(0, bookingState.discountEndTime - Date.now());
			if (remaining <= 0) {
				bookingState.discountActive = false;
				clearInterval(timer);
			}
		}, 1000);
		return () => clearInterval(timer);
	});

	const hours = $derived(Math.floor(remaining / 3600000));
	const minutes = $derived(Math.floor((remaining % 3600000) / 60000));
	const seconds = $derived(Math.floor((remaining % 60000) / 1000));

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}
</script>

{#if remaining > 0}
	<div class="rounded-lg border border-amber-500/30 bg-amber-50 p-3 dark:bg-amber-950/30">
		<p class="text-xs font-medium text-amber-700 dark:text-amber-400">
			{DISCOUNT_PERCENT}% direct booking discount ends in:
		</p>
		<div class="mt-1.5 flex items-center gap-1 font-mono text-xl font-bold tracking-wider text-amber-600 dark:text-amber-300">
			<span class="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/50">{pad(hours)}</span>
			<span class="text-amber-400">:</span>
			<span class="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/50">{pad(minutes)}</span>
			<span class="text-amber-400">:</span>
			<span class="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/50">{pad(seconds)}</span>
		</div>
	</div>
{/if}
