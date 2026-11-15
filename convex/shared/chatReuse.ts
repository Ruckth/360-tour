export const DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT = 20;

export function isReusableChatMessageCount(
	messageCount: number,
	messageLimit = DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT
) {
	return messageCount < messageLimit;
}
