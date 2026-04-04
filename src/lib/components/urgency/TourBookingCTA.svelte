<script lang="ts">
	import { getDiscountedPrice, DISCOUNT_PERCENT } from '$lib/data/urgency';
	import { bookingState } from '$lib/stores/booking.svelte';

	let {
		pricePerNight,
		propertyId,
		propertyName
	}: {
		pricePerNight: number;
		propertyId: string;
		propertyName: string;
	} = $props();

	let visible = $state(false);

	$effect(() => {
		const timer = setTimeout(() => {
			visible = true;
		}, 10000);
		return () => clearTimeout(timer);
	});

	const discountedPrice = $derived(getDiscountedPrice(pricePerNight));
	const savings = $derived(pricePerNight - discountedPrice);

	function handleBook() {
		bookingState.startBooking(propertyId);
	}
</script>

{#if visible}
	<div class="absolute bottom-20 right-4 z-30 w-64 animate-tour-cta-in md:bottom-8 md:right-6 md:w-72">
		<div class="cta-glow rounded-xl border border-white/20 bg-black/80 p-4 shadow-2xl backdrop-blur-md">
			<p class="text-xs font-medium text-white/60">{propertyName}</p>
			<div class="mt-1.5 flex items-baseline gap-2">
				<span class="text-sm text-white/40 line-through">&#3647;{pricePerNight.toLocaleString()}</span>
				<span class="text-xl font-bold text-white">&#3647;{discountedPrice.toLocaleString()}</span>
				<span class="text-xs text-white/50">/night</span>
			</div>
			<p class="mt-1 text-xs text-green-400">Save {DISCOUNT_PERCENT}% — direct booking</p>
			<button
				onclick={handleBook}
				class="mt-3 w-full rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:from-sky-400 hover:to-blue-500"
			>
				Book Now &mdash; Save &#3647;{savings.toLocaleString()}
			</button>
		</div>
	</div>
{/if}

<style>
	@keyframes tour-cta-in {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes cta-glow {
		0%, 100% { box-shadow: 0 0 15px rgba(56, 189, 248, 0.15); }
		50% { box-shadow: 0 0 25px rgba(56, 189, 248, 0.35); }
	}

	:global(.animate-tour-cta-in) {
		animation: tour-cta-in 0.5s ease-out;
	}

	.cta-glow {
		animation: cta-glow 2s ease-in-out infinite;
	}
</style>
