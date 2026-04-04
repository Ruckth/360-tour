<script lang="ts">
	import { Sun, Moon } from '@lucide/svelte';
	import { themeState } from '$lib/stores/theme.svelte';
</script>

<button
	onclick={() => themeState.cycle()}
	class="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
	aria-label={themeState.dark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if themeState.dark}
		<Sun class="h-4 w-4" />
	{:else}
		<Moon class="h-4 w-4" />
	{/if}
</button>
