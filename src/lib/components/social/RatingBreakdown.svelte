<script lang="ts">
	import type { RatingBreakdown as RatingBreakdownType } from '$lib/data/reviews';
	import StarRating from './StarRating.svelte';

	let {
		overallRating,
		totalReviews,
		breakdown
	}: {
		overallRating: number;
		totalReviews: number;
		breakdown: RatingBreakdownType;
	} = $props();

	const categories = $derived([
		{ label: 'Cleanliness', value: breakdown.cleanliness },
		{ label: 'Accuracy', value: breakdown.accuracy },
		{ label: 'Communication', value: breakdown.communication },
		{ label: 'Location', value: breakdown.location },
		{ label: 'Check-in', value: breakdown.checkIn },
		{ label: 'Value', value: breakdown.value }
	]);
</script>

<div class="flex flex-col gap-6 md:flex-row md:gap-10">
	<div class="flex flex-col items-center gap-1 md:min-w-[120px]">
		<span class="text-5xl font-bold text-foreground">{overallRating}</span>
		<StarRating rating={overallRating} size="md" />
		<span class="text-sm text-muted-foreground">{totalReviews} reviews</span>
	</div>
	<div class="flex-1 space-y-3">
		{#each categories as cat (cat.label)}
			<div class="flex items-center gap-3">
				<span class="w-28 flex-shrink-0 text-sm text-foreground">{cat.label}</span>
				<div class="h-2 flex-1 overflow-hidden rounded-full bg-muted">
					<div class="h-full rounded-full bg-foreground transition-all duration-500" style="width: {(cat.value / 5) * 100}%"></div>
				</div>
				<span class="w-8 text-right text-sm font-medium text-muted-foreground">{cat.value}</span>
			</div>
		{/each}
	</div>
</div>
