// HTML emails use Resend's fetch API and can run in the default Convex runtime.
import { v } from 'convex/values';
import { Resend } from 'resend';
import { internalAction } from '../auth/model';
import { escapeHtml, fromHeader, loadSettings, ownerNotificationEmail } from '../settings/model';

export const sendStaffAlert = internalAction({
	args: {
		sessionId: v.id('conversations'),
		channel: v.string(),
		guestName: v.string(),
		lastMessage: v.string()
	},
	handler: async (ctx, args) => {
		const settings = await loadSettings(ctx);
		const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
		const link = siteUrl ? `${siteUrl}/admin/chats?session=${encodeURIComponent(args.sessionId)}` : undefined;
		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.EMAIL_FROM;
		const owner = ownerNotificationEmail(settings);
		if (!link) console.warn('SITE_URL not configured, staff alert will not include an admin link');
		if (!apiKey || !from || !owner) {
			console.warn('RESEND_API_KEY, EMAIL_FROM, or OWNER_NOTIFICATION_EMAIL not configured, skipping staff alert email');
		} else {
			try {
				const { error } = await new Resend(apiKey).emails.send({
					from: fromHeader(from, settings), to: owner,
					subject: `Guest needs help on ${args.channel}`,
					html: `<p><strong>Channel:</strong> ${escapeHtml(args.channel)}</p><p><strong>Guest:</strong> ${escapeHtml(args.guestName)}</p><p><strong>Last message:</strong></p><p style="white-space: pre-wrap;">${escapeHtml(args.lastMessage)}</p>${link ? `<p><a href="${escapeHtml(link)}">Open this chat in admin</a></p>` : ''}`
				});
				if (error) console.error('Failed to send staff alert email:', error);
			} catch (error) {
				console.error('Failed to send staff alert email:', error);
			}
		}
		const lineUserId = process.env.STAFF_LINE_USER_ID;
		const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
		if (lineUserId && lineToken) {
			try {
				const response = await fetch('https://api.line.me/v2/bot/message/push', {
					method: 'POST',
					headers: { authorization: `Bearer ${lineToken}`, 'content-type': 'application/json' },
					body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: `Guest needs help (${args.channel})\n${args.guestName}: ${args.lastMessage}${link ? `\n${link}` : ''}`.slice(0, 5000) }] }),
					signal: AbortSignal.timeout(15000)
				});
				if (!response.ok) console.error('Failed to send staff LINE alert:', response.status);
			} catch (error) {
				console.error('Failed to send staff LINE alert:', error);
			}
		} else if (lineUserId) {
			console.warn('LINE_CHANNEL_ACCESS_TOKEN not configured, skipping staff LINE alert');
		}
	}
});
