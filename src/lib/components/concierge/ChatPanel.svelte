<script lang="ts">
	import { conciergeState } from '$lib/stores/concierge.svelte';
	import { onMount } from 'svelte';
	import ConciergeAvatar from './ConciergeAvatar.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import TypingIndicator from './TypingIndicator.svelte';

	let messagesContainer: HTMLDivElement | undefined = $state();
	let inputValue = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let isMobile = $state(false);

	// Mobile sheet drag state
	let sheetY = $state(0);
	let isDragging = $state(false);
	let dragStartY = $state(0);
	let dragStartSheetY = $state(0);

	const FULL_HEIGHT_VH = 70;

	onMount(() => {
		isMobile = window.innerWidth < 768 || 'ontouchstart' in window;
	});

	// Auto-scroll on new messages
	$effect(() => {
		const _len = conciergeState.messages.length;
		const _typing = conciergeState.isTyping;
		setTimeout(() => {
			if (messagesContainer) {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}
		}, 50);
	});

	function handleSend() {
		const text = inputValue.trim();
		if (!text) return;
		conciergeState.addUserMessage(text);
		inputValue = '';
		inputEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	// Mobile touch handlers
	function handleTouchStart(e: TouchEvent) {
		isDragging = true;
		dragStartY = e.touches[0].clientY;
		dragStartSheetY = sheetY;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isDragging) return;
		const delta = e.touches[0].clientY - dragStartY;
		sheetY = Math.max(0, dragStartSheetY + delta);
	}

	function handleTouchEnd() {
		if (!isDragging) return;
		isDragging = false;

		const fullHeight = (window.innerHeight * FULL_HEIGHT_VH) / 100;
		if (sheetY > fullHeight * 0.4) {
			conciergeState.close();
			sheetY = 0;
		} else {
			sheetY = 0;
		}
	}
</script>

{#if conciergeState.isOpen}
	{#if isMobile}
		<!-- Mobile: Bottom sheet backdrop -->
		<button
			class="chat-fade-in fixed inset-0 z-[59] bg-black/40 backdrop-blur-sm"
			onclick={() => conciergeState.close()}
			aria-label="Close chat"
		></button>

		<!-- Mobile: Bottom sheet -->
		<div
			class="chat-slide-up fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-3xl bg-background shadow-2xl"
			style="height: {FULL_HEIGHT_VH}vh; transform: translateY({isDragging
				? sheetY
				: 0}px); transition: {isDragging ? 'none' : 'transform 0.3s ease-out'};"
		>
			<!-- Drag handle -->
			<div
				class="flex flex-col items-center pb-0 pt-2"
				ontouchstart={handleTouchStart}
				ontouchmove={handleTouchMove}
				ontouchend={handleTouchEnd}
				role="separator"
			>
				<div class="h-1 w-12 rounded-full bg-slate-300 dark:bg-slate-600"></div>
			</div>

			<!-- Header -->
			<div
				class="flex items-center gap-3 border-b border-border px-4 py-3"
				ontouchstart={handleTouchStart}
				ontouchmove={handleTouchMove}
				ontouchend={handleTouchEnd}
				role="banner"
			>
				<ConciergeAvatar size="sm" />
				<div class="flex-1">
					<p class="text-sm font-semibold text-foreground">Noi</p>
					<div class="flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
						<span class="text-xs text-muted-foreground">Online</span>
					</div>
				</div>
				<button
					onclick={() => conciergeState.close()}
					class="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
					aria-label="Close chat"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Messages -->
			<div bind:this={messagesContainer} class="flex-1 overflow-y-auto py-3">
				{#each conciergeState.messages as message (message.id)}
					<ChatMessage {message} />
				{/each}
				{#if conciergeState.isTyping}
					<TypingIndicator />
				{/if}
			</div>

			<!-- Input -->
			<div
				class="border-t border-border bg-background px-3 py-2 pb-[env(safe-area-inset-bottom,8px)]"
			>
				<div class="flex items-center gap-2">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						onkeydown={handleKeydown}
						type="text"
						placeholder="Ask me anything..."
						class="flex-1 rounded-full border border-border bg-muted/50 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/50"
					/>
					<button
						onclick={handleSend}
						disabled={!inputValue.trim()}
						class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="Send message"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 12h14M12 5l7 7-7 7"
							/>
						</svg>
					</button>
				</div>
			</div>
		</div>
	{:else}
		<!-- Desktop: Floating card -->
		<div
			class="chat-slide-up fixed bottom-24 right-6 z-[60] flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
		>
			<!-- Header -->
			<div class="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
				<ConciergeAvatar size="sm" />
				<div class="flex-1">
					<p class="text-sm font-semibold text-foreground">Noi</p>
					<div class="flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
						<span class="text-xs text-muted-foreground">Online</span>
					</div>
				</div>
				<button
					onclick={() => conciergeState.close()}
					class="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
					aria-label="Close chat"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Messages -->
			<div bind:this={messagesContainer} class="flex-1 overflow-y-auto py-3">
				{#each conciergeState.messages as message (message.id)}
					<ChatMessage {message} />
				{/each}
				{#if conciergeState.isTyping}
					<TypingIndicator />
				{/if}
			</div>

			<!-- Input -->
			<div class="border-t border-border bg-background px-3 py-2">
				<div class="flex items-center gap-2">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						onkeydown={handleKeydown}
						type="text"
						placeholder="Ask me anything..."
						class="flex-1 rounded-full border border-border bg-muted/50 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/50"
					/>
					<button
						onclick={handleSend}
						disabled={!inputValue.trim()}
						class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="Send message"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 12h14M12 5l7 7-7 7"
							/>
						</svg>
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}

<style>
	@keyframes chat-slide-up {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes chat-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.chat-slide-up {
		animation: chat-slide-up 0.3s ease-out;
	}

	.chat-fade-in {
		animation: chat-fade-in 0.2s ease-out;
	}
</style>
