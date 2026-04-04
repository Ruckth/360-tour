<script lang="ts">
	import type { ConciergeMessage } from '$lib/data/concierge';
	import { properties } from '$lib/data/properties';
	import { conciergeState } from '$lib/stores/concierge.svelte';
	import ConciergeAvatar from './ConciergeAvatar.svelte';

	let { message }: { message: ConciergeMessage } = $props();

	const isConcierge = $derived(message.sender === 'concierge');

	function handleQuickReply(reply: string) {
		conciergeState.addUserMessage(reply);
	}

	let guests = $state(1);
	const currentProperty = $derived(
		conciergeState.currentPropertyId
			? properties.find((p) => p.id === conciergeState.currentPropertyId)
			: properties[0]
	);

	function incrementGuests() {
		if (currentProperty && guests < currentProperty.maxGuests) guests++;
	}

	function decrementGuests() {
		if (guests > 1) guests--;
	}

	function handleBookNow() {
		conciergeState.addUserMessage(
			`I'd like to book the ${currentProperty?.name ?? 'property'}!`
		);
	}
</script>

<div class="px-4 py-1 {isConcierge ? '' : 'flex justify-end'}">
	{#if isConcierge}
		<div class="flex items-end gap-2">
			<ConciergeAvatar size="sm" />
			<div class="max-w-[75%]">
				<div
					class="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200"
				>
					{message.content}
				</div>

				{#if message.type === 'booking-widget' && currentProperty}
					<div class="mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
						<div class="p-3">
							<div class="flex items-baseline justify-between">
								<h4 class="text-sm font-semibold text-card-foreground">
									{currentProperty.name}
								</h4>
								<span class="text-sm font-bold text-card-foreground">
									&#3647;{currentProperty.pricePerNight.toLocaleString()}<span
										class="text-xs font-normal text-muted-foreground">/night</span
									>
								</span>
							</div>
							<div class="mt-2 grid grid-cols-2 gap-2">
								<div class="rounded-lg border border-border px-2.5 py-1.5">
									<p class="text-[10px] font-medium uppercase text-muted-foreground">
										Check-in
									</p>
									<p class="text-xs text-card-foreground">Select date</p>
								</div>
								<div class="rounded-lg border border-border px-2.5 py-1.5">
									<p class="text-[10px] font-medium uppercase text-muted-foreground">
										Check-out
									</p>
									<p class="text-xs text-card-foreground">Select date</p>
								</div>
							</div>
							<div
								class="mt-2 flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5"
							>
								<p class="text-[10px] font-medium uppercase text-muted-foreground">Guests</p>
								<div class="flex items-center gap-2">
									<button
										onclick={decrementGuests}
										class="flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-card-foreground transition hover:bg-muted"
										disabled={guests <= 1}
									>
										-
									</button>
									<span class="text-xs font-medium text-card-foreground">{guests}</span>
									<button
										onclick={incrementGuests}
										class="flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-card-foreground transition hover:bg-muted"
										disabled={guests >= (currentProperty?.maxGuests ?? 4)}
									>
										+
									</button>
								</div>
							</div>
							<button
								onclick={handleBookNow}
								class="mt-2 w-full rounded-lg bg-sky-500 py-2 text-xs font-semibold text-white transition hover:bg-sky-600"
							>
								Book Now
							</button>
						</div>
					</div>
				{/if}

				{#if message.type === 'property-card'}
					<div class="mt-2 flex flex-col gap-2">
						{#each properties as prop}
							<a
								href="/rooms/{prop.id}"
								class="flex items-center gap-3 rounded-xl border border-border bg-card p-2 transition hover:bg-muted"
							>
								<img
									src={prop.images[0]}
									alt={prop.name}
									class="h-14 w-14 rounded-lg object-cover"
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-semibold text-card-foreground">
										{prop.name}
									</p>
									<p class="truncate text-xs text-muted-foreground">{prop.tagline}</p>
									<p class="text-xs font-bold text-sky-500">
										&#3647;{prop.pricePerNight.toLocaleString()}/night
									</p>
								</div>
							</a>
						{/each}
					</div>
				{/if}

				{#if message.type === 'quick-replies' && message.quickReplies}
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each message.quickReplies as reply}
							<button
								onclick={() => handleQuickReply(reply)}
								class="rounded-full border border-sky-500 px-3 py-1 text-xs font-medium text-sky-500 transition hover:bg-sky-50 dark:hover:bg-sky-950"
							>
								{reply}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="max-w-[75%]">
			<div class="rounded-2xl rounded-tr-sm bg-sky-500 px-4 py-2.5 text-sm text-white">
				{message.content}
			</div>
		</div>
	{/if}
</div>
