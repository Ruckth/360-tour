<script lang="ts">
	import { onMount } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from 'convex/_generated/api';
	import { MessageCircle, X, Send, Sparkles, ArrowRight } from '@lucide/svelte';
	import MessagingButtons from './MessagingButtons.svelte';

	let {
		propertySlug = '',
		propertyName = '',
		whatsappNumber = '+66123456789',
		lineId = ''
	}: {
		propertySlug?: string;
		propertyName?: string;
		whatsappNumber?: string;
		lineId?: string;
	} = $props();

	const client = useConvexClient();

	let isOpen = $state(false);
	let sessionId = $state<string | null>(null);
	let inputText = $state('');
	let isTyping = $state(false);
	let messagesContainer = $state<HTMLDivElement | null>(null);

	// Reactive query for session messages
	const session = useQuery(
		api.chat.getSession,
		() => (sessionId ? { sessionId: sessionId as any } : 'skip')
	);

	const messages = $derived(session.data?.messages ?? []);

	const quickReplies = $derived(
		propertySlug
			? [
					{
						label: 'Check availability',
						text: `Is the ${propertyName || 'villa'} available next week?`,
						answer: `Please use the **booking calendar** on this page to check live availability for the ${propertyName || 'villa'}. For same-day requests, tap **WhatsApp** or **LINE** below for instant confirmation.`
					},
					{
						label: 'See pricing',
						text: `What's the nightly rate for the ${propertyName || 'villa'} for 3 nights?`,
						answer: `Our **direct rate** saves you ~15% vs Agoda/Booking. You'll see the exact nightly price, total, and any current offers in the pricing card. Longer stays unlock automatic discounts.`
					},
					{
						label: 'Villa details',
						text: `Tell me about the ${propertyName || 'villa'}`,
						answer: `Full details — amenities, bedrooms, guest capacity, and photos — are on this page. Scroll down for the complete list, guest reviews, and direct booking benefits.`
					}
				]
			: [
					{
						label: 'Browse villas',
						text: 'What villa types do you have available?',
						answer: `We offer **3 villa types**: Pool Villa (2BR, private infinity pool), Sunset Suite (1BR, ocean view), and Garden Retreat (3BR, family). Scroll up to "Our Villas" to compare.`
					},
					{
						label: 'Best for couples',
						text: 'Which villa is best for a couple?',
						answer: `The **Sunset Suite** is our couples' favorite — a 1-bedroom ocean-view retreat with a private terrace. The Pool Villa also works beautifully if you want your own infinity pool.`
					},
					{
						label: 'Airport transfer',
						text: 'Do you offer airport transfers?',
						answer: `Yes. Private airport pickup from **Samui Airport (USM)** is complimentary for stays of 3+ nights, otherwise ~฿1,200 each way. Just message us your flight details on WhatsApp.`
					}
				]
	);

	// Auto-scroll to bottom when messages change
	$effect(() => {
		if (messages.length > 0 && messagesContainer) {
			requestAnimationFrame(() => {
				messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
			});
		}
	});

	async function openChat() {
		isOpen = true;

		if (!sessionId) {
			try {
				const id = await client.mutation(api.chat.createSession, {
					propertyId: undefined,
					channel: 'web'
				});
				sessionId = id;
			} catch (e) {
				console.error('Failed to create chat session:', e);
			}
		}
	}

	function closeChat() {
		isOpen = false;
	}

	async function sendPreset(qr: { text: string; answer: string }) {
		if (!sessionId || isTyping) return;
		await client.mutation(api.chat.addMessage, {
			sessionId: sessionId as any,
			role: 'user',
			content: qr.text
		});
		await client.mutation(api.chat.addMessage, {
			sessionId: sessionId as any,
			role: 'assistant',
			content: qr.answer
		});
	}

	async function sendMessage(text?: string) {
		const messageText = text ?? inputText.trim();
		if (!messageText || !sessionId || isTyping) return;

		inputText = '';
		isTyping = true;

		try {
			await client.action(api.chat.respond, {
				sessionId: sessionId as any,
				userMessage: messageText,
				propertySlug: propertySlug || undefined
			});
		} catch (e) {
			console.error('Chat error:', e);
			// Add error message locally
			await client.mutation(api.chat.addMessage, {
				sessionId: sessionId as any,
				role: 'assistant',
				content: "Sorry, I'm having trouble connecting. Please try again or message us on WhatsApp for immediate help."
			});
		} finally {
			isTyping = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	function formatMessage(content: string): string {
		// Simple markdown-like formatting
		return content
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\n/g, '<br>');
	}
</script>

<!-- Floating chat button -->
{#if !isOpen}
	<button
		onclick={openChat}
		class="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-all hover:scale-105 hover:shadow-2xl active:scale-95 md:bottom-8 md:right-8"
		aria-label="Open AI chat"
		style="padding-bottom: env(safe-area-inset-bottom, 0px);"
	>
		<MessageCircle class="h-6 w-6" />
		<span class="absolute -right-0.5 -top-0.5 flex h-3 w-3">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
			<span class="relative inline-flex h-3 w-3 rounded-full bg-green-500"></span>
		</span>
	</button>
{/if}

<!-- Chat window -->
{#if isOpen}
	<div class="fixed bottom-0 right-0 z-50 flex h-full w-full flex-col bg-card shadow-2xl md:bottom-8 md:right-8 md:h-[600px] md:w-[400px] md:rounded-2xl md:border md:border-border">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border bg-primary/5 px-4 py-3 md:rounded-t-2xl">
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary">
					<Sparkles class="h-4 w-4 text-primary-foreground" />
				</div>
				<div>
					<h3 class="text-sm font-semibold text-foreground">Villa Concierge</h3>
					<p class="text-xs text-muted-foreground">
						{#if isTyping}
							Thinking...
						{:else}
							Ask about pricing & availability
						{/if}
					</p>
				</div>
			</div>
			<button
				onclick={closeChat}
				class="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
				aria-label="Close chat"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<!-- Messages -->
		<div
			bind:this={messagesContainer}
			class="flex-1 overflow-y-auto px-4 py-4 space-y-3"
		>
			{#if messages.length === 0 && !isTyping}
				<!-- Welcome message -->
				<div class="flex gap-2.5">
					<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary">
						<Sparkles class="h-3.5 w-3.5 text-primary-foreground" />
					</div>
					<div class="max-w-[80%] rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm text-foreground">
						{#if propertyName}
							Welcome! I'm your villa concierge. Ask me anything about the <strong>{propertyName}</strong> — availability, pricing, amenities, or local recommendations.
						{:else}
							Welcome to Seaview Residence. I can help you find the perfect villa for your stay. Ask about our villas, pricing, or availability.
						{/if}
					</div>
				</div>

				<!-- Quick replies -->
				<div class="flex flex-wrap gap-2 pl-9">
					{#each quickReplies as qr}
						<button
							onclick={() => sendPreset(qr)}
							class="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
						>
							{qr.label}
							<ArrowRight class="h-3 w-3 text-muted-foreground" />
						</button>
					{/each}
				</div>
			{/if}

			{#each messages as msg}
				{#if msg.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[80%] rounded-2xl rounded-tr-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
							{msg.content}
						</div>
					</div>
				{:else}
					<div class="flex gap-2.5">
						<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary">
							<Sparkles class="h-3.5 w-3.5 text-primary-foreground" />
						</div>
						<div class="max-w-[80%] rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm text-foreground">
							{@html formatMessage(msg.content)}
						</div>
					</div>
				{/if}
			{/each}

			{#if isTyping}
				<div class="flex gap-2.5">
					<div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary">
						<Sparkles class="h-3.5 w-3.5 text-primary-foreground" />
					</div>
					<div class="rounded-2xl rounded-tl-md bg-muted px-4 py-3">
						<div class="flex gap-1">
							<span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style="animation-delay: 0ms"></span>
							<span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style="animation-delay: 150ms"></span>
							<span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style="animation-delay: 300ms"></span>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Messaging buttons bar -->
		<div class="border-t border-border bg-muted/30 px-4 py-2">
			<div class="flex items-center justify-between">
				<span class="text-[10px] text-muted-foreground">Prefer to chat with the host?</span>
				<MessagingButtons
					{whatsappNumber}
					{lineId}
					propertyName={propertyName}
				/>
			</div>
		</div>

		<!-- Input -->
		<div class="border-t border-border px-4 py-3" style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));">
			<div class="flex items-center gap-2">
				<input
					type="text"
					bind:value={inputText}
					onkeydown={handleKeydown}
					placeholder="Ask about pricing, availability..."
					disabled={isTyping}
					class="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
				/>
				<button
					onclick={() => sendMessage()}
					disabled={!inputText.trim() || isTyping}
					class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
					aria-label="Send message"
				>
					<Send class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>
{/if}
