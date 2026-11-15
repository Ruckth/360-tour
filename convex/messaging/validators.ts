import { v } from 'convex/values';

export const messagesFields = {
		sessionId: v.id('conversations'),
		role: v.union(v.literal('user'), v.literal('assistant')),
		source: v.optional(v.literal('admin')),
		replyToMessageId: v.optional(v.id('messages')),
		content: v.string(),
		action: v.optional(v.union(v.literal('booking'), v.literal('tour'), v.literal('none'))),
		timestamp: v.number()
	};

export const channelEventsFields = {
		channel: v.union(v.literal('web'), v.literal('line'), v.literal('facebook'), v.literal('instagram'), v.literal('whatsapp')),
		eventKey: v.string(),
    recipient: v.optional(v.string()), accountId: v.optional(v.string()), profileName: v.optional(v.string()),
    admittedAt: v.optional(v.number()), replyToken: v.optional(v.string()), arrivedAt: v.optional(v.number()),
    claimToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), attempts: v.optional(v.number()), nextAttemptAt: v.optional(v.number()),
    dispatchState: v.optional(v.union(v.literal('prepared'), v.literal('sending'), v.literal('sent'), v.literal('rejected'), v.literal('uncertain'))),
    responseText: v.optional(v.string()), responseModel: v.optional(v.string()), responseCardJson: v.optional(v.string()),
    responseOutcome: v.optional(v.union(v.literal('answered'), v.literal('awaiting_guest'), v.literal('needs_staff'))),
    locale: v.optional(v.string()), propertySlug: v.optional(v.string()), actionHint: v.optional(v.union(v.literal('booking'), v.literal('tour'), v.literal('none'))),
    toolResults: v.optional(v.array(v.object({ key: v.string(), name: v.string(), resultJson: v.string(), pending: v.optional(v.boolean()) }))),
		sessionId: v.optional(v.id('conversations')),
		lineUserId: v.optional(v.string()),
  facebookUserId: v.optional(v.string()), pageId: v.optional(v.string()),
  instagramUserId: v.optional(v.string()), instagramAccountId: v.optional(v.string()),
  whatsappUserId: v.optional(v.string()), phoneNumberId: v.optional(v.string()),
  facebookReplyStatus: v.optional(v.number()), instagramReplyStatus: v.optional(v.number()), whatsappReplyStatus: v.optional(v.number()),
		sourceType: v.optional(v.string()),
		eventType: v.union(
			v.literal('message'),
			v.literal('follow'),
			v.literal('postback'),
			v.literal('unsupported')
		),
		messageText: v.optional(v.string()),
		postbackData: v.optional(v.string()),
		status: v.union(
			v.literal('received'),
			v.literal('processing'),
			v.literal('replied'),
			v.literal('ignored'),
			v.literal('failed'),
      v.literal('reconciliation')
		),
		replyMode: v.optional(
			v.union(
				v.literal('ai'),
				v.literal('unknown_fallback'),
				v.literal('postback'),
				v.literal('follow'),
				v.literal('ignored'),
				v.literal('failed')
			)
		),
		lineReplyStatus: v.optional(v.number()),
		userMessageId: v.optional(v.id('messages')),
		assistantMessageId: v.optional(v.id('messages')),
		error: v.optional(v.string()),
		eventTimestamp: v.optional(v.number()),
		processingStartedAt: v.number(),
        /** A provider send may have succeeded; automatic webhook replay is unsafe. */
        deliveryStartedAt: v.optional(v.number()),
		processedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	};

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const chatCreateSessionResult = v.object({
"sessionId": v.id("conversations"),
"guestToken": v.string(),
});

export const chatTouchSessionResult = v.null();

export const chatCloseSessionResult = v.null();

export const chatCreateBrowserHandoffResult = v.string();

export const chatClaimBrowserHandoffResult = v.union(v.null(), v.object({
"sessionId": v.id("conversations"),
"guestToken": v.string(),
}));

export const chatIdentifyVisitorResult = v.null();

export const chatGetSessionResult = v.object({
"_id": v.id("conversations"),
"_creationTime": v.number(),
"propertySlug": v.optional(v.string()),
"channel": v.union(v.literal("web"), v.literal("whatsapp"), v.literal("line"), v.literal("instagram"), v.literal("facebook")),
"messageCount": v.optional(v.number()),
"latestMessageAt": v.optional(v.number()),
"createdAt": v.number(),
"aiPaused": v.boolean(),
});

export const chatIsAiPausedResult = v.boolean();

export const messageDocument = v.object({ ...messagesFields, _id: v.id('messages'), _creationTime: v.number() });
export const channelEventDocument = v.object({ ...channelEventsFields, _id: v.id('channelEvents'), _creationTime: v.number() });
export const chatGetMessagesResult = v.array(messageDocument);

export const chatSuggestionsNextForSessionResult = v.array(v.object({
"source": v.literal("static"),
"suggestionId": v.union(v.literal("guests"), v.literal("cancellation"), v.literal("direct"), v.literal("tour"), v.literal("availability"), v.literal("totalPrice"), v.literal("contact"), v.literal("couple"), v.literal("family"), v.literal("airport"), v.literal("amenitiesIncluded"), v.literal("location")),
}));

export const chatSuggestionsMarkShownResult = v.object({
"updated": v.number(),
});

export const chatSuggestionsMarkClickedResult = v.object({
"clicked": v.boolean(),
});

export const leadsSaveResult = v.id("leads");
