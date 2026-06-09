import { action, type ActionCtx } from './_generated/server';
import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { callAI, classifyComplexity } from './lib/chatLlm';
import type { ChatMessage } from './lib/chatLlm';
import { TOOLS, executeTool } from './lib/chatTools';
import { getFallbackResponse } from './lib/chatFallback';

const chatActionValidator = v.union(v.literal('booking'), v.literal('tour'), v.literal('none'));
const chatChannelValidator = v.union(v.literal('web'), v.literal('line'));

type GenerateConciergeReplyArgs = {
	sessionId: Id<'chatSessions'>;
	userMessage: string;
	propertySlug?: string;
	locale?: string;
	channel?: 'web' | 'line';
	siteUrl?: string;
	questionBankHint?: {
		question: string;
		topic: string;
		dynamicIntent?: 'availability' | 'pricing' | 'property_details' | 'booking_help' | 'contact';
		source?: 'exact' | 'semantic';
	};
};

function normalizeSiteUrl(siteUrl?: string) {
	const trimmed = siteUrl?.trim().replace(/\/+$/, '');
	if (!trimmed) return undefined;

	try {
		return new URL(trimmed).origin;
	} catch {
		return trimmed;
	}
}

function isThaiText(text: string) {
	return /[\u0E00-\u0E7F]/u.test(text);
}

export function getResortRealityDisclosure(message: string, siteUrl?: string) {
	const normalized = message.trim().toLocaleLowerCase();
	const asksRealWorldStatus =
		/\b(real|legit|genuine|actual|exist|exists|scam|fake)\b/i.test(normalized) ||
		/(จริงไหม|มีอยู่จริง|ที่พักจริง|รีสอร์ตจริง|หลอกลวง|ปลอม)/u.test(message);

	if (!asksRealWorldStatus) return null;

	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	const linkText = normalizedSiteUrl ? ` ${normalizedSiteUrl}` : '';

	if (isThaiText(message)) {
		return `Auralis Cove Retreat ในเว็บไซต์นี้เป็นประสบการณ์เดโม/พรีวิวสำหรับการจองและทัวร์ 360° จึงไม่ควรยืนยันว่าเป็นรีสอร์ตจริงจากแชทนี้ได้ครับ ผมช่วยดูข้อมูลเดโมวิลล่า ราคา ห้องว่าง และลิงก์ทัวร์ให้ได้${linkText}`;
	}

	return `Auralis Cove Retreat is presented here as a demo/preview experience for booking and 360° villa tours, so I should not claim it is a real-world verified resort from this chat. I can still help you explore the demo villas, pricing, availability, and tour links${linkText}.`;
}

function lineChannelGuidance(siteUrl?: string) {
	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	return `
LINE CHANNEL:
- The guest is messaging through LINE, not the website chat widget.
- Reply as a short plain-text LINE message.
- Do not mention a booking card, buttons below the chat, or UI that only exists on the website.
- If the guest is ready to book or asks about availability, direct them to ${normalizedSiteUrl ? `${normalizedSiteUrl}/booking` : 'the booking page'}.
- For virtual tours, direct them to ${normalizedSiteUrl ? `${normalizedSiteUrl}/#villas` : 'the villa pages'}.
- Keep LINE responses under 120 words unless the guest explicitly asks for detail.`;
}

function questionBankHintPrompt(hint?: GenerateConciergeReplyArgs['questionBankHint']) {
	if (!hint) return '';
	return `
QUESTION BANK INTENT:
- The latest LINE message matched this curated question-bank item: "${hint.question}".
- Source: ${hint.source ?? 'unknown'}.
- Topic: ${hint.topic}.
${hint.dynamicIntent ? `- Dynamic intent: ${hint.dynamicIntent}.` : ''}
- Use this as intent guidance only; answer with live property/pricing/availability context when relevant.`;
}

async function generateConciergeReply(
	ctx: ActionCtx,
	args: GenerateConciergeReplyArgs,
	session: Doc<'chatSessions'>
): Promise<{ response: string; model: string }> {
	const properties: Doc<'properties'>[] = await ctx.runQuery(api.properties.list, {});

	const propertyContext = properties
		.map(
			(p) =>
				`- ${p.name} (slug: ${p.slug}): ${p.tagline}. ฿${p.pricePerNight}/night, ${p.maxGuests} guests max, ${p.bedrooms} bed, ${p.bathrooms} bath, ${p.area}m². Amenities: ${p.amenities.join(', ')}`
		)
		.join('\n');

	const effectivePropertySlug = args.propertySlug ?? session.propertySlug;
	const currentProperty = effectivePropertySlug
		? properties.find((p) => p.slug === effectivePropertySlug) ?? null
		: null;
	const channel = args.channel ?? session.channel;
	const realityDisclosure = getResortRealityDisclosure(args.userMessage, args.siteUrl);
	if (realityDisclosure) {
		return { response: realityDisclosure, model: 'guardrail' };
	}

	const systemPrompt = `You are a helpful, friendly AI concierge for the Auralis Cove Retreat demo/preview experience, a boutique luxury villa booking and 360° tour concept set in Koh Samui, Thailand. You help guests find the perfect demo villa and answer questions about pricing and availability.

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
- Do not claim that Auralis Cove Retreat is a real-world verified resort or independently verified business. If asked whether it is real, say it is presented here as a demo/preview experience and offer to help with the demo villas, pricing, availability, or 360° tour.
- Use ฿ symbol for prices
- Suggest the 360° virtual tour when relevant
- If the guest seems ready to book or asks about availability, point them to the booking card below the chat
- Ask only for these fields when still missing from their message: villa, check-in, and checkout
- Do not ask guests to type villa/date fields that the booking card can collect for them
- If a question is beyond your knowledge, offer to connect them with the host via WhatsApp
- Keep responses under 150 words unless detailed info is requested${channel === 'line' ? lineChannelGuidance(args.siteUrl) : ''}${questionBankHintPrompt(args.questionBankHint)}`;

	const apiMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

	const recentHistory = await ctx.runQuery(internal.chat.getRecentMessages, {
		sessionId: args.sessionId,
		limit: 10
	});
	for (const msg of recentHistory) {
		apiMessages.push({ role: msg.role, content: msg.content });
	}
	const lastHistoryMessage = recentHistory[recentHistory.length - 1];
	if (lastHistoryMessage?.role !== 'user' || lastHistoryMessage.content !== args.userMessage) {
		apiMessages.push({ role: 'user', content: args.userMessage });
	}

	const complexity = classifyComplexity(args.userMessage);

	const apiKey = process.env.AI_API_KEY;
	const apiBase = process.env.AI_API_BASE_URL || 'https://api.x.ai/v1';
	const simpleModel = process.env.AI_SIMPLE_MODEL || 'grok-4.3';
	const complexModel = process.env.AI_COMPLEX_MODEL || 'grok-4.3';

	if (!apiKey) {
		const fallbackResponse = getFallbackResponse(args.userMessage, currentProperty, args.locale);
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

	return {
		response: response.content || "I'm sorry, I couldn't process that. Please try again.",
		model: selectedModel
	};
}

export const generateReply = action({
	args: {
		sessionId: v.id('chatSessions'),
		userMessage: v.string(),
		propertySlug: v.optional(v.string()),
		locale: v.optional(v.string()),
		channel: v.optional(chatChannelValidator),
		siteUrl: v.optional(v.string()),
		questionBankHint: v.optional(
			v.object({
				question: v.string(),
				topic: v.string(),
				dynamicIntent: v.optional(
					v.union(
						v.literal('availability'),
						v.literal('pricing'),
						v.literal('property_details'),
						v.literal('booking_help'),
						v.literal('contact')
					)
				),
				source: v.optional(v.union(v.literal('exact'), v.literal('semantic')))
			})
		)
	},
	handler: async (ctx, args): Promise<{ response: string; model: string }> => {
		const session: Doc<'chatSessions'> | null = await ctx.runQuery(api.chat.getSession, {
			sessionId: args.sessionId
		});
		if (!session) throw new Error('Session not found');

		return await generateConciergeReply(ctx, args, session);
	}
});

export const getGuardrailReply = action({
	args: {
		userMessage: v.string(),
		siteUrl: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		return getResortRealityDisclosure(args.userMessage, args.siteUrl);
	}
});

export const respond = action({
	args: {
		sessionId: v.id('chatSessions'),
		userMessage: v.string(),
		propertySlug: v.optional(v.string()),
		locale: v.optional(v.string()),
		actionHint: v.optional(chatActionValidator)
	},
	handler: async (ctx, args) => {
		const session = await ctx.runQuery(api.chat.getSession, {
			sessionId: args.sessionId
		});
		if (!session) throw new Error('Session not found');

		const userMessageId: Id<'chatMessages'> = await ctx.runMutation(api.chat.addMessage, {
			sessionId: args.sessionId,
			role: 'user',
			content: args.userMessage
		});

		const result = await generateConciergeReply(ctx, args, session);

		await ctx.runMutation(internal.chat.addAssistantMessageWithSuggestions, {
			sessionId: args.sessionId,
			content: result.response,
			...(args.actionHint ? { action: args.actionHint } : {}),
			locale: args.locale,
			propertySlug: args.propertySlug,
			replyToMessageId: userMessageId
		});

		return result;
	}
});
