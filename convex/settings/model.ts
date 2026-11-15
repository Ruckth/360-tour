import type { QueryCtx } from '../_generated/server';
import type { EffectiveSettings } from '../shared/siteSettings';
import { mergeSiteSettings } from '../shared/siteSettings';

export async function getSiteSettingsRow(ctx: QueryCtx) {
	return await ctx.db
		.query('siteSettings')
		.withIndex('by_key', (q) => q.eq('key', 'default'))
		.unique();
}

export async function getEffectiveSettings(ctx: QueryCtx): Promise<EffectiveSettings> {
	return mergeSiteSettings(await getSiteSettingsRow(ctx));
}

// Backend settings interface: named plain implementations, never endpoint aliases.
export { cashierRules } from './cashierPolicy';
export { configurationWriter, logConfiguration, logOtaRate, propertySnapshot, roomSnapshot, settingsSnapshot } from './configurationWriter';
export { escapeHtml, footerHtml, fromHeader, loadSettings, ownerNotificationEmail } from './emailTransport';
export { appendRecordHistory } from './recordWriter';
