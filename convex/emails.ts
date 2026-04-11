"use node";
import { action } from './_generated/server';
import { v } from 'convex/values';
import { Resend } from 'resend';

export const sendBookingConfirmation = action({
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
		if (!apiKey) {
			console.warn('RESEND_API_KEY not configured, skipping email');
			return { sent: false, reason: 'no_api_key' };
		}

		const resend = new Resend(apiKey);

		const { error } = await resend.emails.send({
			from: 'Spin & Stay <bookings@spinandstay.com>',
			to: args.guestEmail,
			subject: `Booking Confirmed: ${args.propertyName} (${args.checkIn} - ${args.checkOut})`,
			html: `
				<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
					<h1 style="font-size: 24px; color: #111; margin-bottom: 8px;">Booking Confirmed!</h1>
					<p style="color: #666; font-size: 16px;">Thank you, ${args.guestName}. Your stay is confirmed.</p>

					<div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin: 24px 0;">
						<h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">${args.propertyName}</h2>
						<table style="width: 100%; border-collapse: collapse;">
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Check-in</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${args.checkIn}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Check-out</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${args.checkOut}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Nights</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${args.nights}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #666; font-size: 14px;">Guests</td>
								<td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 14px;">${args.guests}</td>
							</tr>
							<tr style="border-top: 1px solid #ddd;">
								<td style="padding: 12px 0 0; font-weight: 700; font-size: 16px;">Total</td>
								<td style="padding: 12px 0 0; text-align: right; font-weight: 700; font-size: 16px; color: #0ea5e9;">
									${args.currency === 'THB' ? '฿' : args.currency}${args.total.toLocaleString()}
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

export const sendOwnerNotification = action({
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

		if (!apiKey || !ownerEmail) {
			console.warn('RESEND_API_KEY or OWNER_NOTIFICATION_EMAIL not configured');
			return { sent: false, reason: 'missing_config' };
		}

		const resend = new Resend(apiKey);

		const { error } = await resend.emails.send({
			from: 'Spin & Stay <notifications@spinandstay.com>',
			to: ownerEmail,
			subject: `New Booking: ${args.propertyName} (${args.checkIn} - ${args.checkOut})`,
			html: `
				<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
					<h1 style="font-size: 24px; color: #111;">New Direct Booking!</h1>

					<div style="background: #f0fdf4; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bbf7d0;">
						<h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">${args.propertyName}</h2>
						<table style="width: 100%; border-collapse: collapse;">
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Guest</td>
								<td style="padding: 6px 0; text-align: right; font-weight: 600; font-size: 14px;">${args.guestName}</td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Email</td>
								<td style="padding: 6px 0; text-align: right; font-size: 14px;"><a href="mailto:${args.guestEmail}">${args.guestEmail}</a></td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Phone/WhatsApp</td>
								<td style="padding: 6px 0; text-align: right; font-size: 14px;">${args.guestPhone}</td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Dates</td>
								<td style="padding: 6px 0; text-align: right; font-weight: 600; font-size: 14px;">${args.checkIn} → ${args.checkOut} (${args.nights} nights)</td>
							</tr>
							<tr>
								<td style="padding: 6px 0; color: #666; font-size: 14px;">Guests</td>
								<td style="padding: 6px 0; text-align: right; font-size: 14px;">${args.guests}</td>
							</tr>
							<tr style="border-top: 1px solid #bbf7d0;">
								<td style="padding: 12px 0 0; font-weight: 700; font-size: 16px;">Revenue</td>
								<td style="padding: 12px 0 0; text-align: right; font-weight: 700; font-size: 16px; color: #16a34a;">
									${args.currency === 'THB' ? '฿' : args.currency}${args.total.toLocaleString()}
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
