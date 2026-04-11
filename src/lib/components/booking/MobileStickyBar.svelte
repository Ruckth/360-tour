<script lang="ts">
	import { goto } from '$app/navigation';

	let {
		pricePerNight,
		propertyId
	}: {
		pricePerNight: number;
		propertyId: string;
	} = $props();

	function handleBook() {
		goto('/booking?unit=' + propertyId);
	}
</script>

<div class="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] md:hidden" style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))">
	<div class="flex items-center justify-between">
		<div>
			<div class="flex items-baseline gap-1.5">
				<span class="text-lg font-bold text-card-foreground">&#3647;{pricePerNight.toLocaleString()}</span>
			</div>
			<p class="text-[11px] text-muted-foreground">/night &middot; Direct price</p>
		</div>
		<button
			onclick={handleBook}
			class="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition hover:bg-primary/90"
		>
			Book
		</button>
	</div>
</div>
