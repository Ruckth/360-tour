<script lang="ts">
	import { Shield, CreditCard, Clock, BadgeCheck, RefreshCw, HeadphonesIcon } from '@lucide/svelte';

	let { variant = 'default' }: { variant?: 'default' | 'compact' | 'dark' } = $props();
</script>

{#if variant === 'compact'}
	<div class="flex flex-wrap items-center justify-center gap-3 py-2">
		<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<Shield class="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
			<span>Secure Payment</span>
		</div>
		<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<Clock class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
			<span>Free Cancellation 48h</span>
		</div>
		<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<BadgeCheck class="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
			<span>Verified Property</span>
		</div>
	</div>
{:else if variant === 'dark'}
	<div class="flex flex-wrap items-center justify-center gap-4 py-2">
		<div class="flex items-center gap-1.5 text-xs text-white/60">
			<Shield class="h-3.5 w-3.5 text-gold" />
			<span>Secure Payment</span>
		</div>
		<div class="flex items-center gap-1.5 text-xs text-white/60">
			<Clock class="h-3.5 w-3.5 text-gold" />
			<span>Free Cancellation 48h</span>
		</div>
		<div class="flex items-center gap-1.5 text-xs text-white/60">
			<BadgeCheck class="h-3.5 w-3.5 text-gold" />
			<span>Verified</span>
		</div>
	</div>
{:else}
	<div class="grid grid-cols-2 gap-3 md:grid-cols-3">
		<div class="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40">
				<Shield class="h-4 w-4 text-green-600 dark:text-green-400" />
			</div>
			<div>
				<p class="text-xs font-semibold text-foreground">Secure Payment</p>
				<p class="text-[10px] text-muted-foreground">SSL encrypted checkout</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
				<Clock class="h-4 w-4 text-blue-600 dark:text-blue-400" />
			</div>
			<div>
				<p class="text-xs font-semibold text-foreground">Free Cancellation</p>
				<p class="text-[10px] text-muted-foreground">Up to 48h before check-in</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/40">
				<BadgeCheck class="h-4 w-4 text-purple-600 dark:text-purple-400" />
			</div>
			<div>
				<p class="text-xs font-semibold text-foreground">Verified Property</p>
				<p class="text-[10px] text-muted-foreground">Inspected & guaranteed</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
				<CreditCard class="h-4 w-4 text-amber-600 dark:text-amber-400" />
			</div>
			<div>
				<p class="text-xs font-semibold text-foreground">No Hidden Fees</p>
				<p class="text-[10px] text-muted-foreground">Price you see is what you pay</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
				<RefreshCw class="h-4 w-4 text-amber-600 dark:text-amber-400" />
			</div>
			<div>
				<p class="text-xs font-semibold text-foreground">Instant Confirmation</p>
				<p class="text-[10px] text-muted-foreground">No waiting for approval</p>
			</div>
		</div>

		<div class="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/40">
				<HeadphonesIcon class="h-4 w-4 text-rose-600 dark:text-rose-400" />
			</div>
			<div>
				<p class="text-xs font-semibold text-foreground">WhatsApp Support</p>
				<p class="text-[10px] text-muted-foreground">Direct host communication</p>
			</div>
		</div>
	</div>
{/if}
