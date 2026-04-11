<script lang="ts">
	import { page } from '$app/state';
	import { resort } from '$lib/data/resort-config';
	import { DatePickerField } from '$lib/components/ui/date-picker';
	import { today, getLocalTimeZone, CalendarDate, type DateValue } from '@internationalized/date';
	import { useConvexClient } from 'convex-svelte';
	import { api } from 'convex/_generated/api';
	import { Shield, CreditCard, Clock, CheckCircle, ArrowLeft, User, Mail, Phone } from '@lucide/svelte';

	const client = useConvexClient();

	// ── All UI state is local $state (no class singleton) ──
	type Step = 'unit' | 'dates' | 'guests' | 'info' | 'review';

	let currentStep = $state<Step>('unit');
	let selectedId = $state('');
	let checkInValue = $state<DateValue | undefined>(undefined);
	let checkOutValue = $state<DateValue | undefined>(undefined);
	let guestCount = $state(1);
	let guestName = $state('');
	let guestEmail = $state('');
	let guestPhone = $state('');
	let isSubmitting = $state(false);
	let paymentError = $state('');
	let unitError = $state('');
	let confirmed = $state(false);
	let showConfetti = $state(false);

	let propertiesLoading = $state(true);
	let propertiesError = $state('');
	let propertyList = $state<any[]>([]);
	let didLoadProperties = false;

	// ── Derived ──
	const property = $derived(propertyList.find((p) => p.slug === selectedId));
	const pricePerNight = $derived(property?.pricePerNight ?? 0);
	const discountPercent = $derived(property?.directDiscountPercent ?? 0);
	const todayDate = today(getLocalTimeZone());
	const checkOutMin = $derived(checkInValue ?? todayDate);

	const checkInStr = $derived(
		checkInValue
			? `${checkInValue.year}-${String(checkInValue.month).padStart(2, '0')}-${String(checkInValue.day).padStart(2, '0')}`
			: ''
	);
	const checkOutStr = $derived(
		checkOutValue
			? `${checkOutValue.year}-${String(checkOutValue.month).padStart(2, '0')}-${String(checkOutValue.day).padStart(2, '0')}`
			: ''
	);
	const nightCount = $derived(
		!checkInStr || !checkOutStr
			? 0
			: Math.max(0, Math.round((new Date(checkOutStr).getTime() - new Date(checkInStr).getTime()) / 86400000))
	);
	const subtotal = $derived(pricePerNight * nightCount);
	const discount = $derived(Math.round(subtotal * (discountPercent / 100)));
	const total = $derived(subtotal - discount);

	const infoValid = $derived(
		guestName.trim().length >= 2 &&
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) &&
		guestPhone.trim().length >= 6
	);

	const steps: { key: Step; label: string }[] = [
		{ key: 'unit', label: 'Villa' },
		{ key: 'dates', label: 'Dates' },
		{ key: 'guests', label: 'Guests' },
		{ key: 'info', label: 'Details' },
		{ key: 'review', label: 'Pay' }
	];
	const stepIdx = $derived(steps.findIndex((s) => s.key === currentStep));

	// ── Load properties from Convex ──
	$effect(() => {
		if (didLoadProperties) return;
		didLoadProperties = true;

		void (async () => {
			propertiesLoading = true;
			propertiesError = '';
			try {
				const props = await client.query(api.properties.list, {});
				propertyList = Array.isArray(props) ? (props as any[]) : [];
			} catch (err) {
				propertiesError =
					err instanceof Error ? err.message : 'Failed to load villas. Please refresh and try again.';
				propertyList = [];
			} finally {
				propertiesLoading = false;
			}
		})();
	});

	// ── Init from URL on first render ──
	let didInit = false;
	$effect(() => {
		// read page.url so the effect tracks it
		const u = page.url.searchParams.get('unit');
		if (didInit) return;
		didInit = true;

		unitError = '';
		if (u) {
			selectedId = u;
			currentStep = 'dates';
		}
		const ci = page.url.searchParams.get('checkin');
		const co = page.url.searchParams.get('checkout');
		const g = page.url.searchParams.get('guests');
		if (ci) {
			const [y, m, d] = ci.split('-').map(Number);
			if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
				checkInValue = new CalendarDate(y, m, d);
			}
		}
		if (co) {
			const [y, m, d] = co.split('-').map(Number);
			if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
				checkOutValue = new CalendarDate(y, m, d);
			}
		}
		if (g) {
			const n = Number(g);
			if (Number.isFinite(n)) guestCount = Math.max(1, Math.floor(n));
		}
	});

	// If URL specifies an invalid slug, recover gracefully once properties load.
	$effect(() => {
		if (propertiesLoading) return;
		if (!selectedId) return;
		if (property) return;
		unitError = 'Villa not found. Please choose another.';
		currentStep = 'unit';
		selectedId = '';
	});

	// ── Actions ──
	function selectUnit(id: string) {
		unitError = '';
		selectedId = id;
		currentStep = 'dates';
	}

	function goBack() {
		const keys = steps.map((s) => s.key);
		const i = keys.indexOf(currentStep);
		if (i > 0) currentStep = keys[i - 1];
	}

	function nextFromDates() {
		if (property && checkInStr && checkOutStr && nightCount > 0) currentStep = 'guests';
	}
	function nextFromGuests() { currentStep = 'info'; }
	function nextFromInfo() { currentStep = 'review'; }
	function goToUnit() { currentStep = 'unit'; selectedId = ''; }

	async function confirmAndPay() {
		if (!property) return;
		isSubmitting = true;
		paymentError = '';

		try {
			const bookingId = await client.mutation(api.bookings.create, {
				propertySlug: selectedId,
				guestName: guestName.trim(),
				guestEmail: guestEmail.trim(),
				guestPhone: guestPhone.trim(),
				checkIn: checkInStr,
				checkOut: checkOutStr,
				guests: guestCount
			});

			const stripeResult = await client.action(api.stripe.createCheckoutSession, {
				bookingId,
				successUrl: `${window.location.origin}/booking/success`,
				cancelUrl: `${window.location.origin}/booking?unit=${selectedId}`
			});

			if (stripeResult.url) {
				window.location.href = stripeResult.url;
			} else {
				throw new Error('Unable to start checkout. Please try again.');
			}
		} catch (err) {
			paymentError = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
			isSubmitting = false;
		}
	}

	function demoConfirm() {
		confirmed = true;
		showConfetti = true;
		setTimeout(() => { showConfetti = false; }, 3000);
	}
</script>

<svelte:head>
	<title>Book — {resort.name}</title>
</svelte:head>

<div class="min-h-screen bg-background pt-20 pb-12 md:pt-24">
	<div class="mx-auto max-w-3xl px-4 md:px-6">

		<!-- Progress bar -->
		<div class="mb-8">
			<div class="flex gap-1">
				{#each steps as step, i}
					<div class="flex-1">
						<div class="h-1 rounded-full transition-colors {i <= stepIdx ? 'bg-primary' : 'bg-muted'}"></div>
					</div>
				{/each}
			</div>
			<div class="mt-2 flex justify-between">
				{#each steps as step, i}
					<span class="text-[10px] font-medium {i <= stepIdx ? 'text-primary' : 'text-muted-foreground'}">{step.label}</span>
				{/each}
			</div>
		</div>

		<!-- Back + heading -->
		<div class="mb-6 flex items-center gap-3">
			{#if currentStep !== 'unit'}
				<button onclick={goBack} class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Go back">
					<ArrowLeft class="h-4 w-4" />
				</button>
			{/if}
			<h1 class="font-serif text-2xl font-semibold text-foreground md:text-3xl">
				{#if currentStep === 'unit'}
					Choose Your Villa
				{:else if property}
					{property.name}
				{/if}
			</h1>
		</div>

		{#if confirmed}
			<!-- ✅ Success -->
			<div class="rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
				<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 {showConfetti ? 'animate-bounce' : ''}">
					<CheckCircle class="h-8 w-8 text-green-600 dark:text-green-400" />
				</div>
				<h2 class="text-xl font-bold text-card-foreground">Booking Confirmed!</h2>
				<p class="mt-2 text-sm text-muted-foreground">Your stay at {property?.name} has been booked.</p>
				<p class="mt-1 text-sm text-muted-foreground">{checkInStr} &rarr; {checkOutStr}</p>
				<p class="mt-1 text-sm text-muted-foreground">Confirmation sent to {guestEmail}</p>
				<p class="mt-3 text-lg font-bold text-primary">Total: &#3647;{total.toLocaleString()}</p>
				<a href="/" class="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">Done</a>
			</div>

			{:else if currentStep === 'unit'}
				<!-- 1️⃣ Unit Selection -->
				{#if unitError}
					<div class="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
						{unitError}
					</div>
				{/if}
				{#if propertiesLoading}
					<div class="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-md">
						Loading villas...
					</div>
				{:else if propertiesError}
					<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 shadow-md dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
						{propertiesError}
					</div>
				{:else if propertyList.length === 0}
					<div class="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-md">
						No villas available.
					</div>
				{:else}
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{#each propertyList as prop (prop._id)}
							<button
								onclick={() => selectUnit(prop.slug)}
								class="group relative overflow-hidden rounded-2xl border border-border bg-card text-left shadow-md transition hover:border-primary hover:shadow-xl"
							>
								<div class="relative aspect-[4/3] overflow-hidden">
									<img src={prop.images[0]} alt={prop.name} class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
									<div class="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
									<span class="absolute right-3 top-3 rounded-full bg-green-600 px-2.5 py-0.5 text-[10px] font-bold text-white">Save {prop.directDiscountPercent}%</span>
								</div>
								<div class="p-4">
									<h3 class="font-serif text-lg font-semibold text-card-foreground">{prop.name}</h3>
									<p class="mt-1 text-xs text-muted-foreground">{prop.tagline}</p>
									<div class="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
										<span class="rounded bg-muted px-1.5 py-0.5">{prop.maxGuests} guests</span>
										<span class="rounded bg-muted px-1.5 py-0.5">{prop.bedrooms} bed{prop.bedrooms > 1 ? 's' : ''}</span>
										<span class="rounded bg-muted px-1.5 py-0.5">{prop.area} m&sup2;</span>
									</div>
									<div class="mt-3 flex items-baseline gap-1">
										<span class="text-xl font-bold text-card-foreground">&#3647;{prop.pricePerNight.toLocaleString()}</span>
										<span class="text-xs text-muted-foreground">/night</span>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}

		{:else if currentStep === 'dates'}
			<!-- 2️⃣ Dates -->
			<div class="grid gap-6 lg:grid-cols-[1fr_300px]">
				<div class="min-w-0">
					{#if property}
						<div class="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
							<img src={property.images[0]} alt={property.name} class="h-14 w-14 rounded-lg object-cover" />
							<div class="min-w-0 flex-1">
								<p class="font-semibold text-card-foreground">{property.name}</p>
								<p class="text-xs text-muted-foreground">&#3647;{property.pricePerNight.toLocaleString()}/night</p>
							</div>
							<button onclick={goToUnit} class="text-xs text-primary hover:underline">Change</button>
						</div>
					{/if}

					<div class="space-y-4">
						<h2 class="text-lg font-semibold text-foreground">Select Dates</h2>
						<div class="grid grid-cols-2 gap-3">
							<DatePickerField label="Check-in" bind:value={checkInValue} minValue={todayDate} />
							<DatePickerField label="Check-out" bind:value={checkOutValue} minValue={checkOutMin} />
						</div>

							{#if nightCount > 0}
								<p class="text-sm text-muted-foreground">
									{nightCount} night{nightCount > 1 ? 's' : ''}
									&mdash; <span class="font-medium text-green-600 dark:text-green-400">Save {discountPercent}% booking direct</span>
								</p>
							{/if}

							<button onclick={nextFromDates} disabled={nightCount <= 0 || !property} class="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
								Next
							</button>
					</div>
				</div>
				{@render sidebar()}
			</div>

		{:else if currentStep === 'guests'}
			<!-- 3️⃣ Guests -->
			<div class="grid gap-6 lg:grid-cols-[1fr_300px]">
				<div class="min-w-0">
					{@render unitSummary()}
					<div class="space-y-4">
						<h2 class="text-lg font-semibold text-foreground">How Many Guests?</h2>
						<div>
							<div class="flex items-center gap-3">
								<button onclick={() => { if (guestCount > 1) guestCount--; }} disabled={guestCount <= 1} class="flex h-12 w-12 items-center justify-center rounded-xl border border-border text-foreground transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Fewer guests">
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
								</button>
								<span class="min-w-[5rem] text-center text-lg font-semibold text-foreground">
									{guestCount} {guestCount === 1 ? 'guest' : 'guests'}
								</span>
								<button onclick={() => { if (guestCount < (property?.maxGuests ?? 10)) guestCount++; }} disabled={guestCount >= (property?.maxGuests ?? 10)} class="flex h-12 w-12 items-center justify-center rounded-xl border border-border text-foreground transition hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed" aria-label="More guests">
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
								</button>
							</div>
							{#if property}
								<p class="mt-2 text-xs text-muted-foreground">Max {property.maxGuests} guests for {property.name}</p>
							{/if}
						</div>
						<button onclick={nextFromGuests} class="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-primary/90">Next</button>
					</div>
				</div>
				{@render sidebar()}
			</div>

		{:else if currentStep === 'info'}
			<!-- 4️⃣ Guest Info -->
			<div class="grid gap-6 lg:grid-cols-[1fr_300px]">
				<div class="min-w-0">
					{@render unitSummary()}
					<div class="space-y-4">
						<h2 class="text-lg font-semibold text-foreground">Your Details</h2>
						<p class="text-sm text-muted-foreground">We need your details to confirm the booking.</p>
						<div class="space-y-3">
							<div>
								<label for="guest-name" class="block text-xs font-medium uppercase text-muted-foreground">Full Name</label>
								<div class="relative mt-1">
									<User class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<input id="guest-name" type="text" bind:value={guestName} placeholder="John Smith" class="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
								</div>
							</div>
							<div>
								<label for="guest-email" class="block text-xs font-medium uppercase text-muted-foreground">Email</label>
								<div class="relative mt-1">
									<Mail class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<input id="guest-email" type="email" bind:value={guestEmail} placeholder="john@example.com" class="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
								</div>
							</div>
							<div>
								<label for="guest-phone" class="block text-xs font-medium uppercase text-muted-foreground">Phone / WhatsApp</label>
								<div class="relative mt-1">
									<Phone class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<input id="guest-phone" type="tel" bind:value={guestPhone} placeholder="+66 81 234 5678" class="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
								</div>
							</div>
						</div>
						<button onclick={nextFromInfo} disabled={!infoValid} class="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">Review</button>
					</div>
				</div>
				{@render sidebar()}
			</div>

		{:else if currentStep === 'review'}
			<!-- 5️⃣ Review & Pay -->
			<div class="grid gap-6 lg:grid-cols-[1fr_300px]">
				<div class="min-w-0">
					{@render unitSummary()}
					<div class="space-y-4">
						<h2 class="text-lg font-semibold text-foreground">Review & Pay</h2>

						<div class="space-y-2 rounded-xl border border-border bg-muted/50 p-4">
							<div class="flex justify-between text-sm"><span class="text-muted-foreground">Dates</span><span class="font-medium text-foreground">{checkInStr} &rarr; {checkOutStr}</span></div>
							<div class="flex justify-between text-sm"><span class="text-muted-foreground">Guests</span><span class="font-medium text-foreground">{guestCount} {guestCount === 1 ? 'guest' : 'guests'}</span></div>
							<div class="flex justify-between text-sm"><span class="text-muted-foreground">Name</span><span class="font-medium text-foreground">{guestName}</span></div>
						</div>

						<div class="space-y-2 rounded-xl border border-border bg-muted/50 p-4">
							<div class="flex justify-between text-sm">
								<span class="text-muted-foreground">&#3647;{pricePerNight.toLocaleString()} &times; {nightCount} night{nightCount > 1 ? 's' : ''}</span>
								<span class="text-foreground">&#3647;{subtotal.toLocaleString()}</span>
							</div>
								<div class="flex justify-between text-sm text-green-600 dark:text-green-400">
									<span>{discountPercent}% direct discount</span>
									<span>-&#3647;{discount.toLocaleString()}</span>
								</div>
							<div class="border-t border-border pt-2">
								<div class="flex justify-between font-semibold"><span class="text-foreground">Total</span><span class="text-foreground">&#3647;{total.toLocaleString()}</span></div>
							</div>
						</div>

						<div class="flex items-center justify-center gap-4 py-1">
							<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Shield class="h-3.5 w-3.5 text-green-600 dark:text-green-400" /><span>Secure payment</span></div>
							<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" /><span>Free cancel 48h</span></div>
							<div class="flex items-center gap-1.5 text-xs text-muted-foreground"><CreditCard class="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" /><span>No hidden fees</span></div>
						</div>

						{#if paymentError}
							<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{paymentError}</div>
						{/if}

							<button
								onclick={confirmAndPay}
								disabled={isSubmitting || !property || nightCount <= 0 || !infoValid || guestCount < 1 || guestCount > (property?.maxGuests ?? 10)}
								class="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{#if isSubmitting}
									<span class="inline-flex items-center gap-2">
										<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
										Processing...
								</span>
							{:else}
								Pay &#3647;{total.toLocaleString()}
							{/if}
						</button>

						<button onclick={demoConfirm} class="w-full text-center text-xs text-muted-foreground/60 underline-offset-2 hover:text-muted-foreground hover:underline">Skip payment (demo)</button>
					</div>
				</div>
				{@render sidebar()}
			</div>
		{/if}
	</div>
</div>

<!-- ── Snippets ── -->

{#snippet unitSummary()}
	{#if property}
		<div class="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
			<img src={property.images[0]} alt={property.name} class="h-14 w-14 rounded-lg object-cover" />
			<div class="min-w-0 flex-1">
				<p class="font-semibold text-card-foreground">{property.name}</p>
				<p class="text-xs text-muted-foreground">&#3647;{property.pricePerNight.toLocaleString()}/night</p>
			</div>
			<button onclick={goToUnit} class="text-xs text-primary hover:underline">Change</button>
		</div>
	{/if}
{/snippet}

{#snippet sidebar()}
	<div class="hidden lg:block">
		{#if property}
			<div class="sticky top-24 rounded-2xl border border-border bg-card p-5 shadow-lg">
					<div class="flex items-center gap-2">
						<span class="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">Direct</span>
						<span class="text-[10px] font-medium text-gold">Save {discountPercent}%</span>
					</div>
				<div class="mt-3 flex items-baseline gap-1">
					<span class="text-2xl font-bold text-foreground">&#3647;{pricePerNight.toLocaleString()}</span>
					<span class="text-sm text-muted-foreground">/night</span>
				</div>
				{#if nightCount > 0}
					<div class="mt-3 space-y-1.5 border-t border-border pt-3">
						<div class="flex justify-between text-xs text-muted-foreground">
							<span>{nightCount} night{nightCount > 1 ? 's' : ''}</span>
							<span>&#3647;{subtotal.toLocaleString()}</span>
						</div>
							<div class="flex justify-between text-xs text-green-600 dark:text-green-400">
								<span>-{discountPercent}%</span>
								<span>-&#3647;{discount.toLocaleString()}</span>
							</div>
						<div class="flex justify-between font-semibold text-sm text-foreground border-t border-border pt-1.5">
							<span>Total</span>
							<span>&#3647;{total.toLocaleString()}</span>
						</div>
					</div>
				{/if}
				<div class="mt-4 space-y-1.5">
					<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<svg class="h-3 w-3 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
						Free airport pickup
					</div>
					<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<svg class="h-3 w-3 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
						Late checkout & welcome basket
					</div>
					<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<svg class="h-3 w-3 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
						Direct WhatsApp support
					</div>
				</div>
			</div>
		{/if}
	</div>
{/snippet}
