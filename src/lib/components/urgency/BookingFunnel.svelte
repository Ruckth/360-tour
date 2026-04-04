<script lang="ts">
	import { bookingState } from '$lib/stores/booking.svelte';

	const steps = ['Dates', 'Guests', 'Confirm'];
</script>

<div class="flex items-center justify-center gap-0">
	{#each steps as step, i}
		{@const stepNum = i + 1}
		{@const isActive = bookingState.currentStep === stepNum}
		{@const isCompleted = bookingState.currentStep > stepNum}

		{#if i > 0}
			<div
				class="h-0.5 w-8 {isCompleted ? 'bg-sky-500' : 'bg-border'}"
			></div>
		{/if}

		<div class="flex flex-col items-center gap-1">
			<div
				class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors
					{isCompleted ? 'bg-sky-500 text-white' : isActive ? 'bg-sky-500 text-white ring-2 ring-sky-500/30' : 'bg-muted text-muted-foreground'}"
			>
				{#if isCompleted}
					<svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
					</svg>
				{:else}
					{stepNum}
				{/if}
			</div>
			<span class="text-[10px] font-medium {isActive || isCompleted ? 'text-foreground' : 'text-muted-foreground'}">
				{step}
			</span>
		</div>
	{/each}
</div>
