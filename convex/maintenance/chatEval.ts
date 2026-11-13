import { internalAction, internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { generateConciergeReply, type GenerateConciergeReplyArgs } from '../concierge/model';

// Eval-only helpers for the AI booking eval (scripts/ai-booking-eval.ts). Internal: CLI/admin only.

export const createSession = internalMutation({
	args: {
		channel: v.union(v.literal('web'), v.literal('whatsapp'), v.literal('facebook'), v.literal('line'), v.literal('instagram')),
		propertySlug: v.optional(v.string()),
		visitorPhone: v.optional(v.string()),
		visitorName: v.optional(v.string())
	},
	handler: async (ctx, args) =>
		await ctx.db.insert('conversations', {
			channel: args.channel,
			visitorId: `eval:${args.channel}:${crypto.randomUUID()}`,
			...(args.propertySlug ? { propertySlug: args.propertySlug } : {}),
			...(args.visitorPhone ? { visitorPhone: args.visitorPhone } : {}),
			...(args.visitorName ? { visitorName: args.visitorName } : {}),
			createdAt: Date.now()
		})
});

/** Evaluation transcripts intentionally skip production quotas, alerts and inbox tasks. */
export const writeMessage = internalMutation({
  args: { sessionId: v.id('conversations'), role: v.union(v.literal('user'), v.literal('assistant')), content: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session?.visitorId?.startsWith('eval:')) throw new Error('Requires an eval session');
    if (args.content.length > 2000 && args.role === 'user') throw new Error('Message is too long');
    if (args.role === 'assistant' && session.aiPaused) return null;
    const timestamp = Date.now();
    const id = await ctx.db.insert('messages', { ...args, timestamp });
    await ctx.db.patch(args.sessionId, { messageCount: (session.messageCount ?? 0) + 1, latestMessageAt: timestamp });
    return id;
  }
});

/** Explicit-model comparison using the same concierge pipeline, with no channel delivery. */
export const comparisonTurn = internalAction({
	args: {
		sessionId: v.id('conversations'), userMessage: v.string(), siteUrl: v.optional(v.string()),
		model: v.union(v.literal('openai/gpt-6-luna'), v.literal('z-ai/glm-5.3-flash'))
	},
	handler: async (ctx, args) => {
		const session: Doc<'conversations'> | null = await ctx.runQuery(internal.messaging.chat.getSessionInternal, { sessionId: args.sessionId });
		if (!session || !session.visitorId?.startsWith('eval:')) throw new Error('Comparison requires an eval session');
		await ctx.runMutation(internal.maintenance.chatEval.writeMessage, { sessionId: args.sessionId, role: 'user', content: args.userMessage });
		const toolTrace: NonNullable<GenerateConciergeReplyArgs['toolTrace']> = [];
		const llmTrace: NonNullable<GenerateConciergeReplyArgs['llmTrace']> = [];
		const result = await generateConciergeReply(ctx, {
			...args, channel: session.channel, bookingFlow: session.channel !== 'web', evalModel: args.model, toolTrace, llmTrace
		}, session);
		await ctx.runMutation(internal.maintenance.chatEval.writeMessage, { sessionId: args.sessionId, role: 'assistant', content: result.response });
		return { ...result, requestedModel: args.model, toolTrace, llmTrace };
	}
});

/** One messaging turn like the webhooks' AI path: store the guest message, reply, store the reply. */
export const messagingTurn = internalAction({
	args: { sessionId: v.id('conversations'), userMessage: v.string(), siteUrl: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const session: Doc<'conversations'> | null = await ctx.runQuery(internal.messaging.chat.getSessionInternal, {
			sessionId: args.sessionId
		});
		if (!session?.visitorId?.startsWith('eval:')) throw new Error('Requires an eval session');
		await ctx.runMutation(internal.maintenance.chatEval.writeMessage, { sessionId: args.sessionId, role: 'user', content: args.userMessage });
		const toolTrace: NonNullable<GenerateConciergeReplyArgs['toolTrace']> = [];
		const channel = session.channel === 'web' ? 'whatsapp' : session.channel;
		const result = await generateConciergeReply(ctx, { ...args, channel, bookingFlow: true, toolTrace }, session);
		await ctx.runMutation(internal.maintenance.chatEval.writeMessage, { sessionId: args.sessionId, role: 'assistant', content: result.response });
		return { ...result, toolTrace };
	}
});
