<script lang="ts">
	import { UserButton, useClerkContext } from 'svelte-clerk';

	let {
		variant = 'desktop',
		scrolled = false,
		isHome = false
	}: {
		variant?: 'desktop' | 'mobile';
		scrolled?: boolean;
		isHome?: boolean;
	} = $props();

	const ctx = useClerkContext();
</script>

{#if ctx.auth.userId}
	<UserButton />
{:else if ctx.isLoaded}
	{#if variant === 'desktop'}
		<a
			href="/sign-in"
			class="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors {scrolled || !isHome ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'text-white/70 hover:text-white'}"
		>Sign in</a>
	{:else}
		<a
			href="/sign-in"
			class="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
		>Sign in</a>
	{/if}
{/if}
