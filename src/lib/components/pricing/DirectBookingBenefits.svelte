<script lang="ts">
	import { getPricingByPropertyId } from '$lib/data/pricing';

	let { propertyId }: { propertyId: string } = $props();

	let expanded = $state(true);
	const pricing = $derived(getPricingByPropertyId(propertyId));
	const benefits = $derived(pricing?.directBenefits ?? []);
	const otaNames = $derived(pricing?.otaPricing.map((o) => o.displayName) ?? []);
</script>

{#if benefits.length > 0}
	<div class="mt-8">
		<button
			onclick={() => (expanded = !expanded)}
			class="flex w-full items-center justify-between text-left"
		>
			<h2 class="text-lg font-semibold text-foreground">Why Book Direct?</h2>
			<svg
				class="h-5 w-5 text-muted-foreground transition-transform duration-200 {expanded ? 'rotate-180' : ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>

		{#if expanded}
			<div class="mt-4 overflow-x-auto rounded-xl border border-border">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-border bg-muted/50">
							<th class="px-3 py-2.5 text-xs font-medium text-muted-foreground md:px-4">Benefit</th>
							<th class="px-3 py-2.5 text-center text-xs font-medium text-emerald-600 dark:text-emerald-400 md:px-4">
								Direct
							</th>
							{#each otaNames as name}
								<th class="hidden px-3 py-2.5 text-center text-xs font-medium text-muted-foreground sm:table-cell md:px-4">
									{name}
								</th>
							{/each}
							<th class="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground sm:hidden md:px-4">
								OTAs
							</th>
						</tr>
					</thead>
					<tbody>
						{#each benefits as item, i}
							<tr class="border-b border-border/50 last:border-b-0 {i % 2 === 0 ? 'bg-card' : 'bg-muted/20'}">
								<td class="px-3 py-2.5 text-xs text-card-foreground md:px-4 md:text-sm">
									{item.benefit}
									{#if item.directOnly}
										<span class="ml-1 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
											Exclusive
										</span>
									{/if}
								</td>
								<td class="px-3 py-2.5 text-center md:px-4">
									<svg class="mx-auto h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
									</svg>
								</td>
								{#each otaNames as _name}
									<td class="hidden px-3 py-2.5 text-center sm:table-cell md:px-4">
										{#if item.directOnly}
											<svg class="mx-auto h-4 w-4 text-red-400 dark:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
											</svg>
										{:else}
											<svg class="mx-auto h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
											</svg>
										{/if}
									</td>
								{/each}
								<td class="px-3 py-2.5 text-center sm:hidden md:px-4">
									{#if item.directOnly}
										<svg class="mx-auto h-4 w-4 text-red-400 dark:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
										</svg>
									{:else}
										<svg class="mx-auto h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
										</svg>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}
