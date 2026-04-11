<script lang="ts">
	import { onMount } from 'svelte';
	import { getPricingByPropertyId } from '$lib/data/pricing';

	let { propertyId }: { propertyId: string } = $props();

	let visible = $state(false);
	const pricing = $derived(getPricingByPropertyId(propertyId));

	onMount(() => {
		const timer = setTimeout(() => {
			visible = true;
		}, 3000);
		return () => clearTimeout(timer);
	});
</script>

{#if visible && pricing}
	<div
		class="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2 animate-fade-in md:bottom-16"
	>
		<div
			class="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-md"
		>
			<svg
				class="h-3.5 w-3.5 text-gold"
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
			<span class="text-xs font-medium text-white/80">
				Book direct for exclusive perks
			</span>
			<span class="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold">
				&#3647;{pricing.directRate.toLocaleString()}/night
			</span>
		</div>
	</div>
{/if}
