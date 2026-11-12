import { Resend } from 'resend';
import { adminAction } from '../auth/model';
import { footerHtml, fromHeader, loadSettings, ownerNotificationEmail } from './emailTransport';

/** Setup checklist: sends a short test email to the owner notification address (or the signed-in admin). */
export const sendTestEmail = adminAction({
	args: {},
	handler: async (ctx): Promise<{ ok: boolean; to: string; message: string }> => {
		const admin = ctx.admin;
		const settings = await loadSettings(ctx);
		const to = ownerNotificationEmail(settings) || admin.email;
		const apiKey = process.env.RESEND_API_KEY;
		const from = process.env.EMAIL_FROM;
		if (!apiKey || !from) return { ok: false, to, message: 'Set RESEND_API_KEY and EMAIL_FROM in Convex first.' };
		try {
			const { error } = await new Resend(apiKey).emails.send({
				from: fromHeader(from, settings),
				to,
				subject: `Test email from ${settings.businessName}`,
				html: `<p>Email is working. Booking confirmations and staff alerts will be sent from this address.</p>${footerHtml(settings)}`
			});
			if (error) return { ok: false, to, message: error.message };
			return { ok: true, to, message: `Sent to ${to}. Check the inbox (and spam folder).` };
		} catch (error) {
			return { ok: false, to, message: error instanceof Error ? error.message : 'Could not send the email.' };
		}
	}
});
