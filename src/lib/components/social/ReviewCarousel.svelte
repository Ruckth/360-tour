<script lang="ts">
	import type { Review } from '$lib/data/reviews';
	import ReviewCard from './ReviewCard.svelte';

	let { reviews }: { reviews: Review[] } = $props();

	let currentIndex = $state(0);
	let touchStartX = $state(0);
	let touchDeltaX = $state(0);
	let isDragging = $state(false);
	let isPaused = $state(false);
	let autoTimer: ReturnType<typeof setInterval> | undefined;

	function goTo(index: number) {
		currentIndex = Math.max(0, Math.min(index, reviews.length - 1));
	}

	function next() {
		goTo((currentIndex + 1) % reviews.length);
	}

	function prev() {
		goTo((currentIndex - 1 + reviews.length) % reviews.length);
	}

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
		isDragging = true;
		touchDeltaX = 0;
		isPaused = true;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isDragging) return;
		touchDeltaX = e.touches[0].clientX - touchStartX;
	}

	function handleTouchEnd() {
		if (!isDragging) return;
		isDragging = false;
		if (touchDeltaX > 60) prev();
		else if (touchDeltaX < -60) next();
		touchDeltaX = 0;
		isPaused = false;
	}

	$effect(() => {
		if (isPaused) {
			if (autoTimer) clearInterval(autoTimer);
			return;
		}
		autoTimer = setInterval(() => { next(); }, 5000);
		return () => { if (autoTimer) clearInterval(autoTimer); };
	});
</script>

<div class="relative overflow-hidden" onmouseenter={() => (isPaused = true)} onmouseleave={() => (isPaused = false)} role="region" aria-label="Guest reviews">
	<div class="flex transition-transform duration-500 ease-out" style="transform: translateX(calc(-{currentIndex * 100}% + {isDragging ? touchDeltaX : 0}px));" ontouchstart={handleTouchStart} ontouchmove={handleTouchMove} ontouchend={handleTouchEnd}>
		{#each reviews as review (review.id)}
			<div class="w-full flex-shrink-0 px-1">
				<ReviewCard {review} />
			</div>
		{/each}
	</div>

	{#if reviews.length > 1}
		<button onclick={prev} aria-label="Previous review" class="absolute left-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-md transition hover:bg-background">
			<svg class="h-4 w-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
		</button>
		<button onclick={next} aria-label="Next review" class="absolute right-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-md transition hover:bg-background">
			<svg class="h-4 w-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
		</button>
	{/if}

	{#if reviews.length > 1}
		<div class="mt-4 flex justify-center gap-2">
			{#each reviews as _, i (i)}
				<button onclick={() => goTo(i)} class="h-2 rounded-full transition-all {currentIndex === i ? 'w-6 bg-foreground' : 'w-2 bg-foreground/20 hover:bg-foreground/40'}" aria-label="Go to review {i + 1}"></button>
			{/each}
		</div>
	{/if}
</div>
