import { action, type ActionCtx } from './_generated/server';
import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { callAI, classifyComplexity } from './lib/chatLlm';
import type { ChatMessage } from './lib/chatLlm';
import { TOOLS, executeTool } from './lib/chatTools';
import { getFallbackResponse } from './lib/chatFallback';

const chatActionValidator = v.union(v.literal('booking'), v.literal('tour'), v.literal('none'));
const chatChannelValidator = v.union(
	v.literal('web'),
	v.literal('line'),
	v.literal('facebook'),
	v.literal('whatsapp'),
	v.literal('instagram')
);

type GenerateConciergeReplyArgs = {
	sessionId: Id<'chatSessions'>;
	userMessage: string;
	propertySlug?: string;
	locale?: string;
	channel?: 'web' | 'line' | 'facebook' | 'whatsapp' | 'instagram';
	siteUrl?: string;
	questionBankHint?: {
		question: string;
		topic: string;
		dynamicIntent?: 'availability' | 'pricing' | 'property_details' | 'booking_help' | 'contact';
		source?: 'exact' | 'semantic';
	};
};

type QuestionBankMatch = {
	source: 'exact' | 'semantic';
	suggestionId: Id<'curatedChatQuestions'>;
	question: string;
	answer?: string;
	answerMode: 'static' | 'dynamic';
	dynamicIntent?: 'availability' | 'pricing' | 'property_details' | 'booking_help' | 'contact';
	topic: string;
	score: number;
	propertySlug?: string;
	confidence?: number;
};

type ApprovedKnowledgeMatch = {
	source: 'approved_exact';
	answerId: Id<'chatAnswers'>;
	questionId: Id<'chatQuestions'>;
	title: string;
	answer: string;
	questionText: string;
	normalizedQuestion: string;
	propertyId?: Id<'properties'>;
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

type RealityGuardrailLocale =
	| 'en'
	| 'th'
	| 'zh-CN'
	| 'ja'
	| 'ko'
	| 'fr'
	| 'de'
	| 'es'
	| 'ru'
	| 'it'
	| 'hi';

const realityGuardrailPatterns: Array<{
	locale: RealityGuardrailLocale;
	patterns: RegExp[];
}> = [
	{
		locale: 'th',
		patterns: [/(จริงไหม|มีอยู่จริง|ที่พักจริง|รีสอร์ตจริง|หลอกลวง|ปลอม)/u]
	},
	{
		locale: 'zh-CN',
		patterns: [/(真的|真实吗|是真的吗|真实存在|存在吗|骗局|诈骗|虚假|假的|假的吗)/u]
	},
	{
		locale: 'ja',
		patterns: [/(本当|実在|存在しますか|ありますか|詐欺|偽物|本物|本当にある)/u]
	},
	{
		locale: 'ko',
		patterns: [/(진짜|실제|실존|존재|있나요|사기|가짜|정말 있는)/u]
	},
	{
		locale: 'hi',
		patterns: [/(असली|वास्तविक|सच में|मौजूद|धोखा|घोटाला|नकली|फर्जी)/u]
	},
	{
		locale: 'ru',
		patterns: [/(настоящ|реальн|существу|мошенничеств|скам|фейк|подделк|легитим)/u]
	},
	{
		locale: 'fr',
		patterns: [/\b(réel|réelle|vrai|vraie|existe|arnaque|faux|fausse|authentique|légitime)\b/u]
	},
	{
		locale: 'es',
		patterns: [
			/\b(existe|estafa|falso|falsa|auténtico|auténtica|legítimo|legítima|verdadero|verdadera)\b/u,
			/\b(es|esto|lugar|sitio)\b.*\breal\b/u,
			/\breal\b.*\b(es|esto|lugar|sitio)\b/u
		]
	},
	{
		locale: 'it',
		patterns: [
			/\b(esiste|truffa|falso|falsa|autentico|autentica|legittimo|legittima|vero|vera)\b/u,
			/(?:^|\s)(è|e|questo|questa|posto|sito)(?:\s|$).*\breale?\b/u,
			/\breale?\b.*(?:^|\s)(è|e|questo|questa|posto|sito)(?:\s|$)/u
		]
	},
	{
		locale: 'de',
		patterns: [
			/\b(echt\w*|wirklich|existiert|betrug|legitim)\b/u,
			/\b(ist|das|seite)\b.*\breal\b/u,
			/\breal\b.*\b(ist|das|seite)\b/u
		]
	},
	{
		locale: 'en',
		patterns: [
			/\b(is|this|it|place|resort|villa|property|business|site)\b.*\b(real|legit|genuine|exist|exists|scam|fake|authentic|verified)\b/u,
			/\b(real|legit|genuine|authentic|verified)\b.*\b(place|resort|villa|property|business|site)\b/u,
			/\b(scam|fake|legit|genuine|authentic|verified)\b/u
		]
	}
];

const realityDisclosureByLocale: Record<RealityGuardrailLocale, (linkText: string) => string> = {
	en: (linkText) =>
		`Auralis Cove Retreat is presented here as a demo/preview experience for booking and 360° villa tours, so I should not claim it is a real-world verified resort from this chat. I can still help you explore the demo villas, pricing, availability, and tour links${linkText}.`,
	th: (linkText) =>
		`Auralis Cove Retreat ในเว็บไซต์นี้เป็นประสบการณ์เดโม/พรีวิวสำหรับการจองและทัวร์ 360° จึงไม่ควรยืนยันว่าเป็นรีสอร์ตจริงจากแชทนี้ได้ครับ ผมช่วยดูข้อมูลเดโมวิลล่า ราคา ห้องว่าง และลิงก์ทัวร์ให้ได้${linkText}`,
	'zh-CN': (linkText) =>
		`Auralis Cove Retreat 在这里是一个用于预订和 360° 别墅导览的演示/预览体验，所以我不能在聊天中声称它是经过现实世界独立验证的度假村。我仍然可以帮您了解演示别墅、价格、可订情况和 360° 导览链接${linkText}。`,
	ja: (linkText) =>
		`Auralis Cove Retreat は、このサイトでは予約と360°ヴィラツアー用のデモ/プレビュー体験として表示されています。そのため、このチャットで実在確認済みのリゾートだとは断言できません。デモヴィラ、料金、空室状況、360°ツアーリンクの案内はできます${linkText}。`,
	ko: (linkText) =>
		`Auralis Cove Retreat는 이 사이트에서 예약과 360° 빌라 투어를 위한 데모/미리보기 경험으로 제공됩니다. 따라서 이 채팅에서 실제로 독립 검증된 리조트라고 말할 수는 없습니다. 대신 데모 빌라, 가격, 예약 가능 여부, 360° 투어 링크는 도와드릴 수 있습니다${linkText}.`,
	fr: (linkText) =>
		`Auralis Cove Retreat est présenté ici comme une expérience de démonstration/aperçu pour la réservation et les visites de villas à 360°. Je ne dois donc pas affirmer dans ce chat qu'il s'agit d'un resort vérifié dans le monde réel. Je peux toutefois vous aider avec les villas de démonstration, les prix, les disponibilités et les liens de visite 360°${linkText}.`,
	de: (linkText) =>
		`Auralis Cove Retreat wird hier als Demo-/Vorschau-Erlebnis für Buchungen und 360°-Villentouren präsentiert. Deshalb sollte ich in diesem Chat nicht behaupten, dass es ein real verifiziertes Resort ist. Ich kann Ihnen aber mit den Demo-Villen, Preisen, Verfügbarkeit und 360°-Tour-Links helfen${linkText}.`,
	es: (linkText) =>
		`Auralis Cove Retreat se presenta aquí como una experiencia demo/vista previa para reservas y tours de villas en 360°. Por eso no debo afirmar en este chat que sea un resort verificado en el mundo real. Sí puedo ayudarle con las villas demo, precios, disponibilidad y enlaces al tour 360°${linkText}.`,
	ru: (linkText) =>
		`Auralis Cove Retreat здесь представлен как демо/предпросмотр для бронирования и 360°-туров по виллам. Поэтому в этом чате я не должен утверждать, что это независимо проверенный реальный курорт. Я могу помочь с демо-виллами, ценами, доступностью и ссылками на 360°-тур${linkText}.`,
	it: (linkText) =>
		`Auralis Cove Retreat qui è presentato come esperienza demo/anteprima per prenotazioni e tour delle ville a 360°. Per questo non devo affermare in chat che sia un resort verificato nel mondo reale. Posso comunque aiutarti con le ville demo, i prezzi, la disponibilità e i link ai tour 360°${linkText}.`,
	hi: (linkText) =>
		`Auralis Cove Retreat यहां booking और 360° villa tours के लिए demo/preview experience के रूप में दिखाया गया है, इसलिए मैं इस chat में यह दावा नहीं कर सकता कि यह real-world verified resort है। मैं फिर भी demo villas, pricing, availability और 360° tour links में मदद कर सकता हूं${linkText}.`
};

function detectRealityGuardrailLocale(message: string): RealityGuardrailLocale | null {
	const normalized = message.normalize('NFKC').trim().toLocaleLowerCase();
	if (!normalized) return null;

	for (const candidate of realityGuardrailPatterns) {
		if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
			return candidate.locale;
		}
	}

	return null;
}

export function getResortRealityDisclosure(message: string, siteUrl?: string) {
	const locale = detectRealityGuardrailLocale(message);
	if (!locale) return null;

	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	const linkText = normalizedSiteUrl ? ` ${normalizedSiteUrl}` : '';

	return realityDisclosureByLocale[locale](linkText);
}

export function getUnknownFallbackResponse(message: string) {
	if (isThaiText(message)) {
		return 'ผมยังไม่มั่นใจคำตอบนี้ครับ เดี๋ยวผมถามทีมงานให้แล้วจะติดต่อกลับไปโดยเร็ว';
	}

	return "I'm not fully sure about that yet. I'll ask the team and get back to you shortly.";
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

function facebookChannelGuidance(siteUrl?: string) {
	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	return `
FACEBOOK MESSENGER CHANNEL:
- The guest is messaging through Facebook Messenger, not the website chat widget.
- Reply as a short plain-text Messenger message.
- Do not mention a booking card, buttons below the chat, or UI that only exists on the website.
- If the guest is ready to book or asks about availability, direct them to ${normalizedSiteUrl ? `${normalizedSiteUrl}/booking` : 'the booking page'}.
- For virtual tours, direct them to ${normalizedSiteUrl ? `${normalizedSiteUrl}/#villas` : 'the villa pages'}.
- Keep Messenger responses under 120 words unless the guest explicitly asks for detail.`;
}

function instagramChannelGuidance(siteUrl?: string) {
	const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
	return `
INSTAGRAM DM CHANNEL:
- The guest is messaging through Instagram DMs, not the website chat widget.
- Reply as a short plain-text Instagram message.
- Do not mention a booking card, buttons below the chat, or UI that only exists on the website.
- If the guest is ready to book or asks about availability, direct them to ${normalizedSiteUrl ? `${normalizedSiteUrl}/booking` : 'the booking page'}.
- For virtual tours, direct them to ${normalizedSiteUrl ? `${normalizedSiteUrl}/#villas` : 'the villa pages'}.
- Keep Instagram DM responses under 120 words unless the guest explicitly asks for detail.`;
}

function questionBankHintPrompt(hint?: GenerateConciergeReplyArgs['questionBankHint']) {
	if (!hint) return '';
	return `
QUESTION BANK INTENT:
- The latest visitor message matched this curated question-bank item: "${hint.question}".
- Source: ${hint.source ?? 'unknown'}.
- Topic: ${hint.topic}.
${hint.dynamicIntent ? `- Dynamic intent: ${hint.dynamicIntent}.` : ''}
- Use this as intent guidance only; answer with live property/pricing/availability context when relevant.`;
}

function questionBankHintFromMatch(match: QuestionBankMatch): NonNullable<GenerateConciergeReplyArgs['questionBankHint']> {
	return {
		question: match.question,
		topic: match.topic,
		...(match.dynamicIntent ? { dynamicIntent: match.dynamicIntent } : {}),
		source: match.source
	};
}

async function resolveQuestionBankMatch(
	ctx: ActionCtx,
	args: Pick<GenerateConciergeReplyArgs, 'sessionId' | 'userMessage' | 'locale'>
) {
	const messageText = args.userMessage.trim();
	if (!messageText) return null;

	const exactMatch: QuestionBankMatch | null = await ctx.runQuery(
		api.chatSuggestions.resolveCuratedExact,
		{
			sessionId: args.sessionId,
			messageText,
			...(args.locale ? { locale: args.locale } : {})
		}
	);
	if (exactMatch) return exactMatch;

	return await ctx.runAction(api.chatSuggestions.resolveCuratedSemantic, {
		sessionId: args.sessionId,
		messageText,
		...(args.locale ? { locale: args.locale } : {})
	});
}

async function resolveApprovedKnowledgeExact(
	ctx: ActionCtx,
	args: Pick<GenerateConciergeReplyArgs, 'sessionId' | 'userMessage'>
) {
	const messageText = args.userMessage.trim();
	if (!messageText) return null;

	return await ctx.runQuery(api.chatKnowledge.resolveExact, {
		sessionId: args.sessionId,
		messageText
	}) as ApprovedKnowledgeMatch | null;
}

async function markQuestionBankMatchClicked(
	ctx: ActionCtx,
	sessionId: Id<'chatSessions'>,
	match: QuestionBankMatch | null
) {
	if (!match) return;
	await ctx
		.runMutation(api.chatSuggestions.markClicked, {
			sessionId,
			suggestion: {
				source: 'curated',
				suggestionId: match.suggestionId
			}
		})
		.catch(() => null);
}

async function recordUnknownFallback(
	ctx: ActionCtx,
	args: Pick<GenerateConciergeReplyArgs, 'sessionId' | 'userMessage' | 'propertySlug'>,
	session: Doc<'chatSessions'>
) {
	await ctx.runMutation(api.chatKnowledge.recordUnknownQuestion, {
		sessionId: args.sessionId,
		userQuestion: args.userMessage,
		propertySlug: args.propertySlug ?? session.propertySlug,
		pageUrl: session.currentPath
	});

	return {
		response: getUnknownFallbackResponse(args.userMessage),
		model: 'unknown_fallback'
	};
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
- Keep responses under 150 words unless detailed info is requested${channel === 'line' ? lineChannelGuidance(args.siteUrl) : ''}${channel === 'facebook' ? facebookChannelGuidance(args.siteUrl) : ''}${channel === 'instagram' ? instagramChannelGuidance(args.siteUrl) : ''}${questionBankHintPrompt(args.questionBankHint)}`;

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

		const guardrailReply = getResortRealityDisclosure(args.userMessage);
		let approvedKnowledgeMatch: ApprovedKnowledgeMatch | null = null;
		let questionBankMatch: QuestionBankMatch | null = null;
		let result: { response: string; model: string };

		if (guardrailReply) {
			result = { response: guardrailReply, model: 'guardrail' };
		} else {
			approvedKnowledgeMatch = await resolveApprovedKnowledgeExact(ctx, args);
			if (approvedKnowledgeMatch) {
				result = {
					response: approvedKnowledgeMatch.answer.trim(),
					model: 'approved_exact'
				};
			} else {
				questionBankMatch = await resolveQuestionBankMatch(ctx, args);
				if (
					questionBankMatch?.answerMode === 'static' &&
					questionBankMatch.answer?.trim()
				) {
					result = {
						response: questionBankMatch.answer.trim(),
						model: questionBankMatch.source === 'exact'
							? 'question_bank_exact'
							: 'question_bank_semantic'
					};
				} else if (questionBankMatch) {
					result = await generateConciergeReply(ctx, {
						...args,
						questionBankHint: questionBankHintFromMatch(questionBankMatch)
					}, session);
				} else {
					result = await recordUnknownFallback(ctx, args, session);
				}
			}
		}

		await ctx.runMutation(internal.chat.addAssistantMessageWithSuggestions, {
			sessionId: args.sessionId,
			content: result.response,
			...(args.actionHint ? { action: args.actionHint } : {}),
			locale: args.locale,
			propertySlug: args.propertySlug,
			replyToMessageId: userMessageId,
			...(result.model === 'unknown_fallback' ? { skipSuggestions: true } : {})
		});

		await markQuestionBankMatchClicked(ctx, args.sessionId, questionBankMatch);

		return result;
	}
});
