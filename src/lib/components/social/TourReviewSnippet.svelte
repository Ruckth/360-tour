<script lang="ts">
	import { T } from '@threlte/core';
	import { HTML } from '@threlte/extras';
	import type { TourReviewSnippet as TourReviewSnippetType } from '$lib/data/reviews';

	let { snippet }: { snippet: TourReviewSnippetType } = $props();

	let visible = $state(false);

	$effect(() => {
		const timer = setTimeout(() => { visible = true; }, 500);
		return () => clearTimeout(timer);
	});

	const starIcons = $derived(
		Array.from({ length: 5 }, (_, i) => (i < snippet.rating ? 'full' : 'empty'))
	);
</script>

<T.Group position={snippet.position}>
	<HTML center pointerEvents="none" transform>
		<div
			class="max-w-[200px] rounded-lg border border-white/20 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-sm transition-opacity duration-500 dark:border-white/10 dark:bg-black/70"
			style="opacity: {visible ? 1 : 0}; pointer-events: none;"
		>
			<div class="mb-1 flex gap-0.5">
				{#each starIcons as type, i (i)}
					<svg class="h-2.5 w-2.5" viewBox="0 0 20 20" fill={type === 'full' ? '#f59e0b' : '#d1d5db'}>
						<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
					</svg>
				{/each}
			</div>
			<p class="text-[11px] font-medium leading-snug text-slate-800 dark:text-slate-200">&ldquo;{snippet.quote}&rdquo;</p>
			<p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{snippet.authorName}, {snippet.authorCity}</p>
		</div>
	</HTML>
</T.Group>
