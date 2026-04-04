<script lang="ts">
	import StarRating from './StarRating.svelte';
	import TrustBadgeRow from './TrustBadgeRow.svelte';
	import type { PropertySocialProof } from '$lib/data/reviews';

	let {
		propertyName,
		socialProof,
		onbook,
		ondismiss
	}: {
		propertyName: string;
		socialProof: PropertySocialProof;
		onbook: () => void;
		ondismiss: () => void;
	} = $props();

	let visible = $state(false);

	$effect(() => {
		requestAnimationFrame(() => { visible = true; });
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[60] flex items-center justify-center p-4 transition-colors duration-500"
	style="background-color: {visible ? 'rgba(0,0,0,0.7)' : 'transparent'}"
	onkeydown={(e) => { if (e.key === 'Escape') ondismiss(); }}
>
	<div
		class="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl transition-all duration-500 md:p-8"
		class:translate-y-0={visible}
		class:opacity-100={visible}
		class:translate-y-8={!visible}
		class:opacity-0={!visible}
	>
		<button onclick={ondismiss} class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Close">
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
		</button>

		<div class="text-center">
			<h2 class="text-xl font-bold text-foreground md:text-2xl">{propertyName}</h2>

			<div class="mt-3 flex items-center justify-center gap-2">
				<StarRating rating={socialProof.overallRating} size="lg" showValue reviewCount={socialProof.totalReviews} />
			</div>

			<p class="mt-4 text-sm text-muted-foreground">
				<span class="font-semibold text-foreground">73%</span> of tour viewers book within 24 hours
			</p>

			<div class="mt-4 flex justify-center">
				<TrustBadgeRow isSuperhost={socialProof.isSuperhost} totalReviews={socialProof.totalReviews} overallRating={socialProof.overallRating} />
			</div>

			<button onclick={onbook} class="mt-6 w-full rounded-xl bg-sky-500 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:bg-sky-400">
				Join {socialProof.totalReviews}+ happy guests &mdash; Book Now
			</button>

			<button onclick={ondismiss} class="mt-3 w-full py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
				Maybe Later
			</button>
		</div>
	</div>
</div>
