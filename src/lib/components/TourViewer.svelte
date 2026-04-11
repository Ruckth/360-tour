<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import { tourState } from '$lib/stores/tour.svelte';
	import { narrativeState } from '$lib/stores/narrative.svelte';
	import StoryOverlay from './story/StoryOverlay.svelte';
	import TourProgressIndicator from './story/TourProgressIndicator.svelte';
	import TourConclusion from './story/TourConclusion.svelte';
	import LeadCapture from './story/LeadCapture.svelte';
	import TourPriceBadge from './pricing/TourPriceBadge.svelte';
	import { onMount } from 'svelte';
	import type { Property } from '$lib/data/properties';

	let {
		property,
		onclose
	}: {
		property: Property;
		onclose: () => void;
	} = $props();

	const roomIds = property.tourRoomIds;
	const propertyName = property.name;

	tourState.init(roomIds);
	narrativeState.init(roomIds);

	let phase = $state<'intro' | 'tour' | 'conclusion' | 'leadCapture'>('intro');
	let introProgress = $state(0);
	let introTimer: ReturnType<typeof setInterval> | undefined;
	let minTimeReached = $state(false);
	let isMobile = $state(false);

	let readyForTour = $derived(tourState.allTexturesLoaded && minTimeReached);

	$effect(() => {
		if (narrativeState.showConclusion && phase === 'tour') phase = 'conclusion';
	});
	$effect(() => {
		if (narrativeState.leadCaptureShown && (phase === 'conclusion' || phase === 'tour')) phase = 'leadCapture';
	});
	$effect(() => {
		if (!narrativeState.leadCaptureShown && phase === 'leadCapture') phase = narrativeState.showConclusion ? 'conclusion' : 'tour';
	});
	$effect(() => {
		if (!narrativeState.showConclusion && phase === 'conclusion') phase = 'tour';
	});
	$effect(() => {
		if (readyForTour && phase === 'intro') {
			setTimeout(() => {
				phase = 'tour';
				narrativeState.enterRoom(roomIds[0]);
			}, 400);
		}
	});

	let prevRoomId = $state(roomIds[0]);
	$effect(() => {
		const currentId = tourState.currentRoomId;
		if (currentId !== prevRoomId && phase === 'tour') {
			narrativeState.enterRoom(currentId);
			prevRoomId = currentId;
		}
	});

	onMount(() => {
		document.body.style.overflow = 'hidden';
		isMobile = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
		const duration = isMobile ? 1200 : 1000;
		const start = Date.now();
		introTimer = setInterval(() => {
			const elapsed = Date.now() - start;
			introProgress = Math.min(100, (elapsed / duration) * 100);
			if (elapsed >= duration) {
				minTimeReached = true;
				clearInterval(introTimer);
			}
		}, 30);
		return () => {
			document.body.style.overflow = '';
			if (introTimer) clearInterval(introTimer);
			narrativeState.destroy();
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (phase === 'leadCapture') narrativeState.hideLeadCapture();
			else if (phase === 'conclusion') narrativeState.closeConclusion();
			else onclose();
		}
	}

	function handleCloseConclusion() { narrativeState.closeConclusion(); }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 bg-black" style="touch-action: none;">
	<div
		class="absolute inset-0 transition-[filter] duration-700"
		class:opacity-0={phase === 'intro'}
		class:pointer-events-none={phase === 'intro'}
		style:filter={phase === 'conclusion' || phase === 'leadCapture' ? 'blur(8px)' : 'none'}
	>
		<Canvas renderMode="always">
			<Scene />
		</Canvas>
	</div>

	{#if phase === 'intro'}
		<div class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black px-6">
			<button onclick={onclose} class="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white" aria-label="Close">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
			</button>

			{#if isMobile}
				<!-- Mobile: simple rotate hint -->
				<div class="mb-6 animate-phone-rotate">
					<svg width="60" height="90" viewBox="0 0 80 120" fill="none" class="text-white/70">
						<rect x="4" y="4" width="72" height="112" rx="12" stroke="currentColor" stroke-width="2.5" fill="none" />
						<rect x="30" y="100" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.4" />
					</svg>
				</div>
				<p class="text-center text-sm text-white/60">Rotate for best experience</p>
			{:else}
				<!-- Desktop: clean serif text -->
				<p class="font-serif text-3xl font-semibold text-white md:text-4xl">{propertyName}</p>
			{/if}

			<div class="mt-6 h-px w-32 overflow-hidden bg-white/10">
				<div class="h-full bg-gold transition-all duration-200" style="width: {introProgress}%"></div>
			</div>

			{#if introProgress >= 100 && !tourState.allTexturesLoaded}
				<p class="mt-3 text-xs text-white/30">Loading...</p>
			{/if}
		</div>
	{/if}

	{#if phase === 'tour'}
		<!-- Close button -->
		<button onclick={onclose} class="pointer-events-auto absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 md:right-6 md:top-5" aria-label="Close tour">
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
		</button>

		<StoryOverlay />

		{#if tourState.activeRooms.length > 1}
			<div class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 animate-fade-in md:bottom-6 md:gap-2">
				{#each tourState.activeRooms as room (room.id)}
					<button
						class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors md:px-4 md:py-2 md:text-sm {tourState.currentRoomId === room.id ? 'bg-white text-black shadow-lg' : 'bg-white/15 text-white backdrop-blur-sm hover:bg-white/25'}"
						onclick={() => tourState.navigateTo(room.id)}
					>{room.name}</button>
				{/each}
			</div>
		{/if}
	{/if}

	{#if phase === 'conclusion'}
		<TourConclusion {property} onclose={handleCloseConclusion} />
	{/if}

	{#if phase === 'leadCapture'}
		<LeadCapture />
	{/if}
</div>

<style>
	@keyframes phone-rotate { 0%, 100% { transform: rotate(0deg); } 30% { transform: rotate(90deg); } 70% { transform: rotate(90deg); } }
	@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
	:global(.animate-phone-rotate) { animation: phone-rotate 2.5s ease-in-out 1; }
	:global(.animate-fade-in) { animation: fade-in 0.6s ease-out; }
</style>
