<script lang="ts">
	import { pricingState } from '$lib/stores/pricing.svelte';
	import SavingsBadge from './SavingsBadge.svelte';

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

	let expandedOta = $state<string | null>(null);

	function toggleOtaExpand(platform: string) {
		expandedOta = expandedOta === platform ? null : platform;
	}
</script>

<div class="rounded-xl border border-border bg-card shadow-lg md:rounded-2xl">
	<div class="rounded-t-xl border-b-2 border-emerald-500 bg-emerald-500/5 p-4 dark:bg-emerald-500/10 md:rounded-t-2xl md:p-6">
		<div class="flex items-center gap-2">
			<span
				class="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
			>
				Best Price
			</span>
			<span class="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
				Direct Booking
			</span>
		</div>
		<div class="mt-3 flex items-baseline gap-1.5">
			<span class="text-3xl font-bold text-emerald-600 dark:text-emerald-400 md:text-4xl">
				&#3647;{pricingState.directRate.toLocaleString()}
			</span>
			<span class="text-sm text-muted-foreground">/night</span>
		</div>
		<div class="mt-1.5 text-xs text-muted-foreground">
			&#3647;{pricingState.directTotal.toLocaleString()} total for {pricingState.nights} night{pricingState.nights > 1 ? 's' : ''}
			<span class="ml-1 font-medium text-emerald-600 dark:text-emerald-400">- No extra fees</span>
		</div>
	</div>

	<div class="border-b border-border p-4 md:p-6">
		<p class="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
			Compare with OTAs
		</p>
		<div class="space-y-2">
			{#each pricingState.otaTotals as ota (ota.platform)}
				<button
					onclick={() => toggleOtaExpand(ota.platform)}
					class="w-full rounded-lg border border-border bg-muted/30 p-3 text-left transition hover:bg-muted/50"
				>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="flex h-6 w-6 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">{ota.logo}</span>
							<span class="text-xs font-medium text-muted-foreground">{ota.displayName}</span>
						</div>
						<div class="text-right">
							<span class="text-sm font-semibold text-muted-foreground line-through decoration-red-400">
								&#3647;{ota.total.toLocaleString()}
							</span>
							<span class="ml-2 text-[10px] text-red-500 dark:text-red-400">
								+&#3647;{(ota.total - pricingState.directTotal).toLocaleString()}
							</span>
						</div>
					</div>

					{#if expandedOta === ota.platform}
						<div class="mt-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
							<div class="flex justify-between">
								<span>&#3647;{ota.nightlyRate.toLocaleString()} x {pricingState.nights} nights</span>
								<span>&#3647;{ota.subtotal.toLocaleString()}</span>
							</div>
							<div class="flex justify-between text-red-500 dark:text-red-400">
								<span>Service fee</span>
								<span>+&#3647;{ota.serviceFee.toLocaleString()}</span>
							</div>
							<div class="flex justify-between text-red-500 dark:text-red-400">
								<span>Cleaning fee</span>
								<span>+&#3647;{ota.cleaningFee.toLocaleString()}</span>
							</div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<div class="border-b border-border p-4 md:p-6">
		<div class="flex gap-4">
			<div class="flex-1">
				<label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Nights
				</label>
				<div class="flex items-center gap-2">
					<button
						onclick={() => pricingState.setNights(pricingState.nights - 1)}
						disabled={pricingState.nights <= 1}
						class="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
					>
						-
					</button>
					<span class="min-w-[2rem] text-center text-sm font-semibold text-card-foreground">
						{pricingState.nights}
					</span>
					<button
						onclick={() => pricingState.setNights(pricingState.nights + 1)}
						disabled={pricingState.nights >= 14}
						class="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
					>
						+
					</button>
				</div>
			</div>

			<div class="flex-1">
				<label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Guests
				</label>
				<div class="flex items-center gap-2">
					<button
						onclick={() => pricingState.setGuests(pricingState.guests - 1)}
						disabled={pricingState.guests <= 1}
						class="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
					>
						-
					</button>
					<span class="min-w-[2rem] text-center text-sm font-semibold text-card-foreground">
						{pricingState.guests}
					</span>
					<button
						onclick={() => pricingState.setGuests(pricingState.guests + 1)}
						disabled={pricingState.guests >= 10}
						class="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm font-medium text-card-foreground transition hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
					>
						+
					</button>
				</div>
			</div>
		</div>
	</div>

	<div class="p-4 md:p-6">
		<div class="mb-3 flex justify-center">
			<SavingsBadge amount={pricingState.maxSavings} />
		</div>

		<button
			class="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 text-sm font-bold text-white shadow-lg transition hover:from-emerald-600 hover:to-emerald-700 hover:shadow-xl active:scale-[0.98] md:py-3.5 md:text-base"
		>
			Book Direct Now
		</button>

		<button
			onclick={onopen360}
			class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-xs font-semibold text-card-foreground transition hover:bg-muted md:mt-3 md:py-3 md:text-sm"
		>
			<svg class="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
					d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
				/>
			</svg>
			Take 360 Tour
		</button>

		<div class="mt-4 flex items-center justify-center gap-1.5">
			<svg
				class="h-4 w-4 text-emerald-500"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
				/>
			</svg>
			<span class="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
				Best Price Guarantee
			</span>
		</div>

		<p class="mt-2 text-center text-xs text-muted-foreground">You won't be charged yet</p>
	</div>
</div>
