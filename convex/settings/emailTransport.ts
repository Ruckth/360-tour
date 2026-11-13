import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { EffectiveSettings } from '../shared/siteSettings';

export function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export async function loadSettings(ctx: ActionCtx): Promise<EffectiveSettings> {
	return await ctx.runQuery(internal.settings.settings.effective, {});
}

/** Display name from Settings; the address itself always comes from the EMAIL_FROM env var. */
export function fromHeader(emailFrom: string, settings: EffectiveSettings) {
	const address = emailFrom.match(/<([^>]+)>/)?.[1]?.trim() ?? emailFrom.trim();
	const name = (settings.email.fromName || settings.businessName).replace(/[<>"\r\n]/g, '').trim();
	return name ? `"${name}" <${address}>` : address;
}

export function ownerNotificationEmail(settings: EffectiveSettings) {
	return settings.email.ownerNotificationEmail || process.env.OWNER_NOTIFICATION_EMAIL;
}

export function footerHtml(settings: EffectiveSettings) {
	return settings.email.footer
		? `<p style="color: #999; font-size: 12px; margin-top: 32px;">${escapeHtml(settings.email.footer)}</p>`
		: '';
}
