<script lang="ts">
	import { bookingState } from '$lib/stores/booking.svelte';
	import { getPropertyById } from '$lib/data/properties';
	import { getDiscountedPrice, DISCOUNT_PERCENT } from '$lib/data/urgency';
	import BookingFunnel from './BookingFunnel.svelte';

	const property = $derived(getPropertyById(bookingState.selectedPropertyId));
	const pricePerNight = $derived(property?.pricePerNight ?? 0);
	const discountedPrice = $derived(getDiscountedPrice(pricePerNight));
	const totalBeforeDiscount = $derived(pricePerNight * bookingState.nightCount);
	const discountAmount = $derived(Math.round(totalBeforeDiscount * (DISCOUNT_PERCENT / 100)));
	const totalPrice = $derived(totalBeforeDiscount - (bookingState.discountActive ? discountAmount : 0));

	let showConfetti = $state(false);

	function handleConfirm() {
		bookingState.confirmBooking();
		showConfetti = true;
		setTimeout(() => {
			showConfetti = false;
		}, 3000);
	}

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			bookingState.modalOpen = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			bookingState.modalOpen = false;
		}
	}

	// Compute min date (today)
	const today = new Date().toISOString().split('T')[0];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if bookingState.modalOpen}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center"
		onclick={handleOverlayClick}
	>
		<!-- Modal/Drawer -->
		<div
			class="relative w-full max-w-lg animate-modal-up rounded-t-2xl border border-border bg-card p-5 shadow-2xl md:rounded-2xl md:p-6"
		>
			<!-- Close button -->
			<button
				onclick={() => (bookingState.modalOpen = false)}
				class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
				aria-label="Close"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			{#if bookingState.bookingConfirmed}
				<!-- Success State -->
				<div class="py-6 text-center">
					<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 {showConfetti ? 'animate-success-bounce' : ''}">
						<svg class="h-8 w-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
						</svg>
					</div>
					<h3 class="text-xl font-bold text-card-foreground">Booking Confirmed!</h3>
					<p class="mt-2 text-sm text-muted-foreground">
						Your stay at {property?.name} has been reserved.
					</p>
					<p class="mt-1 text-sm text-muted-foreground">
						{bookingState.checkInDate} &rarr; {bookingState.checkOutDate}
					</p>
					<p class="mt-3 text-lg font-bold text-primary">
						Total: &#3647;{totalPrice.toLocaleString()}
					</p>
					<button
						onclick={() => bookingState.reset()}
						class="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
					>
						Done
					</button>
				</div>
			{:else}
				<!-- Booking Form -->
				<h3 class="text-lg font-bold text-card-foreground">
					Reserve {property?.name}
				</h3>

				<div class="mt-4">
					<BookingFunnel />
				</div>

				<!-- Step 1: Dates -->
				<div class="mt-5 space-y-3">
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label for="modal-checkin" class="block text-xs font-medium uppercase text-muted-foreground">Check-in</label>
							<input
								id="modal-checkin"
								type="date"
								min={today}
								value={bookingState.checkInDate}
								oninput={(e) => {
									const val = (e.target as HTMLInputElement).value;
									bookingState.setDates(val, bookingState.checkOutDate);
								}}
								class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
							/>
						</div>
						<div>
							<label for="modal-checkout" class="block text-xs font-medium uppercase text-muted-foreground">Check-out</label>
							<input
								id="modal-checkout"
								type="date"
								min={bookingState.checkInDate || today}
								value={bookingState.checkOutDate}
								oninput={(e) => {
									const val = (e.target as HTMLInputElement).value;
									bookingState.setDates(bookingState.checkInDate, val);
								}}
								class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
							/>
						</div>
					</div>

					<!-- Step 2: Guests -->
					<div>
						<label for="modal-guests" class="block text-xs font-medium uppercase text-muted-foreground">Guests</label>
						<div id="modal-guests" class="mt-1 flex items-center gap-3">
							<button
								onclick={() => bookingState.setGuests(bookingState.guestCount - 1)}
								disabled={bookingState.guestCount <= 1}
								class="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
								aria-label="Decrease guests"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
								</svg>
							</button>
							<span class="min-w-[3rem] text-center text-sm font-semibold text-foreground">
								{bookingState.guestCount} {bookingState.guestCount === 1 ? 'guest' : 'guests'}
							</span>
							<button
								onclick={() => bookingState.setGuests(bookingState.guestCount + 1)}
								disabled={bookingState.guestCount >= (property?.maxGuests ?? 10)}
								class="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
								aria-label="Increase guests"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
								</svg>
							</button>
						</div>
					</div>

					<!-- Price breakdown -->
					{#if bookingState.nightCount > 0}
						<div class="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">
									&#3647;{pricePerNight.toLocaleString()} &times; {bookingState.nightCount} night{bookingState.nightCount > 1 ? 's' : ''}
								</span>
								<span class="text-foreground">&#3647;{totalBeforeDiscount.toLocaleString()}</span>
							</div>
							{#if bookingState.discountActive}
								<div class="flex justify-between text-sm text-green-600 dark:text-green-400">
									<span>{DISCOUNT_PERCENT}% direct booking discount</span>
									<span>-&#3647;{discountAmount.toLocaleString()}</span>
								</div>
							{/if}
							<div class="border-t border-border pt-2">
								<div class="flex justify-between font-semibold">
									<span class="text-foreground">Total</span>
									<span class="text-foreground">&#3647;{totalPrice.toLocaleString()}</span>
								</div>
							</div>
						</div>
					{/if}

					<!-- Confirm button -->
					<button
						onclick={handleConfirm}
						disabled={!bookingState.checkInDate || !bookingState.checkOutDate || bookingState.nightCount <= 0}
						class="w-full rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-sky-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:from-gray-400 disabled:to-gray-500"
					>
						{#if bookingState.nightCount > 0 && bookingState.discountActive}
							Confirm Booking &mdash; Save &#3647;{discountAmount.toLocaleString()}
						{:else}
							Confirm Booking
						{/if}
					</button>
					<p class="text-center text-[11px] text-muted-foreground">Demo only. No real charge.</p>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@keyframes modal-up {
		from {
			opacity: 0;
			transform: translateY(24px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes success-bounce {
		0% { transform: scale(0.5); opacity: 0; }
		50% { transform: scale(1.15); }
		100% { transform: scale(1); opacity: 1; }
	}

	:global(.animate-modal-up) {
		animation: modal-up 0.3s ease-out;
	}

	:global(.animate-success-bounce) {
		animation: success-bounce 0.5s ease-out;
	}
</style>
