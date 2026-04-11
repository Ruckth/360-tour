<script lang="ts">
	import { onMount } from 'svelte';
	import { recentBookings } from '$lib/data/social-proof';
	import { MapPin } from '@lucide/svelte';

	let { propertyId = '' }: { propertyId?: string } = $props();

	const filtered = $derived(
		propertyId
			? recentBookings.filter((b) => b.propertyId === propertyId)
			: recentBookings
	);

	let currentIndex = $state(0);
	let visible = $state(false);
	let intervalId: ReturnType<typeof setInterval>;

	onMount(() => {
		// Show first booking after a short delay
		const showTimeout = setTimeout(() => {
			visible = true;
		}, 2000);

		// Cycle through bookings
		intervalId = setInterval(() => {
			visible = false;
			setTimeout(() => {
				currentIndex = (currentIndex + 1) % filtered.length;
				visible = true;
			}, 400);
		}, 5000);

		return () => {
			clearTimeout(showTimeout);
			clearInterval(intervalId);
		};
	});

	const current = $derived(filtered[currentIndex]);
</script>

{#if filtered.length > 0 && current}
	<div
		class="overflow-hidden rounded-lg border border-border bg-card/80 backdrop-blur-sm transition-all duration-400 {visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}"
	>
		<div class="flex items-center gap-3 px-3 py-2.5">
			<div class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
				<MapPin class="h-4 w-4 text-amber-600 dark:text-amber-400" />
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-medium text-foreground truncate">
					{current.name} from {current.city}
				</p>
				<p class="text-xs text-muted-foreground">
					Booked {current.dates} &middot; {current.timeAgo}
				</p>
			</div>
			<div class="flex-shrink-0">
				<span class="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
			</div>
		</div>
	</div>
{/if}
