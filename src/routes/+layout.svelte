<script lang="ts">
	import '../app.css';
	import { Sun, Moon, Monitor } from '@lucide/svelte';
	import { themeState } from '$lib/stores/theme.svelte';
	import { onMount } from 'svelte';
	import ChatBubble from '$lib/components/concierge/ChatBubble.svelte';
	import ChatPanel from '$lib/components/concierge/ChatPanel.svelte';

	let { children } = $props();

	onMount(() => {
		themeState.init();
	});
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<!-- Theme toggle (floating, top-right) -->
	<button
		onclick={() => themeState.cycle()}
		class="fixed right-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full bg-black/20 text-white/70 backdrop-blur-md transition-colors hover:bg-black/30 hover:text-white md:right-6 md:top-5 md:h-10 md:w-10 md:bg-background/80 md:text-muted-foreground md:shadow-sm md:ring-1 md:ring-border md:hover:bg-accent md:hover:text-accent-foreground"
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

	<!-- Page content -->
	<main class="flex-1">
		{@render children()}
	</main>

	<!-- AI Concierge chat widget -->
	<ChatBubble />
	<ChatPanel />

	<!-- Footer -->
	<footer class="border-t border-border bg-muted/50">
		<div class="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
			<div class="grid gap-6 md:gap-8 md:grid-cols-3">
				<div>
					<p class="text-base font-bold tracking-tight md:text-lg">
						<span class="text-foreground">Spin</span>
						<span class="text-primary">&</span>
						<span class="text-foreground">Stay</span>
					</p>
					<p class="mt-2 text-xs text-muted-foreground md:text-sm">
						Spin around every room. Then book your stay.
					</p>
				</div>
				<div>
					<h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Links</h4>
					<div class="mt-2 flex flex-col gap-1.5 md:mt-3 md:gap-2">
						<a href="/" class="text-xs text-muted-foreground hover:text-foreground md:text-sm">Home</a>
						<a href="/#properties" class="text-xs text-muted-foreground hover:text-foreground md:text-sm">Properties</a>
						<a href="/#contact" class="text-xs text-muted-foreground hover:text-foreground md:text-sm">Contact</a>
					</div>
				</div>
				<div>
					<h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</h4>
					<div class="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground md:mt-3 md:gap-2 md:text-sm">
						<p>info@spinandstay.com</p>
						<p>+66 123 456 789</p>
					</div>
				</div>
			</div>
			<div class="mt-6 border-t border-border pt-6 text-center text-xs text-muted-foreground md:mt-8 md:pt-8 md:text-sm">
				&copy; 2026 Spin &amp; Stay. All rights reserved.
			</div>
		</div>
	</footer>
</div>
