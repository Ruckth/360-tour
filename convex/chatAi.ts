import { mentionsCoupon, unverifiedCouponReply } from './lib/chatCouponCopy';
import { isCardTool, replyCardFromTool, type ReplyCard } from './lib/replyCards';
import { detectReplyLocale } from "./lib/unknownReply";
import { proposalIdentity } from './lib/chatWriteGuard';
import { internalMutation, type ActionCtx } from './auth/model';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { EffectiveSettings } from './lib/siteSettings';
import { callAI, classifyComplexity, DEFAULT_AI_API_BASE_URL, DEFAULT_AI_MODEL } from './lib/chatLlm';
import type { LlmCallTrace } from './lib/chatLlm';
import { BOOKING_TOOLS, TOOLS, executeTool } from './lib/chatTools';
import { consumeChatAdmission } from './lib/chatAdmission';
import type { ReplyOutcome } from './lib/inboxLifecycle';
import { conciergeReplyOutcome } from './lib/conciergeReplyOutcome';
import { capabilityReply, checkTimeReply, isCheckTimeQuestion, isCancellationPolicyQuestion, cancellationPolicyReply, replyLocale } from './lib/conciergePolicy';
import { runConciergeTurn } from './lib/conciergeTurn';
import { startTurnMetrics, recordStage, addPromptChars, recordModelRequest, recordTool, emitConciergeTurnLog, createTurnId, type TurnMetrics } from './lib/turnMetrics';
import { getResortRealityDisclosure, getUnknownFallbackResponse } from './concierge/copy';
import { buildPrompt } from './concierge/prompt';
import { loadTurnContext } from './concierge/context';
import type { DurableTool } from './messaging/model';

export const consumeChatLimit = internalMutation({
	args: { sessionId: v.id('conversations') },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');
		await consumeChatAdmission(ctx, args.sessionId);
	}
});

export type GenerateConciergeReplyArgs = {
	sessionId: Id<'conversations'>;
	userMessage: string;
	replyToMessageId?: Id<'messages'>;
	propertySlug?: string;
	locale?: string;
	channel?: 'web' | 'line' | 'facebook' | 'whatsapp' | 'instagram';
	siteUrl?: string;
	bookingFlow?: boolean;
	/** Correlation id for turn metrics; generated here when absent. */
	turnId?: string;
	/** Collects each tool call of this turn (used by the booking eval). */
	toolTrace?: Array<{ name: string; args: Record<string, unknown>; result: string }>;
	/** Internal eval only; deliberately absent from the public action validator. */
	evalModel?: 'openai/gpt-6-luna' | 'z-ai/glm-5.3-flash';
	llmTrace?: LlmCallTrace[];
 durableTurn?: Pick<DurableTool, 'eventId' | 'claimToken'>;
};

export { getResortRealityDisclosure, getUnknownFallbackResponse } from './concierge/copy';
export { resortTodayLine } from './concierge/prompt';
async function recordUnknownFallback(
  ctx: ActionCtx,
  args: Pick<
    GenerateConciergeReplyArgs,
    "sessionId" | "userMessage" | "propertySlug" | "locale" | "replyToMessageId" | "durableTurn"
  >,
  session: Doc<"conversations">,
) {
  await ctx.runMutation(internal.chatKnowledge.recordUnknownQuestion, {
    sessionId: args.sessionId,
    ...(args.durableTurn ? { durableTurn: args.durableTurn } : {}),
    userQuestion: args.userMessage,
    replyToMessageId: args.replyToMessageId,
    propertySlug: args.propertySlug ?? session.propertySlug,
    pageUrl: session.currentPath,
  });

  return {
    response: getUnknownFallbackResponse(args.userMessage, args.locale),
    model: "unknown_fallback",
  };
}

async function policyReply(
  ctx: Pick<ActionCtx, 'runQuery'>,
  userMessage: string,
  siteUrl?: string,
  locale?: string,
): Promise<string | null> {
  const reply =
    getResortRealityDisclosure(userMessage, siteUrl) ??
    capabilityReply(userMessage);
  if (reply) return reply;
  if (
    !isCheckTimeQuestion(userMessage) &&
    !isCancellationPolicyQuestion(userMessage)
  )
    return null;
  const settings: EffectiveSettings = await ctx.runQuery(
    internal.settings.effective,
    {},
  );
  const guestLocale = locale ?? replyLocale(userMessage);
  // A saved policy is authoritative text; let the concierge translate it when needed.
  if (
    isCancellationPolicyQuestion(userMessage) &&
    guestLocale !== (detectReplyLocale(settings.cancellationPolicy) ?? "en")
  )
    return null;
  const policy =
    checkTimeReply(userMessage, settings, guestLocale) ??
    cancellationPolicyReply(userMessage, settings);
  const defaultFields =
    settings.demoDefaultFields ??
    (settings.updatedAt === null
      ? ["checkInTime", "checkOutTime", "timezone", "cancellationPolicy"]
      : []);
  const usesDefault = isCheckTimeQuestion(userMessage)
    ? defaultFields.some((field) =>
        ["checkInTime", "checkOutTime", "timezone"].includes(field),
      )
    : defaultFields.includes("cancellationPolicy");
  if (!usesDefault || !policy) return policy;
  const label =
    guestLocale === "th"
      ? "ค่าเริ่มต้นสำหรับเดโม ยังไม่ใช่นโยบายที่เจ้าของยืนยัน: "
      : guestLocale === "ko"
        ? "데모 기본값이며 호스트가 확인한 정책은 아닙니다: "
        : "Demo default, not a host-confirmed policy: ";
  return label + policy;
}

/** committed is present when a booking/service/cancellation write succeeded in this turn. */
export type ConciergeReply = { response: string; model: string; outcome?: ReplyOutcome; card?: ReplyCard; committed?: { tool: string } };

export function withReplyOutcome(reply: ConciergeReply): ConciergeReply {
  return { ...reply, ...conciergeReplyOutcome(reply.response, reply.model), ...(reply.outcome ? { outcome: reply.outcome } : {}) };
}

export async function generateConciergeReply(
	ctx: ActionCtx,
	args: GenerateConciergeReplyArgs,
	session: Doc<'conversations'>
): Promise<ConciergeReply> {
	const turnId = args.turnId ?? createTurnId();
	const metrics: TurnMetrics = startTurnMetrics(turnId, args.channel ?? session.channel);
	const turnStartedAt = Date.now();
	const emit = (outcome: string, model?: string) => {
		recordStage(metrics, 'total', Date.now() - turnStartedAt);
		emitConciergeTurnLog({ metrics, outcome, model });
	};

	const guardrailStartedAt = Date.now();
	const guardrail = await policyReply(ctx, args.userMessage, args.siteUrl, args.locale);
	recordStage(metrics, 'guardrail', Date.now() - guardrailStartedAt);
	if (guardrail) {
		emit('guardrail', 'guardrail');
		return { response: guardrail, model: 'guardrail' };
	}
	const deadlineAt = turnStartedAt + 20_000;
	// Independent reads, fetched together; no writes happen between them.
	const contextStartedAt = Date.now();
	const { properties, settings, recentHistory } = await loadTurnContext(ctx, args);
	recordStage(metrics, 'context', Date.now() - contextStartedAt);
	const channel = args.channel ?? session.channel;
	const isMessaging = channel !== 'web';
 const tools = isMessaging ? [...TOOLS, ...BOOKING_TOOLS] : TOOLS;
	if (isMessaging && args.bookingFlow) {
		await ctx.runMutation(internal.bookings.touchChatBookingFlow, { sessionId: args.sessionId, ...(args.durableTurn ? { durableTurn: args.durableTurn } : {}) });
	}
	const realityDisclosure = getResortRealityDisclosure(args.userMessage, args.siteUrl);
	if (realityDisclosure) {
		emit('guardrail', 'guardrail');
		return { response: realityDisclosure, model: 'guardrail' };
	}

	const apiMessages = buildPrompt(args, session, properties, settings, recentHistory, turnStartedAt);
	const systemPrompt = String(apiMessages[0].content);

	// A size only — never the prompt text; keeps the turn log leak-free.
	addPromptChars(metrics, apiMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0));

	const complexity = classifyComplexity(args.userMessage);

	const apiKey = process.env.AI_API_KEY;
	const apiBase = process.env.AI_API_BASE_URL || DEFAULT_AI_API_BASE_URL;
	const simpleModel = process.env.AI_SIMPLE_MODEL?.trim() || DEFAULT_AI_MODEL;
	const complexModel = process.env.AI_COMPLEX_MODEL?.trim() || simpleModel;

	if (!apiKey) {
		if (mentionsCoupon(args.userMessage)) {
			emit('fallback', 'fallback');
			return { response: unverifiedCouponReply(args.locale ?? replyLocale(args.userMessage)), model: 'fallback', outcome: 'awaiting_guest' };
		}
		emit('unknown_fallback', 'unknown_fallback');
		return await recordUnknownFallback(ctx, args, session);
	}

	const selectedModel = args.evalModel ?? (complexity === 'simple' ? simpleModel : complexModel);
	let answerPropertySlug = args.propertySlug ?? session.propertySlug;
 const calls: LlmCallTrace[] = [];
 const toolsUsed: string[] = [];
 let card: ReplyCard | undefined;
 const factRevisions: Array<{ factId: string; revision: number }> = [];
 const response = await runConciergeTurn({
		message: args.userMessage,
		messages: apiMessages,
		tools,
		deadlineAt,
		request: (messages, requestTools, timeoutMs) => callAI(apiBase, apiKey, selectedModel, messages, requestTools, trace => { calls.push(trace); args.llmTrace?.push(trace); }, { timeoutMs }),
		invalidateProposal: async name => { await ctx.runMutation(internal.bookings.invalidateChatProposal, { sessionId: args.sessionId, kind: name === 'prepare_booking' ? 'villa' : 'service', deadlineAt, ...(args.durableTurn ? { durableTurn: args.durableTurn } : {}) }); },
		execute: (name, toolArgs) => executeTool(ctx, name, toolArgs, properties, { sessionId: args.sessionId, siteUrl: args.siteUrl, turnStartedAt, deadlineAt, durableTurn: args.durableTurn, bookingProposal: proposalIdentity(session.pendingBookingQuote), serviceProposal: proposalIdentity(session.pendingServiceQuote) }),
		metrics: {
			recordModelRequest: ms => recordModelRequest(metrics, ms),
			recordTool: (name, ms, ok) => recordTool(metrics, name, ms, ok)
		},
		onTool: async trace => {
			args.toolTrace?.push(trace);
            if (isCardTool(trace.name)) card = replyCardFromTool(trace, { siteUrl: args.siteUrl, locale: args.locale });
 toolsUsed.push(trace.name);
 if (trace.name === 'search_business_facts') {
  const evidence = JSON.parse(trace.result) as { error?: string; facts?: Array<{factId:string; revision:number}> };
  if (!evidence.error && typeof trace.args.propertySlug === 'string') answerPropertySlug = trace.args.propertySlug;
  factRevisions.push(...(evidence.facts ?? []).map(({factId,revision})=>({factId,revision})));
 }
			if (trace.result.includes('Offer to connect the guest with the host.')) {
				await ctx.runMutation(internal.chatKnowledge.alertStaffForHandoff, { sessionId: args.sessionId, ...(args.durableTurn ? { durableTurn: args.durableTurn } : {}), lastMessage: args.userMessage, replyToMessageId: args.replyToMessageId })
					.catch(error => console.error('Could not queue staff handoff alert:', error));
			}
		}
	});
  console.info(
    JSON.stringify({
      event: "concierge_context",
      promptVersion: 2,
      channel,
      model: selectedModel,
      promptChars: systemPrompt.length,
      latencyMs: Date.now() - turnStartedAt,
      tools: toolsUsed,
      facts: factRevisions,
      status: response.failed
        ? "failed"
        : response.content?.includes("[[UNKNOWN]]") || !response.content?.trim()
          ? "missing_context"
          : "answered",
      calls: calls.map((call) => ({
        model: call.model,
        latencyMs: call.latencyMs,
        promptTokens: call.usage?.prompt_tokens,
        completionTokens: call.usage?.completion_tokens,
        cost: call.usage?.cost,
      })),
    }),
  );
	const finalModel = response.failed ? 'tool_fallback' : selectedModel;
    const outcome = response.outcome ?? conciergeReplyOutcome(response.content ?? '', finalModel).outcome;
	if (outcome === 'needs_staff') {
		await ctx.runMutation(internal.chatKnowledge.alertStaffForHandoff, {
			sessionId: args.sessionId,
      ...(args.durableTurn ? { durableTurn: args.durableTurn } : {}),
			lastMessage: args.userMessage,
			replyToMessageId: args.replyToMessageId
		}).catch((error) => console.error('Could not queue staff handoff alert:', error));
	}
	if (!response.content?.trim() || response.content.includes('[[UNKNOWN]]')) {
		emit('unknown_fallback', 'unknown_fallback');
		return await recordUnknownFallback(ctx, {...args, propertySlug: answerPropertySlug}, session);
	}

	emit(response.failed ? 'tool_fallback' : 'ai', finalModel);
	return {
		response: response.content,
		model: finalModel,
        outcome,
        ...(!response.failed && outcome !== 'needs_staff' && card ? { card } : {}),
		// Lets a messaging adapter that already timed out see that a write committed.
		...(response.committedTool ? { committed: { tool: response.committedTool } } : {})
	};
}

export async function getGuardrailReply(ctx: Pick<ActionCtx, 'runQuery'>, args: { userMessage: string; siteUrl?: string; locale?: string }): Promise<string | null> {
	return await policyReply(ctx, args.userMessage, args.siteUrl, args.locale);
}
