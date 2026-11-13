import { v } from 'convex/values';
import { Resend } from 'resend';
import { internalAction } from '../auth/model';
import { escapeHtml, footerHtml, fromHeader, loadSettings, ownerNotificationEmail } from '../settings/model';
import { escapedFields, sendLifecycleEmail } from './private/emails';

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
	handler: async (ctx, args) => {
		const apiKey = process.env.RESEND_API_KEY;
		const emailFrom = process.env.EMAIL_FROM;
		if (!apiKey || !emailFrom) {
			console.warn('RESEND_API_KEY or EMAIL_FROM not configured, skipping email');
			return { sent: false, reason: 'no_api_key' };
		}

		const settings = await loadSettings(ctx);
		const resend = new Resend(apiKey);
		const safe = escapedFields(args);

		const { error } = await resend.emails.send({
			from: fromHeader(emailFrom, settings),
			to: args.guestEmail,
			subject: `Booking Confirmed: ${args.propertyName} (${args.checkIn} - ${args.checkOut})`,
			html: `
				<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
					<h1 style="font-size: 24px; color: #111; margin-bottom: 8px;">Booking Confirmed!</h1>
					<p style="color: #666; font-size: 16px;">Thank you, ${safe.guestName}. Your stay at ${escapeHtml(settings.businessName)} is confirmed.</p>

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

					${footerHtml(settings)}
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
	handler: async (ctx, args) => {
		const settings = await loadSettings(ctx);
		const apiKey = process.env.RESEND_API_KEY;
		const ownerEmail = ownerNotificationEmail(settings);
		const emailFrom = process.env.EMAIL_FROM;

		if (!apiKey || !ownerEmail || !emailFrom) {
			console.warn('RESEND_API_KEY, EMAIL_FROM, or OWNER_NOTIFICATION_EMAIL not configured');
			return { sent: false, reason: 'missing_config' };
		}

		const resend = new Resend(apiKey);
		const safe = escapedFields(args);

		const { error } = await resend.emails.send({
			from: fromHeader(emailFrom, settings),
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

export const sendCancellation = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'cancellation', args.attempt)
});

export const sendPreArrival = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'preArrival', args.attempt)
});

export const sendBookingUpdated = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'updated', args.attempt)
});

export const sendReviewRequest = internalAction({
	args: { bookingId: v.id('bookings'), attempt: v.optional(v.number()) },
	handler: async (ctx, args) => await sendLifecycleEmail(ctx, args.bookingId, 'review', args.attempt)
});
