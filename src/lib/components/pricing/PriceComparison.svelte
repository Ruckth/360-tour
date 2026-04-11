<script lang="ts">
	import { pricingState } from '$lib/stores/pricing.svelte';
	import { goto } from '$app/navigation';
	let {
		propertyId,
		onopen360
	}: {
		propertyId: string;
		onopen360: () => void;
	} = $props();

	$effect(() => {
		pricingState.init(propertyId);
	});
</script>

<div class="rounded-xl border border-border bg-card shadow-lg md:rounded-2xl">
	<div class="rounded-t-xl border-b-2 border-primary bg-primary/5 p-4 dark:bg-primary/10 md:rounded-t-2xl md:p-6">
		<div class="flex items-center gap-2">
			<span
				class="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground"
			>
				Direct Booking
			</span>
			<span class="text-[10px] font-medium text-gold">
				No hidden fees
			</span>
		</div>
		<div class="mt-3 flex items-baseline gap-1.5">
			<span class="text-3xl font-bold text-foreground md:text-4xl">
				&#3647;{pricingState.directRate.toLocaleString()}
			</span>
			<span class="text-sm text-muted-foreground">/night</span>
		</div>
		<div class="mt-1.5 text-xs text-muted-foreground">
			&#3647;{pricingState.directTotal.toLocaleString()} total for {pricingState.nights} night{pricingState.nights > 1 ? 's' : ''}
			<span class="ml-1 font-medium text-gold">+ Exclusive perks</span>
		</div>
	</div>

	<div class="border-b border-border p-4 md:p-6">
		<div class="flex gap-4">
			<div class="flex-1">
				<p class="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Nights
				</p>
				<div class="flex items-center gap-2">
					<button
						onclick={() => pricingState.setNights(pricingState.nights - 1)}
						disabled={pricingState.nights <= 1}
						class="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-base font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed md:h-8 md:w-8 md:text-sm"
						aria-label="Fewer nights"
					>
						-
					</button>
					<span class="min-w-[2rem] text-center text-sm font-semibold text-card-foreground">
						{pricingState.nights}
					</span>
					<button
						onclick={() => pricingState.setNights(pricingState.nights + 1)}
						disabled={pricingState.nights >= 14}
						class="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-base font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed md:h-8 md:w-8 md:text-sm"
						aria-label="More nights"
					>
						+
					</button>
				</div>
			</div>

			<div class="flex-1">
				<p class="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Guests
				</p>
				<div class="flex items-center gap-2">
					<button
						onclick={() => pricingState.setGuests(pricingState.guests - 1)}
						disabled={pricingState.guests <= 1}
						class="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-base font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed md:h-8 md:w-8 md:text-sm"
						aria-label="Fewer guests"
					>
						-
					</button>
					<span class="min-w-[2rem] text-center text-sm font-semibold text-card-foreground">
						{pricingState.guests}
					</span>
					<button
						onclick={() => pricingState.setGuests(pricingState.guests + 1)}
						disabled={pricingState.guests >= 10}
						class="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-base font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed md:h-8 md:w-8 md:text-sm"
						aria-label="More guests"
					>
						+
					</button>
				</div>
			</div>
		</div>
	</div>

	<div class="p-4 md:p-6">
		<button
			onclick={() => goto('/booking?unit=' + propertyId)}
			class="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-lg transition hover:bg-primary/90 hover:shadow-xl active:scale-[0.98] md:py-3.5 md:text-base"
		>
			Book
		</button>

		<button
			onclick={onopen360}
			class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold text-card-foreground transition hover:bg-muted md:mt-3 md:py-3 md:text-sm"
		>
			<svg class="h-4 w-4 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
				/>
			</svg>
			Take 360 Tour
		</button>

		<div class="mt-4 space-y-1.5">
			<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<svg class="h-3.5 w-3.5 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
				Free airport pickup
			</div>
			<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<svg class="h-3.5 w-3.5 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
				Late checkout &amp; welcome basket
			</div>
			<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<svg class="h-3.5 w-3.5 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
				Direct WhatsApp support
			</div>
		</div>

		<p class="mt-3 text-center text-xs text-muted-foreground">You won't be charged yet</p>
	</div>
</div>
