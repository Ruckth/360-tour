<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from 'convex/_generated/api';
	import { CheckCircle } from '@lucide/svelte';

	const client = useConvexClient();

	let status = $state<'loading' | 'confirmed' | 'error'>('loading');
	let booking = $state<any>(null);
	let errorMessage = $state('');

	onMount(async () => {
		const sessionId = new URLSearchParams(window.location.search).get('session_id');

		if (!sessionId) {
			status = 'error';
			errorMessage = 'No session ID found.';
			return;
		}

		try {
			// Verify payment with Stripe and update booking
			const result = await client.action(api.stripe.handleWebhook, {
				stripeSessionId: sessionId
			});

			if (result.status === 'paid') {
				// Fetch the confirmed booking
				const bookingData = await client.query(api.bookings.getByStripeSession, {
					stripeSessionId: sessionId
				});

				if (bookingData) {
					booking = bookingData;
					status = 'confirmed';

					// Send confirmation emails (fire and forget)
					const property = await client.query(api.properties.getById, {
						id: bookingData.propertyId
					});

					if (property) {
						client.action(api.emails.sendBookingConfirmation, {
							guestName: bookingData.guestName,
							guestEmail: bookingData.guestEmail,
							propertyName: property.name,
							checkIn: bookingData.checkIn,
							checkOut: bookingData.checkOut,
							nights: bookingData.nights,
							guests: bookingData.guests,
							total: bookingData.total,
							currency: bookingData.currency
						});

						client.action(api.emails.sendOwnerNotification, {
							guestName: bookingData.guestName,
							guestEmail: bookingData.guestEmail,
							guestPhone: bookingData.guestPhone,
							propertyName: property.name,
							checkIn: bookingData.checkIn,
							checkOut: bookingData.checkOut,
							nights: bookingData.nights,
							guests: bookingData.guests,
							total: bookingData.total,
							currency: bookingData.currency
						});
					}
				} else {
					status = 'error';
					errorMessage = 'Booking not found.';
				}
			} else {
				status = 'error';
				errorMessage = 'Payment was not completed.';
			}
		} catch (err) {
			status = 'error';
			errorMessage = err instanceof Error ? err.message : 'Something went wrong.';
		}
	});
</script>

<svelte:head>
	<title>Booking {status === 'confirmed' ? 'Confirmed' : 'Processing'} — Seaview Residence</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="mx-auto max-w-md text-center">
		{#if status === 'loading'}
			<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center">
				<svg class="h-10 w-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
				</svg>
			</div>
			<h1 class="text-2xl font-bold text-foreground">Processing your booking...</h1>
			<p class="mt-2 text-muted-foreground">Please wait while we confirm your payment.</p>

		{:else if status === 'confirmed' && booking}
			<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 animate-success-bounce">
				<CheckCircle class="h-8 w-8 text-green-600 dark:text-green-400" />
			</div>
			<h1 class="text-2xl font-bold text-foreground">Booking Confirmed!</h1>
			<p class="mt-2 text-muted-foreground">
				Thank you, {booking.guestName}. Your stay has been reserved.
			</p>

			<div class="mt-6 rounded-xl border border-border bg-card p-5 text-left">
				<div class="space-y-3">
					<div class="flex justify-between text-sm">
						<span class="text-muted-foreground">Dates</span>
						<span class="font-medium text-foreground">{booking.checkIn} &rarr; {booking.checkOut}</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted-foreground">Nights</span>
						<span class="font-medium text-foreground">{booking.nights}</span>
					</div>
					<div class="flex justify-between text-sm">
						<span class="text-muted-foreground">Guests</span>
						<span class="font-medium text-foreground">{booking.guests}</span>
					</div>
					<div class="border-t border-border pt-3">
						<div class="flex justify-between">
							<span class="font-semibold text-foreground">Total Paid</span>
							<span class="font-bold text-primary">&#3647;{booking.total.toLocaleString()}</span>
						</div>
					</div>
				</div>
			</div>

			<p class="mt-4 text-sm text-muted-foreground">
				A confirmation email has been sent to {booking.guestEmail}.
			</p>

			<a
				href="/"
				class="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
			>
				Back to Home
			</a>

		{:else}
			<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
				<svg class="h-8 w-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</div>
			<h1 class="text-2xl font-bold text-foreground">Something went wrong</h1>
			<p class="mt-2 text-muted-foreground">{errorMessage}</p>
			<a
				href="/"
				class="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
			>
				Back to Home
			</a>
		{/if}
	</div>
</div>

<style>
	@keyframes success-bounce {
		0% { transform: scale(0.5); opacity: 0; }
		50% { transform: scale(1.15); }
		100% { transform: scale(1); opacity: 1; }
	}

	:global(.animate-success-bounce) {
		animation: success-bounce 0.5s ease-out;
	}
</style>
