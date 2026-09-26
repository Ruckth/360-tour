"use node";
import { internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { Resend } from 'resend';

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function escapedFields<T extends { guestName: string; propertyName: string; checkIn: string; checkOut: string; currency: string }>(args: T) {
	return { ...args, guestName: escapeHtml(args.guestName), propertyName: escapeHtml(args.propertyName), checkIn: escapeHtml(args.checkIn), checkOut: escapeHtml(args.checkOut), currency: escapeHtml(args.currency), ...('guestEmail' in args ? { guestEmail: escapeHtml(String(args.guestEmail)) } : {}), ...('guestPhone' in args ? { guestPhone: escapeHtml(String(args.guestPhone)) } : {}) };
}

export const sendBookingConfirmation = internalAction({
	args: {
		guestName: v.string(),
		guestEmail: v.string(),
		propertyName: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		nights: v.number(),
		guests: v.number(),
		total: v.number(),
		currency: v.string()
	},
	handler: async (_ctx, args) => {
		const apiKey = process.env.RESEND_API_KEY;
		const emailFrom = process.env.EMAIL_FROM;
		if (!apiKey || !emailFrom) {
			console.warn('RESEND_API_KEY or EMAIL_FROM not configured, skipping email');
			return { sent: false, reason: 'no_api_key' };
		}

		const resend = new Resend(apiKey);
		const safe = escapedFields(args);

		const { error } = await resend.emails.send({
			from: emailFrom,
			to: args.guestEmail,
			subject: `Booking Confirmed: ${args.propertyName} (${args.checkIn} - ${args.checkOut})`,
			html: `
				<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
					<h1 style="font-size: 24px; color: #111; margin-bottom: 8px;">Booking Confirmed!</h1>
					<p style="color: #666; font-size: 16px;">Thank you, ${safe.guestName}. Your stay is confirmed.</p>

					<div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin: 24px 0;">
						<h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">${safe.propertyName}</h2>
						<table style="width: 100%; border-collapse: collapse;">
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Check-in</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${safe.checkIn}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Check-out</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${safe.checkOut}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Nights</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${safe.nights}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Guests</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${safe.guests}</td>
							</tr>
							<tr style="border-top: 1px solid #ddd;">
								<td style="padding: 12px 0 0; font-weight: 700; font-size: 16px;">Total</td>
								<td style="padding: 12px 0 0; text-align: right; font-weight: 700; font-size: 16px; color: #0ea5e9;">
					${safe.currency === 'THB' ? '฿' : safe.currency}${safe.total.toLocaleString()}
								</td>
							</tr>
						</table>
					</div>

					<p style="color: #666; font-size: 14px;">
						We'll send you check-in instructions closer to your arrival date.
						If you have any questions, reply to this email or message us on WhatsApp.
					</p>

					<p style="color: #999; font-size: 12px; margin-top: 32px;">
						Spin & Stay — Spin around every room. Then book your stay.
					</p>
				</div>
			`
		});

		if (error) {
			console.error('Failed to send booking confirmation email:', error);
			return { sent: false, reason: error.message };
		}

		return { sent: true };
	}
});

export const sendOwnerNotification = internalAction({
	args: {
		guestName: v.string(),
		guestEmail: v.string(),
		guestPhone: v.string(),
		propertyName: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		nights: v.number(),
		guests: v.number(),
		total: v.number(),
		currency: v.string()
	},
	handler: async (_ctx, args) => {
		const apiKey = process.env.RESEND_API_KEY;
		const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL;
		const emailFrom = process.env.EMAIL_FROM;

		if (!apiKey || !ownerEmail || !emailFrom) {
			console.warn('RESEND_API_KEY, EMAIL_FROM, or OWNER_NOTIFICATION_EMAIL not configured');
			return { sent: false, reason: 'missing_config' };
		}

		const resend = new Resend(apiKey);
		const safe = escapedFields(args);

		const { error } = await resend.emails.send({
			from: emailFrom,
			to: ownerEmail,
			subject: `New Booking: ${args.propertyName} (${args.checkIn} - ${args.checkOut})`,
			html: `
				<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
					<h1 style="font-size: 24px; color: #111;">New Direct Booking!</h1>

					<div style="background: #f0fdf4; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bbf7d0;">
						<h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">${safe.propertyName}</h2>
						<table style="width: 100%; border-collapse: collapse;">
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Guest</td>
								<td style="padding: 6px 0; text-align: right; font-weight: 600; font-size: 14px;">${safe.guestName}</td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Email</td>
								<td style="padding: 6px 0; text-align: right; font-size: 14px;"><a href="mailto:${safe.guestEmail}">${safe.guestEmail}</a></td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Phone/WhatsApp</td>
								<td style="padding: 6px 0; text-align: right; font-size: 14px;">${safe.guestPhone}</td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Dates</td>
								<td style="padding: 6px 0; text-align: right; font-weight: 600; font-size: 14px;">${safe.checkIn} → ${safe.checkOut} (${safe.nights} nights)</td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Guests</td>
								<td style="padding: 6px 0; text-align: right; font-size: 14px;">${safe.guests}</td>
							</tr>
							<tr style="border-top: 1px solid #bbf7d0;">
								<td style="padding: 12px 0 0; font-weight: 700; font-size: 16px;">Revenue</td>
								<td style="padding: 12px 0 0; text-align: right; font-weight: 700; font-size: 16px; color: #16a34a;">
					${safe.currency === 'THB' ? '฿' : safe.currency}${safe.total.toLocaleString()}
								</td>
							</tr>
						</table>
					</div>
				</div>
			`
		});

		if (error) {
			console.error('Failed to send owner notification:', error);
			return { sent: false, reason: error.message };
		}

		return { sent: true };
	}
});

type LifecycleKind = 'cancellation' | 'preArrival' | 'review';

async function retryLifecycleEmail(ctx: ActionCtx, bookingId: Id<'bookings'>, kind: LifecycleKind, attempt: number) {
	if (attempt >= 3) return;
	const delay = 5 * 60 * 1000 * 2 ** attempt;
	const args = { bookingId, attempt: attempt + 1 };
	if (kind === 'cancellation') await ctx.scheduler.runAfter(delay, internal.emails.sendCancellation, args);
	else if (kind === 'preArrival') await ctx.scheduler.runAfter(delay, internal.emails.sendPreArrival, args);
	else await ctx.scheduler.runAfter(delay, internal.emails.sendReviewRequest, args);
}

async function sendLifecycleEmail(ctx: ActionCtx, bookingId: Id<'bookings'>, kind: LifecycleKind, attempt = 0) {
	const details: { guestName: string; guestEmail: string; propertyName: string; checkIn: string; checkOut: string } | null =
		await ctx.runQuery(internal.bookings.getLifecycleEmailDetails, { bookingId, kind });
	if (!details) return { sent: false, reason: 'booking_not_eligible' };
	const apiKey = process.env.RESEND_API_KEY;
	const from = process.env.EMAIL_FROM;
	if (!apiKey || !from) {
		console.warn('RESEND_API_KEY or EMAIL_FROM not configured, skipping lifecycle email');
		return { sent: false, reason: 'missing_config' };
	}
	const name = escapeHtml(details.guestName);
	const property = escapeHtml(details.propertyName);
	const checkIn = escapeHtml(details.checkIn);
	const checkOut = escapeHtml(details.checkOut);
	const content = {
		cancellation: {
			subject: `Booking Cancelled: ${details.propertyName}`,
			html: `<p>Hi ${name},</p><p>Your booking at ${property} for ${checkIn} to ${checkOut} has been cancelled.</p><p>If you have questions about payment or a refund, please reply to this email.</p>`
		},
		preArrival: {
			subject: `Your stay at ${details.propertyName} is coming up`,
			html: `<p>Hi ${name},</p><p>We look forward to welcoming you to ${property} on ${checkIn}. Your check-out is ${checkOut}.</p><p>Reply to this email if you need help before arrival.</p>`
		},
		review: {
			subject: `How was your stay at ${details.propertyName}?`,
			html: `<p>Hi ${name},</p><p>Thank you for staying at ${property}. We hope you enjoyed your visit. Please reply and let us know how it went.</p>`
		}
	}[kind];
	let failureReason = 'send_failed';
	try {
		const { error } = await new Resend(apiKey).emails.send({ from, to: details.guestEmail, ...content });
		if (error) {
			console.error(`Failed to send ${kind} email:`, error);
			failureReason = error.message;
		} else {
			return { sent: true };
		}
	} catch (error) {
		console.error(`Failed to send ${kind} email:`, error);
	}
	await retryLifecycleEmail(ctx, bookingId, kind, attempt);
	return { sent: false, reason: failureReason };
}

export const sendCancellation = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'cancellation', args.attempt)
});

export const sendPreArrival = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'preArrival', args.attempt)
});

export const sendReviewRequest = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'review', args.attempt)
});

export const sendStaffAlert = internalAction({
	args: {
		sessionId: v.id('chatSessions'),
		channel: v.string(),
		guestName: v.string(),
		lastMessage: v.string()
	},
	handler: async (_ctx, args) => {
		const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');
		const link = siteUrl ? `${siteUrl}/admin/chats?session=${encodeURIComponent(args.sessionId)}` : undefined;
		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.EMAIL_FROM;
		const owner = process.env.OWNER_NOTIFICATION_EMAIL;
		if (!link) console.warn('SITE_URL not configured, staff alert will not include an admin link');
		if (!apiKey || !from || !owner) {
			console.warn('RESEND_API_KEY, EMAIL_FROM, or OWNER_NOTIFICATION_EMAIL not configured, skipping staff alert email');
		} else {
			try {
				const { error } = await new Resend(apiKey).emails.send({
					from, to: owner,
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
