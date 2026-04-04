<script lang="ts">
	import { getViewerCount, fluctuateViewerCount } from '$lib/data/urgency';

	let { propertyId }: { propertyId: string } = $props();

	let count = $state(getViewerCount(propertyId));

	$effect(() => {
		function tick() {
			count = fluctuateViewerCount(count);
			const next = 3000 + Math.random() * 5000; // 3-8s
			timer = setTimeout(tick, next);
		}
		let timer = setTimeout(tick, 3000 + Math.random() * 5000);
		return () => clearTimeout(timer);
	});
</script>

<div class="flex items-center gap-2 text-sm text-muted-foreground">
	<span class="relative flex h-2.5 w-2.5">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
		<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
	</span>
	<span>
		<strong class="font-semibold text-foreground">{count}</strong> people viewing right now
	</span>
</div>
