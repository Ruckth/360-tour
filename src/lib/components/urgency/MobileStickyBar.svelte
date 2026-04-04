<script lang="ts">
	import { getDiscountedPrice } from '$lib/data/urgency';
	import { bookingState } from '$lib/stores/booking.svelte';

	let {
		pricePerNight,
		propertyId
	}: {
		pricePerNight: number;
		propertyId: string;
	} = $props();

	const discounted = $derived(getDiscountedPrice(pricePerNight));

	function handleReserve() {
		bookingState.startBooking(propertyId);
	}
</script>

<div class="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] md:hidden">
	<div class="flex items-center justify-between">
		<div>
			<div class="flex items-baseline gap-1.5">
				<span class="text-sm text-muted-foreground line-through">&#3647;{pricePerNight.toLocaleString()}</span>
				<span class="text-lg font-bold text-card-foreground">&#3647;{discounted.toLocaleString()}</span>
			</div>
			<p class="text-[11px] text-muted-foreground">/night</p>
		</div>
		<button
			onclick={handleReserve}
			class="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:from-sky-400 hover:to-blue-500"
		>
			Reserve Now
		</button>
	</div>
</div>
