<script lang="ts">
	import { Canvas } from '@threlte/core';
	import Scene from './Scene.svelte';
	import { tourState } from '$lib/stores/tour.svelte';
	import { socialProofState } from '$lib/stores/social-proof.svelte';
	import { getSocialProofByPropertyId } from '$lib/data/social-proof';
	import PostTourOverlay from './social/PostTourOverlay.svelte';
	import { onMount } from 'svelte';

	let {
		roomIds,
		propertyName,
		propertyId = '',
		onclose
	}: {
		roomIds: string[];
		propertyName: string;
		propertyId?: string;
		onclose: () => void;
	} = $props();

	const socialProof = $derived(getSocialProofByPropertyId(propertyId));
	const tourSnippets = $derived(socialProof?.tourSnippets ?? []);
	let showPostTourOverlay = $state(false);

	// Init tour state SYNCHRONOUSLY before Canvas/Scene mount
	tourState.init(roomIds);

	let phase = $state<'intro' | 'tour'>('intro');
	let introProgress = $state(0);
	let introTimer: ReturnType<typeof setInterval> | undefined;
	let minTimeReached = $state(false);
	let isMobile = $state(false);

	// Show tour once textures loaded AND minimum intro time passed
	let readyForTour = $derived(tourState.allTexturesLoaded && minTimeReached);

	$effect(() => {
		if (readyForTour && phase === 'intro') {
			setTimeout(() => {
				phase = 'tour';
			}, 400);
		}
	});

	// Start tour timer when entering tour phase
	$effect(() => {
		if (phase === 'tour') {
			socialProofState.startTourTimer();
			return () => {
				socialProofState.stopTourTimer();
			};
		}
	});

	onMount(() => {
		document.body.style.overflow = 'hidden';
		isMobile = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;

		// Desktop: shorter intro (1.5s), Mobile: full 3s with rotate animation
		const duration = isMobile ? 3000 : 1500;
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
		};
	});

	function handleClose() {
		if (socialProofState.tourDuration > 15 && socialProof) {
			showPostTourOverlay = true;
		} else {
			onclose();
		}
	}

	function handlePostTourBook() {
		showPostTourOverlay = false;
		onclose();
	}

	function handlePostTourDismiss() {
		showPostTourOverlay = false;
		onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 bg-black" style="touch-action: none;">
	<!-- Canvas always mounted (loads textures in background) -->
	<div class="absolute inset-0" class:opacity-0={phase === 'intro'} class:pointer-events-none={phase === 'intro'}>
		<Canvas renderMode="always">
			<Scene {tourSnippets} />
		</Canvas>
	</div>

	<!-- Phase 1: Intro / Rotate Phone Screen -->
	{#if phase === 'intro'}
		<div class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black px-6">
			<!-- Close button -->
			<button
				onclick={handleClose}
				class="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white"
				aria-label="Close"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			{#if isMobile}
				<!-- Mobile: Phone rotation animation -->
				<div class="relative mb-8">
					<div class="animate-phone-rotate">
						<svg width="80" height="120" viewBox="0 0 80 120" fill="none" class="text-white">
							<rect x="4" y="4" width="72" height="112" rx="12" stroke="currentColor" stroke-width="2.5" fill="none" />
							<rect x="30" y="100" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.4" />
							<circle cx="40" cy="14" r="2" fill="currentColor" opacity="0.4" />
						</svg>
					</div>
					<div class="absolute -inset-6 animate-spin-slow">
						<svg width="128" height="168" viewBox="-24 -24 128 168" fill="none" class="text-sky-400">
							<path d="M100 60a60 60 0 01-30 52" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 6" opacity="0.5" />
							<path d="M-20 60a60 60 0 0130-52" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 6" opacity="0.5" />
						</svg>
					</div>
				</div>

				<p class="text-center text-lg font-semibold text-white">
					Rotate your phone for<br />the best experience
				</p>
			{:else}
				<!-- Desktop: Simple loading with 360 icon -->
				<div class="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-sky-400/40 bg-sky-500/10 animate-pulse">
					<svg class="h-8 w-8 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
					</svg>
				</div>

				<p class="text-center text-lg font-semibold text-white">
					Preparing your tour
				</p>
			{/if}

			<p class="mt-2 text-center text-sm text-slate-400">
				{propertyName}
			</p>

			<div class="mt-8 h-1 w-48 overflow-hidden rounded-full bg-white/10">
				<div
					class="h-full rounded-full bg-sky-400 transition-all duration-200"
					style="width: {introProgress}%"
				></div>
			</div>

			{#if introProgress >= 100 && !tourState.allTexturesLoaded}
				<p class="mt-3 text-xs text-slate-500">Loading panoramas...</p>
			{/if}
		</div>
	{/if}

	<!-- Phase 2: Tour UI overlays (canvas is already visible) -->
	{#if phase === 'tour'}
		<!-- Top bar -->
		<div class="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 pb-8 pt-3 animate-fade-in md:px-6 md:pb-12 md:pt-4">
			<div class="pointer-events-auto">
				<p class="text-sm font-semibold text-white md:text-lg">{propertyName}</p>
				<p class="text-xs text-white/60 md:text-sm">{tourState.currentRoom.name}</p>
			</div>
			<button
				onclick={handleClose}
				class="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20"
				aria-label="Close tour"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Bottom room navigation -->
		{#if tourState.activeRooms.length > 1}
			<div class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 animate-fade-in md:bottom-6 md:gap-2">
				{#each tourState.activeRooms as room (room.id)}
					<button
						class="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors md:px-4 md:py-2 md:text-sm {tourState.currentRoomId === room.id
							? 'bg-white text-black shadow-lg'
							: 'bg-white/15 text-white backdrop-blur-sm hover:bg-white/25'}"
						onclick={() => tourState.navigateTo(room.id)}
					>
						{room.name}
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Post-tour overlay -->
{#if showPostTourOverlay && socialProof}
	<PostTourOverlay
		{propertyName}
		{socialProof}
		onbook={handlePostTourBook}
		ondismiss={handlePostTourDismiss}
	/>
{/if}

<style>
	@keyframes phone-rotate {
		0%, 100% { transform: rotate(0deg); }
		25% { transform: rotate(90deg); }
		50% { transform: rotate(90deg); }
		75% { transform: rotate(0deg); }
	}

	@keyframes spin-slow {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	:global(.animate-phone-rotate) {
		animation: phone-rotate 3s ease-in-out infinite;
	}

	:global(.animate-spin-slow) {
		animation: spin-slow 6s linear infinite;
	}

	:global(.animate-fade-in) {
		animation: fade-in 0.6s ease-out;
	}
</style>
