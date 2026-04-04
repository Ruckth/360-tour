<script lang="ts">
	let {
		rating,
		size = 'md',
		showValue = false,
		reviewCount
	}: {
		rating: number;
		size?: 'sm' | 'md' | 'lg';
		showValue?: boolean;
		reviewCount?: number;
	} = $props();

	const sizeClasses = $derived(
		size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'
	);
	const textClasses = $derived(
		size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
	);
	const gapClasses = $derived(size === 'sm' ? 'gap-0.5' : size === 'lg' ? 'gap-1' : 'gap-0.5');

	const stars = $derived(
		Array.from({ length: 5 }, (_, i) => {
			const starValue = i + 1;
			if (rating >= starValue) return 'full';
			if (rating >= starValue - 0.5) return 'half';
			return 'empty';
		})
	);
</script>

<div class="inline-flex items-center {gapClasses}">
	{#each stars as type, i (i)}
		<svg class="{sizeClasses} flex-shrink-0" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			{#if type === 'full'}
				<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" fill="#f59e0b" />
			{:else if type === 'half'}
				<defs>
					<linearGradient id="half-star-{i}">
						<stop offset="50%" stop-color="#f59e0b" />
						<stop offset="50%" stop-color="#d1d5db" />
					</linearGradient>
				</defs>
				<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" fill="url(#half-star-{i})" />
			{:else}
				<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" fill="#d1d5db" />
			{/if}
		</svg>
	{/each}
	{#if showValue}
		<span class="ml-1 font-semibold text-foreground {textClasses}">{rating}</span>
		{#if reviewCount !== undefined}
			<span class="text-muted-foreground {textClasses}">({reviewCount} reviews)</span>
		{/if}
	{/if}
</div>
