<script lang="ts">
	import TrustBadge from './TrustBadge.svelte';

	let {
		isSuperhost,
		totalReviews,
		overallRating
	}: {
		isSuperhost: boolean;
		totalReviews: number;
		overallRating: number;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if isSuperhost}
		<TrustBadge type="superhost" />
	{/if}
	{#if overallRating >= 4.9}
		<TrustBadge type="top-rated" />
	{/if}
	<TrustBadge type="verified" />
	<TrustBadge type="instant" />
	{#if totalReviews >= 50}
		<span class="text-xs font-medium text-muted-foreground">{totalReviews}+ 5-star stays</span>
	{/if}
</div>
