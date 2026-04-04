<script lang="ts">
	import { getAvailability } from '$lib/data/urgency';

	let { propertyId, class: className = '' }: { propertyId: string; class?: string } = $props();

	const count = $derived(getAvailability(propertyId));
	const isUrgent = $derived(count <= 4);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm urgency-pulse {isUrgent ? 'bg-red-500' : 'bg-amber-500'} {className}"
>
	<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
	</svg>
	Only {count} dates left this month
</span>

<style>
	@keyframes urgency-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.85; }
	}
	.urgency-pulse {
		animation: urgency-pulse 2s ease-in-out infinite;
	}
</style>
