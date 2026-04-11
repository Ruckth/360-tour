<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { interactivity, OrbitControls } from '@threlte/extras';
	import { TextureLoader, SRGBColorSpace, type Texture } from 'three';
	import { tourState } from '$lib/stores/tour.svelte';
	import RoomSphere from './RoomSphere.svelte';
	import Hotspot from './Hotspot.svelte';

	interactivity();

	let textureMap = $state<Record<string, Texture>>({});
	let loadGeneration = 0;

	// Load textures reactively based on activeRooms
	$effect(() => {
		const roomsToLoad = tourState.activeRooms;
		const total = roomsToLoad.length;
		if (total === 0) return;

		const gen = ++loadGeneration;
		textureMap = {};
		let loaded = 0;

		function onLoaded() {
			if (gen !== loadGeneration) return;
			loaded++;
			if (loaded >= total) {
				tourState.allTexturesLoaded = true;
			}
		}

		const loader = new TextureLoader();
		for (const room of roomsToLoad) {
			loader.load(
				room.imagePath,
				(texture) => {
					if (gen !== loadGeneration) return;
					texture.colorSpace = SRGBColorSpace;
					textureMap[room.id] = texture;
					onLoaded();
				},
				undefined,
				() => {
					onLoaded();
				}
			);
		}
	});

	// Crossfade animation
	const FADE_DURATION = 0.4;
	useTask((delta) => {
		if (!tourState.isTransitioning) return;
		tourState.transitionProgress = Math.min(1, tourState.transitionProgress + delta / FADE_DURATION);
		if (tourState.transitionProgress >= 1) {
			tourState.completeTransition();
		}
	});

	let currentTexture = $derived(textureMap[tourState.currentRoomId]);
	let previousTexture = $derived(
		tourState.previousRoomId ? textureMap[tourState.previousRoomId] : undefined
	);
	let newOpacity = $derived(tourState.transitionProgress);
	let oldOpacity = $derived(1 - tourState.transitionProgress);
</script>

<T.PerspectiveCamera makeDefault fov={75} near={0.1} far={1100} position={[0, 0, 0.1]}>
	<OrbitControls
		enableZoom={false}
		enablePan={false}
		enableDamping
		dampingFactor={0.12}
		rotateSpeed={-0.45}
	/>
</T.PerspectiveCamera>

{#if tourState.allTexturesLoaded}
	{#if previousTexture && tourState.isTransitioning}
		<RoomSphere texture={previousTexture} opacity={oldOpacity} />
	{/if}

	{#if currentTexture}
		<RoomSphere
			texture={currentTexture}
			opacity={tourState.isTransitioning ? newOpacity : 1}
		/>
	{/if}

	{#if !tourState.isTransitioning}
		{#each tourState.currentHotspots as hotspot (hotspot.id)}
			<Hotspot
				position={hotspot.position}
				label={hotspot.label}
				onclick={() => tourState.navigateTo(hotspot.targetRoomId)}
			/>
		{/each}
	{/if}
{/if}
