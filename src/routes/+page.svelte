<script lang="ts">
	import { properties } from '$lib/data/properties';
	import { getPropertyTagline } from '$lib/data/stories';
	import { getSocialProofByPropertyId } from '$lib/data/social-proof';
	import { resort } from '$lib/data/resort-config';
	import StarRating from '$lib/components/social/StarRating.svelte';
	import ReviewCarousel from '$lib/components/social/ReviewCarousel.svelte';
	import FadeIn from '$lib/components/FadeIn.svelte';
	import { onMount, onDestroy } from 'svelte';

	// --- Responsive breakpoint ---
	let isDesktop = $state(false);
	let heroLoaded = $state(false);

	// --- Desktop: 3-step cycle (video → split images → video) ---
	let desktopStep = $state(0); // 0=video-left, 1=split-images, 2=video-right
	let videoRef0: HTMLVideoElement | undefined = $state();
	let videoRef1: HTMLVideoElement | undefined = $state();
	let holdTimer: ReturnType<typeof setTimeout> | undefined;

	const IMAGE_HOLD_MS = 6000;

	const desktopImages = {
		left: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=960&h=1080&fit=crop',
		right: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=960&h=1080&fit=crop',
	};

	function advanceDesktop() {
		if (holdTimer) { clearTimeout(holdTimer); holdTimer = undefined; }
		if (desktopStep === 0) videoRef0?.pause();
		if (desktopStep === 2) videoRef1?.pause();

		const next = (desktopStep + 1) % 3;
		desktopStep = next;

		if (next === 0) {
			if (videoRef0) { videoRef0.currentTime = 0; videoRef0.play().catch(() => {}); }
		} else if (next === 1) {
			holdTimer = setTimeout(advanceDesktop, IMAGE_HOLD_MS);
		} else {
			if (videoRef1) { videoRef1.currentTime = 0; videoRef1.play().catch(() => {}); }
		}
	}

	function onVideoEnded(step: number) {
		if (step === desktopStep) advanceDesktop();
	}

	function onVideoReady(step: number) {
		if (isDesktop && step === desktopStep) {
			if (step === 0) videoRef0?.play().catch(() => {});
			if (step === 2) videoRef1?.play().catch(() => {});
		}
	}

	// --- Mobile: paginated image pairs with auto-cycle ---
	let mobileSlide = $state(0);
	let mobileTimer: ReturnType<typeof setInterval> | undefined;
	let pauseTimeout: ReturnType<typeof setTimeout> | undefined;

	const MOBILE_CYCLE_MS = 6000;
	const MOBILE_PAUSE_MS = 8000;

	const mobileSlides = [
		{
			top: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=900&fit=crop',
			bottom: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&h=900&fit=crop',
		},
		{
			top: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&h=900&fit=crop',
			bottom: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&h=900&fit=crop',
		},
		{
			top: 'https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=800&h=900&fit=crop',
			bottom: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=900&fit=crop',
		},
	];

	function startMobileAutoCycle() {
		stopMobileAutoCycle();
		mobileTimer = setInterval(() => {
			mobileSlide = (mobileSlide + 1) % mobileSlides.length;
		}, MOBILE_CYCLE_MS);
	}

	function stopMobileAutoCycle() {
		if (mobileTimer) { clearInterval(mobileTimer); mobileTimer = undefined; }
		if (pauseTimeout) { clearTimeout(pauseTimeout); pauseTimeout = undefined; }
	}

	function goToMobileSlide(index: number) {
		mobileSlide = index;
		stopMobileAutoCycle();
		pauseTimeout = setTimeout(startMobileAutoCycle, MOBILE_PAUSE_MS);
	}

	// --- Cleanup helpers ---
	function cleanupDesktop() {
		videoRef0?.pause();
		videoRef1?.pause();
		if (holdTimer) { clearTimeout(holdTimer); holdTimer = undefined; }
		desktopStep = 0;
	}

	function cleanupMobile() {
		stopMobileAutoCycle();
		mobileSlide = 0;
	}

	// --- Lifecycle ---
	let mqlCleanup: (() => void) | undefined;

	onMount(() => {
		setTimeout(() => { heroLoaded = true; }, 100);

		const mql = window.matchMedia('(min-width: 768px)');
		isDesktop = mql.matches;

		const handler = (e: MediaQueryListEvent) => {
			if (e.matches) {
				cleanupMobile();
			} else {
				cleanupDesktop();
			}
			isDesktop = e.matches;
			if (!e.matches) startMobileAutoCycle();
		};
		mql.addEventListener('change', handler);
		mqlCleanup = () => mql.removeEventListener('change', handler);

		if (!isDesktop) startMobileAutoCycle();
	});

	onDestroy(() => {
		cleanupDesktop();
		cleanupMobile();
		mqlCleanup?.();
	});

	const allReviews = (() => {
		const reviews: any[] = [];
		for (const property of properties) {
			const sp = getSocialProofByPropertyId(property.id);
			if (sp) reviews.push(...sp.reviews);
		}
		return reviews.sort((a, b) => b.rating - a.rating).slice(0, 6);
	})();
</script>

<svelte:head>
	<title>{resort.name} — Luxury Villas in {resort.location}</title>
</svelte:head>

<!-- Hero Section — Responsive: Desktop (video↔split) / Mobile (paginated pairs) -->
<section class="relative h-screen overflow-hidden">
	<div class="absolute inset-0 transition-opacity duration-1000 {heroLoaded ? 'opacity-100' : 'opacity-0'}">

		{#if isDesktop}
			<!-- ═══ Desktop: 3-step crossfade ═══ -->

			<!-- Step 0: Full-width video (hero-left) -->
			<div class="absolute inset-0 transition-opacity duration-[2000ms] ease-in-out {desktopStep === 0 ? 'opacity-100 z-[1]' : 'opacity-0 z-0'}">
				<video
					bind:this={videoRef0}
					oncanplaythrough={() => onVideoReady(0)}
					onended={() => onVideoEnded(0)}
					muted
					playsinline
					preload="auto"
					class="h-full w-full object-cover"
				>
					<source src="/videos/hero-left.mp4" type="video/mp4" />
				</video>
			</div>

			<!-- Step 1: Split images (seamless 50/50) -->
			<div class="absolute inset-0 transition-opacity duration-[2000ms] ease-in-out {desktopStep === 1 ? 'opacity-100 z-[1]' : 'opacity-0 z-0'}">
				<div class="flex h-full w-full">
					<div class="h-full w-1/2 overflow-hidden">
						<img
							src={desktopImages.left}
							alt=""
							class="h-full w-full object-cover {desktopStep === 1 ? 'hero-ken-burns' : ''}"
						/>
					</div>
					<div class="h-full w-1/2 overflow-hidden">
						<img
							src={desktopImages.right}
							alt=""
							class="h-full w-full object-cover {desktopStep === 1 ? 'hero-ken-burns' : ''}"
						/>
					</div>
				</div>
			</div>

			<!-- Step 2: Full-width video (hero-right) -->
			<div class="absolute inset-0 transition-opacity duration-[2000ms] ease-in-out {desktopStep === 2 ? 'opacity-100 z-[1]' : 'opacity-0 z-0'}">
				<video
					bind:this={videoRef1}
					oncanplaythrough={() => onVideoReady(2)}
					onended={() => onVideoEnded(2)}
					muted
					playsinline
					preload="auto"
					class="h-full w-full object-cover"
				>
					<source src="/videos/hero-right.mp4" type="video/mp4" />
				</video>
			</div>

		{:else}
			<!-- ═══ Mobile: split top/bottom with pagination dots ═══ -->

			<div class="absolute inset-0 flex flex-col">
				<!-- Top half -->
				<div class="relative h-1/2 w-full overflow-hidden">
					{#each mobileSlides as slide, i}
						<div class="absolute inset-0 transition-opacity duration-[2000ms] ease-in-out {mobileSlide === i ? 'opacity-100' : 'opacity-0'}">
							<img
								src={slide.top}
								alt=""
								class="h-full w-full object-cover {mobileSlide === i ? 'hero-ken-burns' : ''}"
							/>
						</div>
					{/each}
					<div class="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30"></div>
				</div>

				<!-- Divider -->
				<div class="relative z-[4] h-px w-full bg-white/15"></div>

				<!-- Bottom half -->
				<div class="relative h-1/2 w-full overflow-hidden">
					{#each mobileSlides as slide, i}
						<div class="absolute inset-0 transition-opacity duration-[2000ms] ease-in-out {mobileSlide === i ? 'opacity-100' : 'opacity-0'}">
							<img
								src={slide.bottom}
								alt=""
								class="h-full w-full object-cover {mobileSlide === i ? 'hero-ken-burns' : ''}"
							/>
						</div>
					{/each}
					<div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20"></div>
				</div>
			</div>

			<!-- Pagination dots -->
			<div class="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 gap-2">
				{#each mobileSlides as _, i}
					<button
						onclick={() => goToMobileSlide(i)}
						class="h-2 rounded-full transition-all duration-300 {mobileSlide === i ? 'w-6 bg-white' : 'w-2 bg-white/40'}"
						aria-label="Go to slide {i + 1}"
					></button>
				{/each}
			</div>
		{/if}

	</div>

	<!-- Gradient overlay (desktop only — mobile has per-panel gradients) -->
	<div class="absolute inset-0 z-[2] hidden bg-gradient-to-b from-black/25 via-transparent to-black/50 md:block"></div>

	<!-- Film grain overlay -->
	<div class="hero-grain absolute inset-0 z-[3] pointer-events-none opacity-[0.035] dark:opacity-[0.06]"></div>

	<!-- Center card overlay -->
	<div class="absolute inset-0 z-10 flex items-center justify-center">
		<a
			href="#villas"
			class="hero-card-reveal group flex items-center gap-3 bg-navy/80 px-4 py-2.5 shadow-lg backdrop-blur-sm transition-all hover:bg-navy/90 dark:bg-gold/80 dark:hover:bg-gold/90 sm:gap-4 sm:px-5 sm:py-3 md:gap-5 md:px-6 md:py-3 lg:gap-6 lg:px-8 lg:py-3.5"
		>
			<div>
				<p class="font-serif text-xs font-semibold text-white dark:text-navy sm:text-sm md:text-base lg:text-lg">{resort.name}</p>
				<p class="text-[8px] uppercase tracking-[0.15em] text-white/50 dark:text-navy/50 sm:text-[9px] md:text-[10px]">{resort.location}</p>
			</div>
			<div class="h-5 w-px bg-white/15 dark:bg-navy/15 sm:h-6"></div>
			<div class="flex items-center gap-1.5">
				<span class="text-[9px] font-medium text-white/70 dark:text-navy/70 sm:text-[10px] md:text-xs">Explore</span>
				<svg class="h-3 w-3 text-white/50 transition-transform group-hover:translate-x-0.5 dark:text-navy/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
				</svg>
			</div>
		</a>
	</div>

	<!-- Discover arrow -->
	<a href="#about" aria-label="Scroll down" class="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 md:bottom-8">
		<svg class="h-5 w-5 animate-bounce text-white/50 md:h-6 md:w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
		</svg>
	</a>
</section>

<!-- About Section -->
<section id="about" class="py-20 md:py-28">
	<div class="mx-auto max-w-7xl px-5 md:px-8">
		<FadeIn>
			<div class="mx-auto max-w-3xl text-center">
				<p class="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">Welcome</p>
				<h2 class="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
					A Sanctuary Above the Sea
				</h2>
				<p class="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:mt-6 md:text-base">
					{resort.description}
				</p>
			</div>
		</FadeIn>

		<!-- Stats bar -->
		<div class="mt-14 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
			{#each resort.highlights as highlight, i}
				<FadeIn delay={i * 100}>
					<div class="text-center">
						<p class="font-serif text-3xl font-semibold text-foreground md:text-4xl">{highlight.stat}</p>
						<p class="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground md:text-sm">{highlight.label}</p>
					</div>
				</FadeIn>
			{/each}
		</div>
	</div>
</section>

<!-- Villas Section -->
<section id="villas" class="bg-muted/40 py-20 md:py-28">
	<div class="mx-auto max-w-7xl px-5 md:px-8">
		<FadeIn>
			<div class="mb-12 text-center md:mb-16">
				<p class="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">Accommodations</p>
				<h2 class="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">Our Villas</h2>
				<p class="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
					Three distinct experiences, each with immersive 360&deg; virtual tours.
				</p>
			</div>
		</FadeIn>

		<div class="grid gap-6 md:gap-8 lg:grid-cols-3">
			{#each properties as property, i (property.id)}
				{@const sp = getSocialProofByPropertyId(property.id)}
				<FadeIn delay={i * 150}>
				<a
					href="/rooms/{property.id}"
					class="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-500 hover:-translate-y-1 hover:shadow-xl"
				>
					<div class="relative aspect-[4/3] overflow-hidden">
						<img
							src={property.images[0]}
							alt={property.name}
							class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
						/>
						<div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
						<div class="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-sm bg-navy/90 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur-sm transition-all group-hover:bg-gold group-hover:text-navy dark:bg-gold/90 dark:text-navy dark:group-hover:bg-gold md:px-4 md:text-xs" role="button" aria-label="Take 360 degree virtual tour of {property.name}">
							<svg class="h-3.5 w-3.5 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
							</svg>
							360&deg; Virtual Tour
						</div>
						<div class="absolute bottom-3 right-3 rounded-full bg-navy/90 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm md:text-sm">
							{resort.currencySymbol}{property.pricePerNight.toLocaleString()}<span class="text-[10px] font-normal text-white/60 md:text-xs">/night</span>
						</div>
					</div>

					<div class="p-5 md:p-6">
						<h3 class="font-serif text-xl font-semibold text-card-foreground md:text-2xl">{property.name}</h3>
						{#if sp}
							<div class="mt-1.5">
								<StarRating rating={sp.overallRating} size="sm" showValue reviewCount={sp.totalReviews} />
							</div>
						{/if}
						<p class="mt-2 text-sm text-muted-foreground">{property.tagline}</p>
						{#if getPropertyTagline(property.id)}
							<p class="mt-2 font-serif text-sm italic text-muted-foreground/70">{getPropertyTagline(property.id)}</p>
						{/if}

						<div class="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
							<span class="flex items-center gap-1">
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
								</svg>
								{property.maxGuests} guests
							</span>
							<span>{property.bedrooms} bed{property.bedrooms > 1 ? 's' : ''}</span>
							<span>{property.bathrooms} bath{property.bathrooms > 1 ? 's' : ''}</span>
							<span>{property.area} m&sup2;</span>
						</div>
					</div>
				</a>
				</FadeIn>
			{/each}
		</div>
	</div>
</section>

<!-- Amenities Section -->
<section id="amenities" class="py-20 md:py-28">
	<div class="mx-auto max-w-7xl px-5 md:px-8">
		<FadeIn>
			<div class="mx-auto mb-12 max-w-3xl text-center md:mb-16">
				<p class="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">Experience</p>
				<h2 class="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">Resort Amenities</h2>
				<p class="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
					Everything you need for an unforgettable stay, included with every villa.
				</p>
			</div>
		</FadeIn>

		<div class="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
			{#each resort.amenities as amenity, i}
				<FadeIn delay={i * 75}>
				<div class="rounded-xl border border-border bg-card p-5 text-center transition hover:shadow-md md:p-6">
					<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
						<svg class="h-5 w-5 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							{#if amenity.icon === 'waves'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M2 12c1.5-2 3.5-2 5 0s3.5 2 5 0 3.5-2 5 0 3.5 2 5 0" />
							{:else if amenity.icon === 'sparkles'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
							{:else if amenity.icon === 'utensils'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.379a48.474 48.474 0 00-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265z" />
							{:else if amenity.icon === 'car'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H18.75M3 14.25h4.125M3 14.25V4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125h3a1.125 1.125 0 011.125 1.125v3.375M3 14.25h11.25" />
							{:else if amenity.icon === 'bell'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
							{:else if amenity.icon === 'sun'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
							{:else if amenity.icon === 'heart'}
								<path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
							{:else}
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
							{/if}
						</svg>
					</div>
					<p class="mt-3 text-sm font-medium text-foreground">{amenity.name}</p>
				</div>
				</FadeIn>
			{/each}
		</div>
	</div>
</section>

<!-- Reviews Section -->
<section id="reviews" class="bg-muted/40 py-20 md:py-28">
	<div class="mx-auto max-w-7xl px-5 md:px-8">
		<FadeIn>
			<div class="mx-auto mb-12 max-w-3xl text-center md:mb-16">
				<p class="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">Testimonials</p>
				<h2 class="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">What Our Guests Say</h2>
				<p class="mx-auto mt-4 max-w-lg text-sm text-muted-foreground md:text-base">
					Real reviews from guests who experienced {resort.name}.
				</p>
			</div>
		</FadeIn>

		<FadeIn>
			<ReviewCarousel reviews={allReviews} />
		</FadeIn>
	</div>
</section>

<!-- Location Section -->
<section class="py-20 md:py-28">
	<div class="mx-auto max-w-7xl px-5 md:px-8">
		<div class="grid items-center gap-10 md:grid-cols-2 md:gap-16">
			<FadeIn>
			<div>
				<p class="text-xs font-semibold uppercase tracking-[0.25em] text-gold md:text-sm">Location</p>
				<h2 class="mt-3 font-serif text-3xl font-semibold text-foreground md:text-4xl">
					{resort.location}
				</h2>
				<p class="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
					Perched on the hillside overlooking the Gulf of Thailand, {resort.name} is minutes from pristine beaches,
					world-class diving, and vibrant local markets. Yet once inside our gates, the world falls away.
				</p>
				<ul class="mt-6 space-y-3">
					{#each ['5 min to Bophut Beach', '15 min from Samui Airport', '10 min to Fisherman\'s Village', 'Private airport transfer included'] as item}
						<li class="flex items-center gap-3 text-sm text-foreground">
							<svg class="h-4 w-4 flex-shrink-0 text-gold" fill="currentColor" viewBox="0 0 20 20">
								<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
							</svg>
							{item}
						</li>
					{/each}
				</ul>
			</div>
			</FadeIn>
			<FadeIn delay={150}>
			<div class="relative overflow-hidden rounded-2xl">
				<img
					src="https://images.unsplash.com/photo-1537956965359-7573183d1f57?w=800&h=600&fit=crop"
					alt="{resort.location} aerial view"
					class="h-full w-full object-cover"
				/>
			</div>
			</FadeIn>
		</div>
	</div>
</section>

<!-- CTA Section -->
<section id="contact" class="bg-primary py-20 md:py-28">
	<FadeIn>
	<div class="mx-auto max-w-3xl px-5 text-center md:px-6">
		<p class="text-xs font-semibold uppercase tracking-[0.25em] text-primary-foreground/50">Begin Your Stay</p>
		<h2 class="mt-3 font-serif text-3xl font-semibold text-primary-foreground md:text-4xl lg:text-5xl">Ready to Experience {resort.name}?</h2>
		<p class="mt-4 text-sm text-primary-foreground/70 md:text-lg">
			Book direct and save 15% compared to online travel agencies. Includes complimentary airport transfer and welcome amenities.
		</p>
		<div class="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center md:mt-10 md:gap-4">
			<a
				href="/booking"
				class="w-full rounded-lg bg-gold px-8 py-3.5 text-sm font-semibold text-navy shadow-lg transition hover:bg-gold-light sm:w-auto"
			>
				Book
			</a>
			<a
				href="mailto:{resort.contactEmail}"
				class="w-full rounded-lg border border-primary-foreground/20 px-8 py-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary-foreground/10 sm:w-auto"
			>
				Contact Us
			</a>
		</div>
	</div>
	</FadeIn>
</section>
