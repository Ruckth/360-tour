<script lang="ts">
	const outlets = ['TripAdvisor', 'Lonely Planet', 'Conde Nast Traveler', 'The Guardian Travel'];
</script>

<div class="flex items-center gap-2 overflow-x-auto py-2">
	<span class="flex-shrink-0 text-xs font-medium text-muted-foreground">As featured in</span>
	{#each outlets as outlet, i (outlet)}
		{#if i > 0}
			<span class="text-muted-foreground/40">|</span>
		{/if}
		<span class="flex-shrink-0 text-xs font-semibold text-muted-foreground/60">{outlet}</span>
	{/each}
</div>
