import { Resend } from 'resend';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { type ActionCtx } from '../../auth/model';
import { escapeHtml, footerHtml, fromHeader, loadSettings } from '../../settings/model';

export function escapedFields<T extends { guestName: string; propertyName: string; checkIn: string; checkOut: string; currency: string }>(args: T) {
	return { ...args, guestName: escapeHtml(args.guestName), propertyName: escapeHtml(args.propertyName), checkIn: escapeHtml(args.checkIn), checkOut: escapeHtml(args.checkOut), currency: escapeHtml(args.currency), ...('guestEmail' in args ? { guestEmail: escapeHtml(String(args.guestEmail)) } : {}), ...('guestPhone' in args ? { guestPhone: escapeHtml(String(args.guestPhone)) } : {}) };
}

function formatMoney(amount: number, currency: string) {
	return `${currency === 'THB' ? '฿' : `${currency} `}${(amount / 100).toLocaleString('en-US')}`;
}

type LifecycleKind = 'cancellation' | 'preArrival' | 'review' | 'updated';

async function retryLifecycleEmail(ctx: ActionCtx, bookingId: Id<'bookings'>, kind: LifecycleKind, attempt: number) {
	if (attempt >= 3) return;
	const delay = 5 * 60 * 1000 * 2 ** attempt;
	const args = { bookingId, attempt: attempt + 1 };
	if (kind === 'cancellation') await ctx.scheduler.runAfter(delay, internal.bookings.emails.sendCancellation, args);
	else if (kind === 'preArrival') await ctx.scheduler.runAfter(delay, internal.bookings.emails.sendPreArrival, args);
	else if (kind === 'updated') await ctx.scheduler.runAfter(delay, internal.bookings.emails.sendBookingUpdated, args);
	else await ctx.scheduler.runAfter(delay, internal.bookings.emails.sendReviewRequest, args);
}

export async function sendLifecycleEmail(ctx: ActionCtx, bookingId: Id<'bookings'>, kind: LifecycleKind, attempt = 0) {
	const details: { guestName: string; guestEmail: string; propertyName: string; checkIn: string; checkOut: string; guests: number; total: number; currency: string } | null =
		await ctx.runQuery(internal.bookings.bookings.getLifecycleEmailDetails, { bookingId, kind });
	if (!details) return { sent: false, reason: 'booking_not_eligible' };
	const apiKey = process.env.RESEND_API_KEY;
	const from = process.env.EMAIL_FROM;
	if (!apiKey || !from) {
		console.warn('RESEND_API_KEY or EMAIL_FROM not configured, skipping lifecycle email');
		return { sent: false, reason: 'missing_config' };
	}
	const settings = await loadSettings(ctx);
	const signOff = `<p>${escapeHtml(settings.businessName)}</p>${footerHtml(settings)}`;
	const name = escapeHtml(details.guestName);
	const property = escapeHtml(details.propertyName);
	const checkIn = escapeHtml(details.checkIn);
	const checkOut = escapeHtml(details.checkOut);
	const content = {
		cancellation: {
			subject: `Booking Cancelled: ${details.propertyName}`,
			html: `<p>Hi ${name},</p><p>Your booking at ${property} for ${checkIn} to ${checkOut} has been cancelled.</p><p>If you have questions about payment or a refund, please reply to this email.</p>${signOff}`
		},
		preArrival: {
			subject: `Your stay at ${details.propertyName} is coming up`,
			html: `<p>Hi ${name},</p><p>We look forward to welcoming you to ${property} on ${checkIn}. Your check-out is ${checkOut}.</p><p>Reply to this email if you need help before arrival.</p>${signOff}`
		},
		updated: {
			subject: `Booking Updated: ${details.propertyName} (${details.checkIn} - ${details.checkOut})`,
			html: `<p>Hi ${name},</p><p>Your booking has been updated. Here are the current details:</p><ul><li>Villa: ${property}</li><li>Check-in: ${checkIn}</li><li>Check-out: ${checkOut}</li><li>Guests: ${details.guests}</li><li>Total: ${escapeHtml(formatMoney(details.total, details.currency))}</li></ul><p>If anything looks wrong, please reply to this email.</p>`
		},
		review: {
			subject: `How was your stay at ${details.propertyName}?`,
			html: `<p>Hi ${name},</p><p>Thank you for staying at ${property}. We hope you enjoyed your visit. Please reply and let us know how it went.</p>${signOff}`
		}
	}[kind];
	let failureReason = 'send_failed';
	try {
		const { error } = await new Resend(apiKey).emails.send({ from: fromHeader(from, settings), to: details.guestEmail, ...content });
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
