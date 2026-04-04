<script lang="ts">
	import type { Review } from '$lib/data/reviews';

	let { reviews }: { reviews: Review[] } = $props();

	const photos = $derived(
		reviews
			.filter((r) => r.photos && r.photos.length > 0)
			.flatMap((r) => (r.photos ?? []).map((photo) => ({ url: photo, author: r.author.name, rating: r.rating })))
	);
</script>

{#if photos.length > 0}
	<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:gap-3">
		{#each photos as photo (photo.url)}
			<div class="group relative aspect-square overflow-hidden rounded-lg">
				<img src={photo.url} alt="Guest photo by {photo.author}" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
				<div class="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/20"></div>
				<div class="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
					<svg class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="#f59e0b"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
					{photo.rating}
				</div>
			</div>
		{/each}
	</div>
{/if}
