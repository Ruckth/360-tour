import { internalAction, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { generateConciergeReply, type GenerateConciergeReplyArgs } from './chatAi';

// Eval-only helpers for the AI booking eval (scripts/ai-booking-eval.ts). Internal: CLI/admin only.

export const createSession = internalMutation({
	args: {
		channel: v.union(v.literal('whatsapp'), v.literal('facebook'), v.literal('line')),
		visitorPhone: v.optional(v.string()),
		visitorName: v.optional(v.string())
	},
	handler: async (ctx, args) =>
		await ctx.db.insert('chatSessions', {
			channel: args.channel,
			visitorId: `eval:${args.channel}:${crypto.randomUUID()}`,
			...(args.visitorPhone ? { visitorPhone: args.visitorPhone } : {}),
			...(args.visitorName ? { visitorName: args.visitorName } : {}),
			createdAt: Date.now()
		})
});

/** One messaging turn like the webhooks' AI path: store the guest message, reply, store the reply. */
export const messagingTurn = internalAction({
	args: { sessionId: v.id('chatSessions'), userMessage: v.string(), siteUrl: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const session: Doc<'chatSessions'> | null = await ctx.runQuery(api.chat.getSession, {
			sessionId: args.sessionId
		});
		if (!session) throw new Error('Session not found');
		await ctx.runMutation(api.chat.addMessage, { sessionId: args.sessionId, role: 'user', content: args.userMessage });
		const toolTrace: NonNullable<GenerateConciergeReplyArgs['toolTrace']> = [];
		const channel = session.channel === 'web' ? 'whatsapp' : session.channel;
		const result = await generateConciergeReply(ctx, { ...args, channel, bookingFlow: true, toolTrace }, session);
		await ctx.runMutation(api.chat.addMessage, { sessionId: args.sessionId, role: 'assistant', content: result.response });
		return { ...result, toolTrace };
	}
});
