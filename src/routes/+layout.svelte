<script lang="ts">
	import '../app.css';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex } from 'convex-svelte';
	import { Sun, Moon, Monitor, Menu, X } from '@lucide/svelte';
	import { themeState } from '$lib/stores/theme.svelte';
	import { pageContext } from '$lib/stores/page-context.svelte';

	import AIChatWidget from '$lib/components/chat/AIChatWidget.svelte';
	import { resort } from '$lib/data/resort-config';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	let { children } = $props();

	setupConvex(PUBLIC_CONVEX_URL);

	let mobileMenuOpen = $state(false);
	let scrolled = $state(false);
	let pageLoaded = $state(false);
	const isHome = $derived(page.url.pathname === '/');

	onMount(() => {
		themeState.init();
		// Minimal page loading — fade out after content ready
		requestAnimationFrame(() => { pageLoaded = true; });
		const handleScroll = () => { scrolled = window.scrollY > 40; };
		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => window.removeEventListener('scroll', handleScroll);
	});

	const navLinks = [
		{ href: '/#villas', label: 'Villas' },
		{ href: '/#amenities', label: 'Amenities' },
		{ href: '/#reviews', label: 'Reviews' },
		{ href: '/#contact', label: 'Contact' }
	];
</script>

<!-- Page loading overlay -->
{#if !pageLoaded}
	<div class="fixed inset-0 z-[100] flex items-center justify-center bg-background">
		<div class="h-px w-16 overflow-hidden bg-border">
			<div class="h-full w-full animate-[page-load-line_0.8s_ease-in-out_infinite] bg-gold"></div>
		</div>
	</div>
{/if}

<div class="flex min-h-screen flex-col bg-background text-foreground transition-opacity duration-500 {pageLoaded ? 'opacity-100' : 'opacity-0'}">
	<!-- Navigation -->
	<header
		class="fixed inset-x-0 top-0 z-40 transition-all duration-300 {scrolled || !isHome ? 'bg-background/95 shadow-sm backdrop-blur-md border-b border-border' : 'bg-transparent'}"
	>
		<nav class="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8 md:py-4">
			<!-- Logo -->
			<a href="/" class="flex items-center gap-2">
				<span class="font-serif text-xl font-semibold tracking-tight md:text-2xl {scrolled || !isHome ? 'text-foreground' : 'text-white'}">{resort.name}</span>
			</a>

			<!-- Desktop nav -->
			<div class="hidden items-center gap-8 md:flex">
				{#each navLinks as link}
					<a
						href={link.href}
						class="text-sm font-medium transition-colors {scrolled || !isHome ? 'text-muted-foreground hover:text-foreground' : 'text-white/70 hover:text-white'}"
					>{link.label}</a>
				{/each}
				<a
					href="/booking"
					class="rounded-lg px-5 py-2 text-sm font-semibold transition-all {scrolled || !isHome ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-white/15 text-white backdrop-blur-sm hover:bg-white/25'}"
				>Book</a>
				<button
					onclick={() => themeState.cycle()}
					class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {scrolled || !isHome ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'text-white/60 hover:text-white'}"
					aria-label="Toggle theme: {themeState.mode}"
				>
					{#if themeState.mode === 'light'}
						<Sun class="h-4 w-4" />
					{:else if themeState.mode === 'dark'}
						<Moon class="h-4 w-4" />
					{:else}
						<Monitor class="h-4 w-4" />
					{/if}
				</button>
			</div>

			<!-- Mobile menu button -->
			<div class="flex items-center gap-2 md:hidden">
				<button
					onclick={() => themeState.cycle()}
					class="flex h-9 w-9 items-center justify-center rounded-full {scrolled || !isHome ? 'text-muted-foreground' : 'text-white/70'}"
					aria-label="Toggle theme"
				>
					{#if themeState.mode === 'light'}
						<Sun class="h-4 w-4" />
					{:else if themeState.mode === 'dark'}
						<Moon class="h-4 w-4" />
					{:else}
						<Monitor class="h-4 w-4" />
					{/if}
				</button>
				<button
					onclick={() => mobileMenuOpen = !mobileMenuOpen}
					class="flex h-9 w-9 items-center justify-center rounded-full {scrolled || !isHome ? 'text-foreground' : 'text-white'}"
					aria-label="Toggle menu"
				>
					{#if mobileMenuOpen}
						<X class="h-5 w-5" />
					{:else}
						<Menu class="h-5 w-5" />
					{/if}
				</button>
			</div>
		</nav>

		<!-- Mobile menu -->
		{#if mobileMenuOpen}
			<div class="border-t border-border bg-background/98 backdrop-blur-md md:hidden">
				<div class="flex flex-col px-5 py-4 space-y-1">
					{#each navLinks as link}
						<a
							href={link.href}
							onclick={() => mobileMenuOpen = false}
							class="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
						>{link.label}</a>
					{/each}
					<a
						href="/booking"
						onclick={() => mobileMenuOpen = false}
						class="mt-2 rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground"
					>Book</a>
				</div>
			</div>
		{/if}
	</header>

	<!-- Page content -->
	<main class="flex-1">
		{@render children()}
	</main>

	<!-- Footer -->
	<footer class="border-t border-border bg-primary text-primary-foreground">
		<div class="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-16">
			<div class="grid gap-8 md:grid-cols-4">
				<div class="md:col-span-2">
					<p class="font-serif text-2xl font-semibold">{resort.name}</p>
					<p class="mt-2 max-w-md text-sm text-primary-foreground/70 leading-relaxed">
						{resort.description}
					</p>
				</div>
				<div>
					<h4 class="text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/50">Explore</h4>
					<div class="mt-3 flex flex-col gap-2">
						<a href="/#villas" class="text-sm text-primary-foreground/70 transition hover:text-primary-foreground">Our Villas</a>
						<a href="/#amenities" class="text-sm text-primary-foreground/70 transition hover:text-primary-foreground">Amenities</a>
						<a href="/#reviews" class="text-sm text-primary-foreground/70 transition hover:text-primary-foreground">Guest Reviews</a>
						<a href="/#contact" class="text-sm text-primary-foreground/70 transition hover:text-primary-foreground">Contact</a>
					</div>
				</div>
				<div>
					<h4 class="text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/50">Contact</h4>
					<div class="mt-3 flex flex-col gap-2 text-sm text-primary-foreground/70">
						<p>{resort.contactEmail}</p>
						<p>{resort.contactPhone}</p>
						<p>{resort.address}</p>
					</div>
				</div>
			</div>
			<div class="mt-10 border-t border-primary-foreground/10 pt-6 text-center text-xs text-primary-foreground/40">
				&copy; {new Date().getFullYear()} {resort.name}. All rights reserved.
			</div>
		</div>
	</footer>

	<AIChatWidget
		propertySlug={pageContext.propertySlug}
		propertyName={pageContext.propertyName}
		whatsappNumber={resort.whatsapp}
		lineId={resort.lineId}
	/>
</div>
