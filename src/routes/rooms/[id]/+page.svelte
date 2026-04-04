<script lang="ts">
	import { page } from '$app/stores';
	import { getPropertyById } from '$lib/data/properties';
	import { getMaxSavingsForProperty } from '$lib/data/pricing';
	import ImageGallery from '$lib/components/ImageGallery.svelte';
	import PriceComparison from '$lib/components/pricing/PriceComparison.svelte';
	import SavingsBadge from '$lib/components/pricing/SavingsBadge.svelte';
	import DirectBookingBenefits from '$lib/components/pricing/DirectBookingBenefits.svelte';
	import PriceTickerAnimation from '$lib/components/pricing/PriceTickerAnimation.svelte';
	import { pricingState } from '$lib/stores/pricing.svelte';

	const property = $derived(getPropertyById($page.params.id ?? ''));
	const maxSavings = $derived(property ? getMaxSavingsForProperty(property.id) : 0);
	let showTour = $state(false);

	$effect(() => {
		if (property) {
			pricingState.init(property.id);
		}
	});

	function openTour() {
		showTour = true;
	}

	function closeTour() {
		showTour = false;
	}
</script>

<svelte:head>
	<title>{property?.name ?? 'Property'} - Spin & Stay</title>
</svelte:head>

{#if property}
	<div class="pt-0">
		<div class="mx-auto max-w-6xl px-4 pt-4 md:px-6 md:pt-6">
			<a
				href="/"
				class="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground md:gap-2 md:text-sm"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				</svg>
				Back to Properties
			</a>
		</div>

		<div class="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-8">
			<div class="grid gap-6 md:gap-10 lg:grid-cols-[1fr_380px]">
				<div>
					<ImageGallery
						images={property.images}
						propertyName={property.name}
						onopen360={openTour}
					/>

					<div class="mt-5 md:mt-8">
						<div class="flex flex-wrap items-center gap-3">
							<h1 class="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{property.name}</h1>
							{#if maxSavings > 0}
								<SavingsBadge amount={maxSavings} />
							{/if}
						</div>
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

					<!-- Price Ticker Animation -->
					<div class="mt-8">
						<PriceTickerAnimation />
					</div>

					<div class="mt-8">
						<h2 class="text-lg font-semibold text-foreground">Amenities</h2>
						<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
							{#each property.amenities as amenity}
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									<svg class="h-4 w-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
									</svg>
									{amenity}
								</div>
							{/each}
						</div>
					</div>

					<!-- Direct Booking Benefits -->
					<DirectBookingBenefits propertyId={property.id} />
				</div>

				<!-- Price Comparison sidebar -->
				<div class="lg:sticky lg:top-24 lg:self-start">
					<PriceComparison propertyId={property.id} onopen360={openTour} />
				</div>
			</div>
		</div>
	</div>

	{#if showTour}
		{#await import('$lib/components/TourViewer.svelte') then { default: TourViewer }}
			<TourViewer
				roomIds={property.tourRoomIds}
				propertyName={property.name}
				propertyId={property.id}
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
