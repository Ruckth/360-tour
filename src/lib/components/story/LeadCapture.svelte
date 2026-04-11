<script lang="ts">
	import { narrativeState } from '$lib/stores/narrative.svelte';
</script>

<div class="lead-capture-enter absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md">
	<div class="mx-auto w-full max-w-sm px-6">
		<button onclick={() => narrativeState.hideLeadCapture()} class="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white md:right-6 md:top-6" aria-label="Close">
			<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
		</button>

		{#if narrativeState.leadSubmitted}
			<div class="text-center">
				<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gold/20">
					<svg class="h-8 w-8 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
				</div>
				<h3 class="font-serif text-2xl font-semibold text-white">Dream saved</h3>
				<p class="mt-2 text-sm text-white/60">We'll send the details to your inbox. When you're ready, your stay will be waiting.</p>
				<button onclick={() => narrativeState.hideLeadCapture()} class="mt-6 rounded-xl border border-white/20 px-6 py-2.5 text-sm text-white/70 transition hover:bg-white/10 hover:text-white">Back to tour</button>
			</div>
		{:else}
			<div class="text-center">
				<h3 class="font-serif text-2xl font-semibold text-white md:text-3xl">Not ready yet?</h3>
				<p class="mt-2 text-sm text-white/60 md:text-base">We'll save this dream for you.</p>
			</div>
			<div class="mt-6">
				<input type="email" placeholder="your@email.com" bind:value={narrativeState.leadEmail} class="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder-white/30 backdrop-blur-sm transition focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30" onkeydown={(e) => { if (e.key === 'Enter') narrativeState.submitEmail(); }} />
				<button onclick={() => narrativeState.submitEmail()} disabled={!narrativeState.leadEmail.trim()} class="mt-3 w-full rounded-xl bg-gold py-3 text-sm font-semibold text-navy shadow-lg shadow-gold/25 transition-all duration-300 hover:bg-gold-light disabled:opacity-40 disabled:hover:bg-gold">Send me details</button>
			</div>
			<p class="mt-4 text-center text-xs text-white/30">No spam. Just the details of your dream stay.</p>
		{/if}
	</div>
</div>

<style>
	@keyframes lead-capture-enter { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
	:global(.lead-capture-enter) { animation: lead-capture-enter 0.5s ease-out forwards; }
</style>
