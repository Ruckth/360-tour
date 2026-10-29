import type { QueryCtx } from '../_generated/server';

/** Match the same international number with or without '+', never infer a country for access checks. */
export async function bookingsByPhone(ctx: QueryCtx, phone: string, limit: number) {
	const trimmed = phone.trim();
	if (!trimmed) return [];
	const digits = trimmed.replace(/^\+/, '');
	const forms = /^\+?[1-9]\d{6,14}$/.test(trimmed) ? [digits, `+${digits}`] : [trimmed];
	const matches = await Promise.all(forms.map((form) => ctx.db.query('bookings')
		.withIndex('by_guestPhone', (q) => q.eq('guestPhone', form)).order('desc').take(limit)));
	return [...new Map(matches.flat().map((booking) => [booking._id, booking])).values()];
}
