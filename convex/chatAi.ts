import { action } from './_generated/server';
import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import { callAI, classifyComplexity } from './lib/chatLlm';
import type { ChatMessage } from './lib/chatLlm';
import { TOOLS, executeTool } from './lib/chatTools';
import { getFallbackResponse } from './lib/chatFallback';

export const respond = action({
	args: {
		sessionId: v.id('chatSessions'),
		userMessage: v.string(),
		propertySlug: v.optional(v.string()),
		locale: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const session = await ctx.runQuery(api.chat.getSession, {
			sessionId: args.sessionId
		});
		if (!session) throw new Error('Session not found');

		await ctx.runMutation(api.chat.addMessage, {
			sessionId: args.sessionId,
			role: 'user',
			content: args.userMessage
		});

		const properties = await ctx.runQuery(api.properties.list, {});

		const propertyContext = properties
			.map(
				(p) =>
					`- ${p.name} (slug: ${p.slug}): ${p.tagline}. ฿${p.pricePerNight}/night, ${p.maxGuests} guests max, ${p.bedrooms} bed, ${p.bathrooms} bath, ${p.area}m². Amenities: ${p.amenities.join(', ')}`
			)
			.join('\n');

		const currentProperty = args.propertySlug
			? properties.find((p) => p.slug === args.propertySlug) ?? null
			: null;

		const systemPrompt = `You are a helpful, friendly AI concierge for Seaview Residence, a boutique luxury villa resort in Koh Samui, Thailand. You help guests find the perfect villa and answer questions about pricing and availability.

PROPERTIES:
${propertyContext}

${currentProperty ? `The guest is currently viewing: ${currentProperty.name} (${currentProperty.slug})` : 'The guest is browsing all properties.'}

PRICING:
- All prices are in Thai Baht (฿ / THB)
- Direct booking gives 15% discount off the listed price
- No service fees, no cleaning fees for direct bookings
- Free cancellation up to 48 hours before check-in

STYLE:
- Be warm, concise, and helpful
- Detect the language of the latest visitor message and reply in that same language
- If the latest visitor message language is unclear, reply in English
- Keep resort facts, prices, villa names, cancellation rules, discounts, and booking rules exactly consistent with the data above
- Do not translate villa names, price amounts, currency symbols, or booking rules into different facts
- Use ฿ symbol for prices
- Suggest the 360° virtual tour when relevant
- If the guest seems ready to book, encourage them to use the booking form on the website
- If a question is beyond your knowledge, offer to connect them with the host via WhatsApp
- Keep responses under 150 words unless detailed info is requested`;

		const apiMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

		const recentHistory = await ctx.runQuery(internal.chat.getRecentMessages, {
			sessionId: args.sessionId,
			limit: 10
		});
		for (const msg of recentHistory) {
			apiMessages.push({ role: msg.role, content: msg.content });
		}

		const complexity = classifyComplexity(args.userMessage);

		const apiKey = process.env.AI_API_KEY;
		const apiBase = process.env.AI_API_BASE_URL || 'https://api.x.ai/v1';
		const simpleModel = process.env.AI_SIMPLE_MODEL || 'grok-4.3';
		const complexModel = process.env.AI_COMPLEX_MODEL || 'grok-4.3';

		if (!apiKey) {
			const fallbackResponse = getFallbackResponse(args.userMessage, currentProperty, args.locale);
			await ctx.runMutation(api.chat.addMessage, {
				sessionId: args.sessionId,
				role: 'assistant',
				content: fallbackResponse
			});
			return { response: fallbackResponse, model: 'fallback' };
		}

		const selectedModel = complexity === 'simple' ? simpleModel : complexModel;

		let response = await callAI(apiBase, apiKey, selectedModel, apiMessages, TOOLS);

		let maxToolRounds = 3;
		while (response.tool_calls && response.tool_calls.length > 0 && maxToolRounds > 0) {
			maxToolRounds--;

			apiMessages.push({
				role: 'assistant',
				content: response.content,
				tool_calls: response.tool_calls
			});

			for (const toolCall of response.tool_calls) {
				const fnName = toolCall.function.name;
				let fnArgs: Record<string, unknown>;
				try {
					fnArgs = JSON.parse(toolCall.function.arguments);
				} catch {
					fnArgs = {};
				}

				let toolResult: string;
				try {
					toolResult = await executeTool(ctx, fnName, fnArgs, properties);
				} catch (e) {
					toolResult = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
				}

				apiMessages.push({
					role: 'tool',
					content: toolResult,
					tool_call_id: toolCall.id
				});
			}

			response = await callAI(apiBase, apiKey, selectedModel, apiMessages, TOOLS);
		}

		const assistantMessage =
			response.content || "I'm sorry, I couldn't process that. Please try again.";

		await ctx.runMutation(api.chat.addMessage, {
			sessionId: args.sessionId,
			role: 'assistant',
			content: assistantMessage
		});

		return { response: assistantMessage, model: selectedModel };
	}
});
