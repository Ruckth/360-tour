<script lang="ts">
	import type { Review } from '$lib/data/reviews';
	import StarRating from './StarRating.svelte';

	let { review }: { review: Review } = $props();

	let expanded = $state(false);
	const shouldTruncate = $derived(review.body.length > 180);
	const displayBody = $derived(shouldTruncate && !expanded ? review.body.slice(0, 180) + '...' : review.body);

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	}
</script>

<div class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
	<div class="flex items-start gap-3">
		<img src={review.author.avatarUrl} alt={review.author.name} class="h-10 w-10 flex-shrink-0 rounded-full object-cover" />
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="text-sm font-semibold text-foreground">{review.author.name}</span>
				{#if review.verified}
					<span class="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
						<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
						Verified
					</span>
				{/if}
			</div>
			<p class="text-xs text-muted-foreground">{review.author.city}, {review.author.country}</p>
		</div>
	</div>

	<div class="flex items-center gap-2">
		<StarRating rating={review.rating} size="sm" />
		<span class="text-xs text-muted-foreground">{formatDate(review.date)}</span>
	</div>

	<h4 class="text-sm font-bold text-foreground">{review.title}</h4>

	<p class="text-sm leading-relaxed text-muted-foreground">
		{displayBody}
		{#if shouldTruncate}
			<button onclick={() => (expanded = !expanded)} class="ml-1 font-semibold text-foreground underline-offset-2 hover:underline">
				{expanded ? 'Show less' : 'Read more'}
			</button>
		{/if}
	</p>

	{#if review.photos && review.photos.length > 0}
		<div class="flex gap-2">
			{#each review.photos as photo}
				<img src={photo} alt="Guest photo" class="h-16 w-16 rounded-lg object-cover md:h-20 md:w-20" />
			{/each}
		</div>
	{/if}
</div>
