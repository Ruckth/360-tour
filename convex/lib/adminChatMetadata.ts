import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

type SearchableSession = {
	_id?: Id<'chatSessions'>;
	propertySlug?: string;
	channel?: 'web' | 'whatsapp' | 'line' | 'facebook' | 'instagram';
	visitorId?: string;
	visitorName?: string;
	visitorEmail?: string;
	visitorPhone?: string;
	visitorContactApp?: 'whatsapp' | 'line' | 'facebook' | 'instagram';
	visitorContactHandle?: string;
	currentPath?: string;
	referrer?: string;
	userAgent?: string;
	timeZone?: string;
	browserLanguage?: string;
	screenSize?: string;
	viewportSize?: string;
	platform?: string;
};

type SortableSession = {
	createdAt: number;
	lastSeenAt?: number;
	latestMessageAt?: number;
};

export type AdminChatMetadataPatch = {
	messageCount?: number;
	latestMessageAt?: number;
	adminSortAt: number;
	adminSearchText: string;
};

export function normalizeAdminSearchText(value?: string) {
	return (value ?? '')
		.normalize('NFKC')
		.trim()
		.toLocaleLowerCase()
		.replace(/['’`]/g, '')
		.replace(/[^\p{L}\p{N}@._:/?&=+-]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function buildAdminSearchText(session: SearchableSession) {
	return normalizeAdminSearchText(
		[
			session.visitorName,
			session.visitorEmail,
			session.visitorPhone,
			session.visitorContactApp,
			session.visitorContactHandle,
			session.propertySlug,
			session.currentPath,
			session.referrer,
			session.visitorId,
			session.channel,
			session.timeZone,
			session.browserLanguage,
			session.screenSize,
			session.viewportSize,
			session.platform,
			session.userAgent,
		]
			.filter((value): value is string => Boolean(value?.trim()))
			.join(' ')
	).slice(0, 8000);
}

export function getAdminChatSortAt(session: SortableSession) {
	return session.latestMessageAt ?? session.lastSeenAt ?? session.createdAt;
}

export function getAdminChatMessageCount(session: { messageCount?: number }) {
	return Math.max(0, Math.floor(session.messageCount ?? 0));
}

export function buildAdminChatMetadataPatch(
	session: SearchableSession & SortableSession & { messageCount?: number },
	overrides: Partial<SearchableSession & SortableSession & { messageCount?: number }> = {}
): AdminChatMetadataPatch {
	const nextSession = { ...session, ...overrides };
	const messageCount =
		typeof nextSession.messageCount === 'number'
			? Math.max(0, Math.floor(nextSession.messageCount))
			: undefined;

	return {
		...(typeof messageCount === 'number' ? { messageCount } : {}),
		...(typeof nextSession.latestMessageAt === 'number'
			? { latestMessageAt: nextSession.latestMessageAt }
			: {}),
		adminSortAt: getAdminChatSortAt(nextSession),
		adminSearchText: buildAdminSearchText(nextSession),
	};
}

export async function patchSessionAfterMessages(
	ctx: MutationCtx,
	sessionId: Id<'chatSessions'>,
	options: {
		addedMessages: number;
		latestMessageAt: number;
		lastSeenAt?: number;
	}
) {
	const session = await ctx.db.get(sessionId);
	if (!session) throw new Error('Session not found');

	const nextLatestMessageAt = Math.max(
		session.latestMessageAt ?? 0,
		options.latestMessageAt
	);
	const nextMessageCount = getAdminChatMessageCount(session) + options.addedMessages;
	const nextLastSeenAt = options.lastSeenAt ?? session.lastSeenAt;

	await ctx.db.patch(sessionId, {
		...buildAdminChatMetadataPatch(session, {
			messageCount: nextMessageCount,
			latestMessageAt: nextLatestMessageAt,
			lastSeenAt: nextLastSeenAt,
		}),
		...(typeof nextLastSeenAt === 'number' ? { lastSeenAt: nextLastSeenAt } : {}),
	});
}
