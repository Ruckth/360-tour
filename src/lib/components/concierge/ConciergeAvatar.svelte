<script lang="ts">
	let { size = 'md' }: { size?: 'sm' | 'md' | 'lg' } = $props();

	const sizeClasses = $derived(
		size === 'sm'
			? 'h-8 w-8 text-xs'
			: size === 'md'
				? 'h-12 w-12 text-base'
				: 'h-14 w-14 text-lg'
	);
</script>

<div
	class="flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500 font-bold text-white shadow-md {sizeClasses}"
>
	N
</div>
