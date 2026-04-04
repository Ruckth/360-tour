<script lang="ts">
	import { conciergeState } from '$lib/stores/concierge.svelte';
</script>

<button
	onclick={() => conciergeState.toggle()}
	class="fixed bottom-6 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 {conciergeState.isOpen
		? 'bg-slate-700 dark:bg-slate-600'
		: 'bg-gradient-to-br from-amber-500 to-orange-500'}"
	aria-label={conciergeState.isOpen ? 'Close chat' : 'Open chat'}
>
	{#if conciergeState.isOpen}
		<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M6 18L18 6M6 6l12 12"
			/>
		</svg>
	{:else}
		<span class="text-lg font-bold text-white">N</span>
	{/if}

	{#if !conciergeState.isOpen && conciergeState.unreadCount > 0}
		<span
			class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-background"
		>
			{conciergeState.unreadCount > 9 ? '9+' : conciergeState.unreadCount}
		</span>
	{/if}

	{#if !conciergeState.isOpen && conciergeState.unreadCount > 0}
		<span
			class="bubble-pulse absolute inset-0 rounded-full bg-gradient-to-br from-amber-500 to-orange-500"
		></span>
	{/if}
</button>

<style>
	@keyframes bubble-pulse {
		0% {
			opacity: 0.6;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(1.6);
		}
	}

	.bubble-pulse {
		animation: bubble-pulse 1.5s ease-out infinite;
		z-index: -1;
	}
</style>
