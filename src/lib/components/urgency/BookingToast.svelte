<script lang="ts">
	import { getRecentBooking, type BookingNotification } from '$lib/data/urgency';

	let toast = $state<BookingNotification | null>(null);
	let visible = $state(false);

	$effect(() => {
		function showToast() {
			toast = getRecentBooking();
			visible = true;
			setTimeout(() => {
				visible = false;
			}, 4000);
		}

		function scheduleNext(): ReturnType<typeof setTimeout> {
			const delay = 20000 + Math.random() * 15000; // 20-35s
			return setTimeout(() => {
				showToast();
				timer = scheduleNext();
			}, delay);
		}

		// Show first toast after 8-15s
		let timer = setTimeout(() => {
			showToast();
			timer = scheduleNext();
		}, 8000 + Math.random() * 7000);

		return () => clearTimeout(timer);
	});
</script>

{#if toast && visible}
	<div class="fixed bottom-4 left-4 z-50 w-72 animate-toast-slide-in md:bottom-6 md:left-6 md:w-80">
		<div class="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xl">
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
				<svg class="h-4 w-4 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
				</svg>
			</div>
			<div class="min-w-0">
				<p class="text-sm font-medium text-card-foreground">
					{toast.guest} booked {toast.property}
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">{toast.timeAgo}</p>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes toast-slide-in {
		from {
			opacity: 0;
			transform: translateY(100%) translateX(-20px);
		}
		to {
			opacity: 1;
			transform: translateY(0) translateX(0);
		}
	}

	:global(.animate-toast-slide-in) {
		animation: toast-slide-in 0.4s ease-out;
	}
</style>
