<script lang="ts">
	import { properties } from '$lib/data/properties';
	import { getPropertyTagline } from '$lib/data/stories';
</script>

<svelte:head>
	<title>Spin & Stay - 360° Virtual Property Tours</title>
</svelte:head>

<!-- Hero Section -->
<section class="relative flex h-screen items-center justify-center overflow-hidden">
	<div
		class="absolute inset-0 bg-cover bg-center"
		style="background-image: url('https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1920&h=1080&fit=crop');"
	>
		<div class="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60"></div>
	</div>

	<div class="relative z-10 mx-auto max-w-4xl px-5 text-center md:px-6">
		<p class="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-sky-300 md:mb-4 md:text-sm md:tracking-[0.3em]">
			360&deg; Virtual Tours
		</p>
		<h1 class="text-3xl font-bold leading-tight tracking-tight text-white md:text-5xl lg:text-7xl">
			Spin Around.<br />
			<span class="text-sky-400">Then Stay.</span>
		</h1>
		<p class="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/70 md:mt-6 md:max-w-xl md:text-lg">
			Explore luxury properties with immersive 360&deg; tours. Walk through every room from anywhere in the world.
		</p>
	</div>

	<a href="#properties" class="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 md:bottom-8">
		<span class="text-[10px] font-medium uppercase tracking-widest text-white/50 md:text-xs">View Properties</span>
		<svg class="h-4 w-4 animate-bounce text-white/50 md:h-5 md:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
		</svg>
	</a>
</section>

<!-- Properties Section -->
<section id="properties" class="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-24">
	<div class="mb-10 text-center md:mb-16">
		<p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary md:text-sm">Our Properties</p>
		<h2 class="mt-2 text-2xl font-bold tracking-tight text-foreground md:mt-3 md:text-4xl">Choose Your Stay</h2>
		<p class="mx-auto mt-3 max-w-lg text-sm text-muted-foreground md:mt-4">
			Each property offers a unique experience. Explore with our 360&deg; virtual tours.
		</p>
	</div>

	<div class="grid gap-4 md:gap-8 md:grid-cols-2 lg:grid-cols-3">
		{#each properties as property (property.id)}
			<a
				href="/rooms/{property.id}"
				class="group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl md:rounded-2xl"
			>
				<div class="relative aspect-[4/3] overflow-hidden">
					<img
						src={property.images[0]}
						alt={property.name}
						class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
					/>
					<div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
					<div class="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-900 backdrop-blur-sm md:bottom-3 md:left-3 md:gap-1.5 md:px-3 md:py-1 md:text-xs">
						<svg class="h-3 w-3 text-sky-500 md:h-3.5 md:w-3.5" fill="currentColor" viewBox="0 0 20 20">
							<path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
						</svg>
						360&deg;
					</div>
					<div class="absolute bottom-2 right-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-xs font-bold text-white backdrop-blur-sm md:bottom-3 md:right-3 md:px-3 md:py-1 md:text-sm">
						&#3647;{property.pricePerNight.toLocaleString()}<span class="text-[10px] font-normal text-white/60 md:text-xs">/night</span>
					</div>
				</div>

				<div class="p-3 md:p-5">
					<h3 class="text-base font-bold text-card-foreground md:text-lg">{property.name}</h3>
					<p class="mt-0.5 text-xs text-muted-foreground md:mt-1 md:text-sm">{property.tagline}</p>
					{#if getPropertyTagline(property.id)}
						<p class="mt-1.5 font-serif text-xs italic text-muted-foreground/70 md:mt-2 md:text-sm">{getPropertyTagline(property.id)}</p>
					{/if}

					<div class="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground md:mt-4 md:gap-4 md:text-xs">
						<span class="flex items-center gap-1">
							<svg class="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
							</svg>
							{property.maxGuests} guests
						</span>
						<span class="flex items-center gap-1">
							<svg class="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
							</svg>
							{property.bedrooms} bed
						</span>
						<span class="flex items-center gap-1">
							<svg class="h-3 w-3 md:h-4 md:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
							</svg>
							{property.area} m&sup2;
						</span>
					</div>
				</div>
			</a>
		{/each}
	</div>
</section>

<!-- CTA Section -->
<section id="contact" class="bg-slate-900 py-16 dark:bg-slate-950 md:py-24">
	<div class="mx-auto max-w-3xl px-5 text-center md:px-6">
		<h2 class="text-2xl font-bold text-white md:text-3xl lg:text-4xl">Ready to Spin &amp; Stay?</h2>
		<p class="mt-3 text-sm text-slate-400 md:mt-4 md:text-lg">
			Book a property or schedule a private virtual tour with our team.
		</p>
		<div class="mt-6 flex items-center justify-center gap-3 md:mt-8 md:gap-4">
			<a
				href="#properties"
				class="rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg transition hover:bg-primary/90 md:px-8 md:py-3.5 md:text-sm"
			>
				Explore Properties
			</a>
			<a
				href="mailto:info@spinandstay.com"
				class="rounded-xl border border-slate-600 px-5 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white md:px-8 md:py-3.5 md:text-sm"
			>
				Contact Us
			</a>
		</div>
	</div>
</section>
