<script lang="ts">
	import { narrativeState } from '$lib/stores/narrative.svelte';
	import { tourState } from '$lib/stores/tour.svelte';

	let allRoomIds = $derived(narrativeState.allRoomIds);
	let visitedRoomIds = $derived(narrativeState.visitedRoomIds);
	let currentRoomId = $derived(tourState.currentRoomId);
	let allVisited = $derived(narrativeState.allRoomsVisited);
</script>

<div class="flex items-center gap-2">
	{#each allRoomIds as roomId (roomId)}
		{@const isCurrent = roomId === currentRoomId}
		{@const isVisited = visitedRoomIds.has(roomId)}
		<div
			class="rounded-full transition-all duration-500
				{isCurrent
					? 'h-3 w-3 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)] md:h-3.5 md:w-3.5'
					: isVisited
						? 'h-2 w-2 bg-white md:h-2.5 md:w-2.5'
						: 'h-2 w-2 border border-white/40 bg-transparent md:h-2.5 md:w-2.5'}
				"
		></div>
	{/each}
</div>
