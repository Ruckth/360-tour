<script lang="ts">
	import { page } from '$app/state';
	import { getPropertyById } from '$lib/data/properties';
	import { getSocialProofByPropertyId } from '$lib/data/social-proof';
	import { resort } from '$lib/data/resort-config';
	import ImageGallery from '$lib/components/ImageGallery.svelte';
	import StarRating from '$lib/components/social/StarRating.svelte';
	import ReviewCarousel from '$lib/components/social/ReviewCarousel.svelte';
	import PriceComparison from '$lib/components/pricing/PriceComparison.svelte';
	import DirectBookingBenefits from '$lib/components/pricing/DirectBookingBenefits.svelte';
	import MobileStickyBar from '$lib/components/booking/MobileStickyBar.svelte';
	import TrustBadges from '$lib/components/trust/TrustBadges.svelte';
	import RecentBookingTicker from '$lib/components/social/RecentBookingTicker.svelte';
	import FadeIn from '$lib/components/FadeIn.svelte';
	import { pageContext } from '$lib/stores/page-context.svelte';
	import { onDestroy } from 'svelte';

	const property = $derived(getPropertyById(page.params.id ?? ''));
	const socialProof = $derived(getSocialProofByPropertyId(property?.id ?? ''));
	let showTour = $state(false);

	// Set page context for chat widget
	$effect(() => {
		if (property) {
			pageContext.setProperty(property.id, property.name);
		}
	});
	onDestroy(() => pageContext.clear());

	function openTour() {
		showTour = true;
	}

	function closeTour() {
		showTour = false;
	}
</script>

<svelte:head>
	<title>{property?.name ?? 'Villa'} — {resort.name}</title>
</svelte:head>

{#if property}
	<div class="pt-0 pb-24 md:pb-0">
		<div class="mx-auto max-w-6xl px-4 pt-20 md:px-6 md:pt-24">
			<nav class="flex items-center gap-2 text-xs text-muted-foreground md:text-sm">
				<a href="/" class="transition hover:text-foreground">{resort.name}</a>
				<span class="text-border">/</span>
				<a href="/#villas" class="transition hover:text-foreground">Our Villas</a>
				<span class="text-border">/</span>
				<span class="text-foreground">{property.name}</span>
			</nav>
		</div>

		<div class="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-8">
			<div class="grid gap-6 md:gap-10 lg:grid-cols-[1fr_380px]">
				<div class="min-w-0">
					<ImageGallery
						images={property.images}
						propertyName={property.name}
						onopen360={openTour}
					/>

					<FadeIn>
					<div class="mt-5 md:mt-8">
						<h1 class="font-serif text-3xl font-semibold text-foreground md:text-4xl">{property.name}</h1>
						{#if socialProof}
							<div class="mt-2">
								<StarRating rating={socialProof.overallRating} size="md" showValue reviewCount={socialProof.totalReviews} />
							</div>
						{/if}
						<p class="mt-0.5 text-sm text-muted-foreground md:mt-1 md:text-lg">{property.tagline}</p>

						<div class="mt-4 flex flex-wrap gap-2 md:mt-6 md:gap-3">
							<span class="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:gap-1.5 md:px-3 md:py-1.5 md:text-sm">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
								</svg>
								{property.maxGuests} guests
							</span>
							<span class="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:gap-1.5 md:px-3 md:py-1.5 md:text-sm">
								{property.bedrooms} bedroom{property.bedrooms > 1 ? 's' : ''}
							</span>
							<span class="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:gap-1.5 md:px-3 md:py-1.5 md:text-sm">
								{property.bathrooms} bathroom{property.bathrooms > 1 ? 's' : ''}
							</span>
							<span class="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground md:gap-1.5 md:px-3 md:py-1.5 md:text-sm">
								{property.area} m&sup2;
							</span>
						</div>

						<p class="mt-4 text-sm leading-relaxed text-muted-foreground md:mt-6 md:text-base">{property.description}</p>
					</div>
					</FadeIn>

					<FadeIn>
					<div class="mt-8">
						<h2 class="text-lg font-semibold text-foreground">Amenities</h2>
						<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
							{#each property.amenities as amenity}
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									<svg class="h-4 w-4 text-gold" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
									</svg>
									{amenity}
								</div>
							{/each}
						</div>
					</div>

					</FadeIn>

					<FadeIn>
					<DirectBookingBenefits propertyId={property.id} />
					</FadeIn>

					<!-- Trust badges -->
					<FadeIn>
					<div class="mt-8">
						<TrustBadges />
					</div>
					</FadeIn>

					{#if socialProof && socialProof.reviews.length > 0}
						<div class="mt-10">
							<h2 class="text-lg font-semibold text-foreground">What Guests Say</h2>
							<div class="mt-4">
								<ReviewCarousel reviews={socialProof.reviews} />
							</div>
						</div>
					{/if}
				</div>

				<!-- Pricing sidebar -->
				<div class="min-w-0 lg:sticky lg:top-24 lg:self-start space-y-3">
					<FadeIn delay={200}>
					<PriceComparison propertyId={property.id} onopen360={openTour} />
					<RecentBookingTicker propertyId={property.id} />
				</FadeIn>
				</div>
			</div>
		</div>
	</div>

	<MobileStickyBar pricePerNight={property.pricePerNight} propertyId={property.id} />

	{#if showTour}
		{#await import('$lib/components/TourViewer.svelte') then { default: TourViewer }}
			<TourViewer
				{property}
				onclose={closeTour}
			/>
		{/await}
	{/if}
{:else}
	<div class="flex h-screen items-center justify-center pt-16">
		<div class="text-center">
			<h1 class="text-2xl font-bold text-foreground">Property not found</h1>
			<a href="/" class="mt-4 inline-block text-primary hover:underline">Back to Home</a>
		</div>
	</div>
{/if}
