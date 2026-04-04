<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { socialProofState } from '$lib/stores/social-proof.svelte';
	import { properties } from '$lib/data/properties';

	function getPropertyName(propertyId: string): string {
		return properties.find((p) => p.id === propertyId)?.name ?? propertyId;
	}

	onMount(() => { socialProofState.startBookingFeed(); });
	onDestroy(() => { socialProofState.stopBookingFeed(); });
</script>

{#if socialProofState.showBookingFeed && socialProofState.currentBooking}
	{@const booking = socialProofState.currentBooking}
	<div class="booking-feed-slide fixed bottom-4 left-4 z-40 max-w-xs md:bottom-6 md:left-6">
		<div class="flex items-start gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur-md md:p-4">
			<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
			</div>
			<div class="min-w-0">
				<p class="text-sm text-foreground">
					<span class="font-semibold">{booking.name}</span> from <span class="font-semibold">{booking.city}</span> booked <span class="font-semibold">{getPropertyName(booking.propertyId)}</span> for {booking.dates}
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">{booking.timeAgo}</p>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes slide-in-left {
		from { transform: translateX(-120%); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}
	.booking-feed-slide { animation: slide-in-left 0.4s ease-out; }
</style>
