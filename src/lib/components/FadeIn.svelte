<script lang="ts">
	import { onMount } from 'svelte';

	let {
		delay = 0,
		y = 20,
		children
	}: {
		delay?: number;
		y?: number;
		children: import('svelte').Snippet;
	} = $props();

	let el: HTMLDivElement | undefined = $state();
	let visible = $state(false);

	onMount(() => {
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					if (delay > 0) {
						setTimeout(() => { visible = true; }, delay);
					} else {
						visible = true;
					}
					observer.disconnect();
				}
			},
			{ threshold: 0.15 }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

<div
	bind:this={el}
	class="fade-in-wrapper"
	style="opacity: {visible ? 1 : 0}; transform: translateY({visible ? 0 : y}px); transition: opacity 0.6s ease-out, transform 0.6s ease-out;"
>
	{@render children()}
</div>
