<script lang="ts">
	import ConciergeAvatar from './ConciergeAvatar.svelte';
</script>

<div class="flex items-end gap-2 px-4 py-1">
	<ConciergeAvatar size="sm" />
	<div
		class="inline-flex items-center gap-1 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 dark:bg-slate-800"
	>
		<span class="typing-dot h-2 w-2 rounded-full bg-slate-400" style="animation-delay: 0s"></span>
		<span class="typing-dot h-2 w-2 rounded-full bg-slate-400" style="animation-delay: 0.15s"
		></span>
		<span class="typing-dot h-2 w-2 rounded-full bg-slate-400" style="animation-delay: 0.3s"
		></span>
	</div>
</div>

<style>
	@keyframes typing-bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
		}
		30% {
			transform: translateY(-6px);
		}
	}

	.typing-dot {
		animation: typing-bounce 1.2s ease-in-out infinite;
	}
</style>
