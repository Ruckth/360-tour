<script lang="ts">
	import { narrativeState } from '$lib/stores/narrative.svelte';
	import { goto } from '$app/navigation';
	import { getConclusionForProperty } from '$lib/data/tourflow';
	import { DatePickerField } from '$lib/components/ui/date-picker';
	import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import type { Property } from '$lib/data/properties';

	let { property, onclose }: { property: Property; onclose: () => void } = $props();
	let conclusion = $derived(getConclusionForProperty(property.id));
	let guests = $state(2);

	const todayDate = today(getLocalTimeZone());
	let checkInValue = $state<DateValue | undefined>(undefined);
	let checkOutValue = $state<DateValue | undefined>(undefined);
	const checkOutMin = $derived(checkInValue ?? todayDate);

	function incrementGuests() { if (guests < property.maxGuests) guests++; }
	function decrementGuests() { if (guests > 1) guests--; }

	function handleBook() {
		let url = '/booking?unit=' + property.id;
		if (checkInValue && checkOutValue) {
			const ciStr = `${checkInValue.year}-${String(checkInValue.month).padStart(2, '0')}-${String(checkInValue.day).padStart(2, '0')}`;
			const coStr = `${checkOutValue.year}-${String(checkOutValue.month).padStart(2, '0')}-${String(checkOutValue.day).padStart(2, '0')}`;
			url += `&checkin=${ciStr}&checkout=${coStr}`;
		}
		if (guests > 1) {
			url += `&guests=${guests}`;
		}
		goto(url);
	}
</script>

{#if conclusion}
	<div class="conclusion-enter absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm">
		<div class="mx-auto w-full max-w-lg px-5 py-10 md:px-6 md:py-16">
			<button onclick={onclose} class="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white md:right-6 md:top-6" aria-label="Back to tour">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
			</button>

			<div class="relative overflow-hidden rounded-2xl">
				<img src={property.images[0]} alt={property.name} class="aspect-[16/10] w-full object-cover" />
				<div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
				<div class="absolute inset-x-0 bottom-0 px-6 pb-6">
					<p class="text-xs font-medium uppercase tracking-widest text-white/60">{property.name}</p>
					<h2 class="mt-1 font-serif text-3xl font-semibold text-white md:text-4xl" style="text-shadow: 0 2px 12px rgba(0,0,0,0.5);">{conclusion.headline}</h2>
				</div>
			</div>

			<p class="mt-6 text-sm leading-relaxed text-white/80 md:text-base">{conclusion.summary}</p>

			<ul class="mt-5 space-y-2.5">
				{#each conclusion.highlights as highlight}
					<li class="flex items-start gap-3 text-sm text-white/90 md:text-base">
						<svg class="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
						{highlight}
					</li>
				{/each}
			</ul>

			<div class="mt-6 flex items-baseline gap-1.5">
				<span class="text-2xl font-bold text-white md:text-3xl">&#3647;{property.pricePerNight.toLocaleString()}</span>
				<span class="text-sm text-white/50">/night</span>
			</div>

			<div class="mt-5 space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<DatePickerField label="Check-in" bind:value={checkInValue} minValue={todayDate} variant="dark" />
					<DatePickerField label="Check-out" bind:value={checkOutValue} minValue={checkOutMin} variant="dark" />
				</div>
				<div>
					<label for="guests-display" class="mb-1 block text-xs font-medium uppercase tracking-wider text-white/50">Guests</label>
					<div class="flex items-center gap-3">
						<button onclick={decrementGuests} disabled={guests <= 1} aria-label="Fewer guests" class="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
						</button>
						<span id="guests-display" class="min-w-[3rem] text-center text-sm font-medium text-white">{guests} guest{guests > 1 ? 's' : ''}</span>
						<button onclick={incrementGuests} disabled={guests >= property.maxGuests} aria-label="More guests" class="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
						</button>
					</div>
				</div>
			</div>

			<button onclick={handleBook} class="mt-6 w-full rounded-2xl bg-gold py-3.5 text-sm font-semibold text-navy shadow-lg shadow-gold/25 transition-all duration-300 hover:bg-gold-light hover:shadow-gold/40 md:text-base">Book</button>

			<div class="mt-3 text-center">
				<button class="text-sm text-white/50 transition hover:text-white/80" onclick={() => narrativeState.showLeadCapture()}>Save This Dream</button>
			</div>

			<p class="mt-6 text-center font-serif text-sm italic text-white/40" style="text-shadow: 0 1px 4px rgba(0,0,0,0.3);">{conclusion.closingLine}</p>
		</div>
	</div>
{/if}

<style>
	@keyframes conclusion-enter { from { opacity: 0; } to { opacity: 1; } }
	:global(.conclusion-enter) { animation: conclusion-enter 0.8s ease-out forwards; }
</style>
