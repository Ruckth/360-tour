<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from 'convex/_generated/api';
	import { CheckCircle, Download, FileText, Home } from '@lucide/svelte';
	import { resort } from '$lib/data/resort-config';
	import type { BookingDocumentData } from '$lib/utils/booking-documents';

	const client = useConvexClient();

	let status = $state<'loading' | 'confirmed' | 'error'>('loading');
	let booking = $state<any>(null);
	let property = $state<any>(null);
	let errorMessage = $state('');
	let downloading = $state<'invoice' | 'receipt' | ''>('');

	const bookingId = $derived(page.url.searchParams.get('booking_id') ?? '');

	onMount(async () => {
		if (!bookingId) {
			status = 'error';
			errorMessage = 'No booking id found.';
			return;
		}

		try {
			const bookingData = await client.query(api.bookings.getById, { id: bookingId as any });
			if (!bookingData) {
				throw new Error('Booking not found.');
			}
			if (bookingData.paymentStatus !== 'paid') {
				throw new Error('Demo payment is not complete yet.');
			}

			const propertyData = await client.query(api.properties.getById, {
				id: bookingData.propertyId
			});
			booking = bookingData;
			property = propertyData;
			status = 'confirmed';
		} catch (error) {
			status = 'error';
			errorMessage = error instanceof Error ? error.message : 'Something went wrong.';
		}
	});

	const documentData = $derived<BookingDocumentData | undefined>(
		booking && property
			? {
					resortName: resort.name,
					resortAddress: resort.address,
					resortEmail: resort.contactEmail,
					resortPhone: resort.contactPhone,
					propertyName: property.name,
					guestName: booking.guestName,
					guestEmail: booking.guestEmail,
					guestPhone: booking.guestPhone,
					checkIn: booking.checkIn,
					checkOut: booking.checkOut,
					nights: booking.nights,
					guests: booking.guests,
					subtotal: booking.subtotal,
					discountAmount: booking.discountAmount,
					total: booking.total,
					currency: booking.currency,
					confirmationCode: booking.confirmationCode,
					invoiceNumber: booking.invoiceNumber,
					receiptNumber: booking.receiptNumber,
					paidAt: booking.paidAt,
					createdAt: booking.createdAt
				}
			: undefined
	);

	async function downloadInvoice() {
		if (!documentData || downloading) return;
		downloading = 'invoice';
		try {
			const { buildInvoicePdf, downloadPdf } = await import('$lib/utils/booking-documents');
			const bytes = await buildInvoicePdf(documentData);
			downloadPdf(bytes, `${documentData.invoiceNumber ?? 'invoice'}.pdf`);
		} finally {
			downloading = '';
		}
	}

	async function downloadReceipt() {
		if (!documentData || downloading) return;
		downloading = 'receipt';
		try {
			const { buildReceiptPdf, downloadPdf } = await import('$lib/utils/booking-documents');
			const bytes = await buildReceiptPdf(documentData);
			downloadPdf(bytes, `${documentData.receiptNumber ?? 'receipt'}.pdf`);
		} finally {
			downloading = '';
		}
	}

	function paidDate(value: number | undefined) {
		return new Intl.DateTimeFormat('en', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(value ? new Date(value) : new Date());
	}
</script>

<svelte:head>
	<title>Booking {status === 'confirmed' ? 'Confirmed' : 'Processing'} — Seaview Residence</title>
</svelte:head>

<div class="min-h-screen bg-background px-4 pt-20 pb-12 md:pt-24">
	<div class="mx-auto max-w-2xl">
		{#if status === 'loading'}
			<div class="rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
				<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center">
					<svg class="h-10 w-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
					</svg>
				</div>
				<h1 class="text-2xl font-bold text-foreground">Loading your confirmation...</h1>
			</div>
		{:else if status === 'confirmed' && booking}
			<div class="rounded-2xl border border-border bg-card p-6 text-center shadow-lg md:p-8">
				<div class="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 animate-success-bounce">
					<CheckCircle class="h-8 w-8 text-green-600 dark:text-green-400" />
				</div>
				<p class="text-xs font-semibold uppercase tracking-[0.22em] text-gold">Demo payment complete</p>
				<h1 class="mt-2 font-serif text-3xl font-semibold text-foreground">Booking Confirmed</h1>
				<p class="mt-2 text-sm text-muted-foreground">
					Thank you, {booking.guestName}. Your stay has been reserved and your documents are ready.
				</p>

				<div class="mt-6 rounded-xl border border-border bg-muted/40 p-5 text-left">
					<div class="grid gap-3 text-sm sm:grid-cols-2">
						<div>
							<p class="text-xs uppercase text-muted-foreground">Confirmation</p>
							<p class="font-semibold text-foreground">{booking.confirmationCode}</p>
						</div>
						<div>
							<p class="text-xs uppercase text-muted-foreground">Paid</p>
							<p class="font-semibold text-foreground">{paidDate(booking.paidAt)}</p>
						</div>
						<div>
							<p class="text-xs uppercase text-muted-foreground">Villa</p>
							<p class="font-semibold text-foreground">{property?.name ?? 'Villa'}</p>
						</div>
						<div>
							<p class="text-xs uppercase text-muted-foreground">Dates</p>
							<p class="font-semibold text-foreground">{booking.checkIn} → {booking.checkOut}</p>
						</div>
						<div>
							<p class="text-xs uppercase text-muted-foreground">Guests</p>
							<p class="font-semibold text-foreground">{booking.guests}</p>
						</div>
						<div>
							<p class="text-xs uppercase text-muted-foreground">Total paid</p>
							<p class="font-bold text-primary">฿{booking.total.toLocaleString()}</p>
						</div>
					</div>
				</div>

				<div class="mt-5 grid gap-3 sm:grid-cols-2">
					<button
						onclick={downloadInvoice}
						disabled={!!downloading}
						class="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						<FileText class="h-4 w-4" />
						{downloading === 'invoice' ? 'Preparing invoice...' : 'Download Invoice'}
					</button>
					<button
						onclick={downloadReceipt}
						disabled={!!downloading}
						class="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						<Download class="h-4 w-4" />
						{downloading === 'receipt' ? 'Preparing receipt...' : 'Download Receipt'}
					</button>
				</div>

				<a
					href="/"
					class="mt-6 inline-flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
				>
					<Home class="h-4 w-4" />
					Back to Home
				</a>
			</div>
		{:else}
			<div class="rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
				<div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
					<svg class="h-8 w-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</div>
				<h1 class="text-2xl font-bold text-foreground">Something went wrong</h1>
				<p class="mt-2 text-muted-foreground">{errorMessage}</p>
				<a
					href="/booking"
					class="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
				>
					Back to Booking
				</a>
			</div>
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
