import { ConvexError, v } from 'convex/values';
import { marketingQuery, marketingMutation, publicMutation } from './auth/model';
import type { Doc, Id } from './_generated/dataModel';
import { couponRefusalProblemValidator, couponRefusalSurfaceValidator, reportBasisValidator, validateSpend, type CouponRefusalSummary, type ReportData, type ReportSpend } from './lib/marketingReport';
import { requireStaff } from './lib/staffAccess';
import { canReadMarketingPersonalData } from './lib/marketingPrivacy';
import { readMarketingReport, reportSpend } from './lib/marketingReportRead';
import { appendRecordHistory } from './settings/model';
import { normalizeCouponCode } from './lib/offers';
import { enforceRateLimit } from './lib/rateLimit';
import { resortLocalParts } from './lib/serviceSlots';
import { readRangeWithinBudget } from './lib/readBudget';

export const getReport = marketingQuery({
  permission: 'view',
	args: { from: v.string(), to: v.string(), basis: reportBasisValidator },
	handler: async (ctx, args): Promise<ReportData> => {
		const access = ctx.marketing;
		const report = await readMarketingReport(ctx, args);
		if (!canReadMarketingPersonalData(access)) for (const sale of report.sales) {
			sale.label = 'Guest';
			if (sale.kind === 'stay') delete sale.ref;
		}
		return report;
	}
});

export const listSpend = marketingQuery({
  permission: 'view',
	args: { campaignId: v.id('marketingCampaigns') },
	handler: async (ctx, args): Promise<ReportSpend[]> => {
		const rows = await readRangeWithinBudget(ctx, ctx.db.query('marketingSpend').withIndex('by_campaignId_and_from', q => q.eq('campaignId', args.campaignId)).order('desc'));
		return rows.filter(r => r.deletedAt === undefined).sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime).map(reportSpend);
	}
});

const snapshot = (row: Pick<Doc<'marketingSpend'>, 'amount' | 'from' | 'to' | 'note'>, campaign: Doc<'marketingCampaigns'> | null) => ({ campaign: campaign?.name ?? 'Removed campaign', amount: row.amount, from: row.from, to: row.to, note: row.note ?? null });

export const saveSpend = marketingMutation({
  permission: 'spend',
	args: { id: v.optional(v.id('marketingSpend')), campaignId: v.id('marketingCampaigns'), amount: v.number(), from: v.string(), to: v.string(), note: v.optional(v.string()) },
	handler: async (ctx, args): Promise<Id<'marketingSpend'>> => {
		const admin = ctx.marketing;
		const problem = validateSpend(args);
		if (problem) throw new ConvexError(problem);
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign) throw new ConvexError('Campaign not found.');
		const before = args.id ? await ctx.db.get(args.id) : null;
		if (args.id && (!before || before.deletedAt !== undefined)) throw new ConvexError('Spend entry not found.');
		// The history names the campaign, so moving an entry to another campaign leaves a trace.
		const campaignBefore = before && before.campaignId !== args.campaignId ? await ctx.db.get(before.campaignId) : campaign;
		const now = Date.now();
		const fields = { campaignId: args.campaignId, amount: args.amount, from: args.from, to: args.to, note: args.note?.trim() || undefined, updatedAt: now, updatedByEmail: admin.email };
		const id = args.id ?? await ctx.db.insert('marketingSpend', { ...fields, createdAt: now, createdByEmail: admin.email });
		if (args.id) await ctx.db.patch(id, fields);
		await appendRecordHistory(ctx, { entityType: 'marketingSpend', entityId: id, actor: admin.email, kind: before ? 'updated' : 'created', before: before ? snapshot(before, campaignBefore) : null, after: snapshot(fields, campaign) });
		return id;
	}
});

export const deleteSpend = marketingMutation({
  permission: 'spend',
	args: { id: v.id('marketingSpend') },
	handler: async (ctx, args): Promise<null> => {
		const admin = ctx.marketing;
		const row = await ctx.db.get(args.id);
		if (!row) throw new ConvexError('Spend entry not found.');
		if (row.deletedAt !== undefined) return null;
		await ctx.db.patch(row._id, { deletedAt: Date.now(), deletedByEmail: admin.email, updatedAt: Date.now(), updatedByEmail: admin.email });
		await appendRecordHistory(ctx, { entityType: 'marketingSpend', entityId: row._id, actor: admin.email, kind: 'deleted', before: snapshot(row, await ctx.db.get(row.campaignId)), after: null });
		return null;
	}
});

export const couponRefusals = marketingQuery({
  permission: 'view',
	args: { couponId: v.id('coupons'), days: v.optional(v.number()) },
	handler: async (ctx, args): Promise<CouponRefusalSummary> => {
		const days = args.days ?? 30;
		if (!Number.isInteger(days) || days < 1 || days > 90) throw new ConvexError('Choose between 1 and 90 days.');
		const today = resortLocalParts(Date.now()).date;
		const since = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
		const rows = await readRangeWithinBudget(ctx, ctx.db.query('couponRefusalDays').withIndex('by_couponId_and_day', q => q.eq('couponId', args.couponId).gte('day', since).lte('day', today)));
		const problems = new Map<Doc<'couponRefusalDays'>['problem'], number>();
		const surfaces = new Map<Doc<'couponRefusalDays'>['surface'], number>();
		let total = 0;
		for (const row of rows) {
			problems.set(row.problem, (problems.get(row.problem) ?? 0) + row.count);
			// "Direct offer was better" is not a refusal: listed by problem, left out of the totals.
			if (row.problem === 'coupon_worse') continue;
			total += row.count;
			surfaces.set(row.surface, (surfaces.get(row.surface) ?? 0) + row.count);
		}
		return { since, total, byProblem: [...problems].map(([problem, count]) => ({ problem, count })), bySurface: [...surfaces].map(([surface, count]) => ({ surface, count })) };
	}
});

/** Public diagnostics: invalid inputs, unauthorised staff surfaces and excess traffic are dropped. */
export const noteCouponRefusal = publicMutation({
  reason: "Anonymous booking diagnostics; staff surfaces separately authorize and otherwise drop.",
	args: { code: v.string(), problem: couponRefusalProblemValidator, surface: couponRefusalSurfaceValidator },
	handler: async (ctx, args): Promise<null> => {
		if (args.surface !== 'booking') {
			try { await requireStaff(ctx, args.surface === 'pos' ? 'checkout' : 'operations'); } catch { return null; }
		}
		const code = normalizeCouponCode(args.code);
		if (!code || code.length > 100) return null;
		// Staff surfaces get their own limit, so public traffic can't silence checkout and New booking reports.
		try { await enforceRateLimit(ctx, args.surface === 'booking' ? 'coupon-refusal:global' : 'coupon-refusal:staff', 5000, 60 * 60 * 1000); }
		catch (error) {
			if (error instanceof Error && error.message.startsWith('Too many requests.')) return null;
			throw error;
		}
		const coupon = await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique();
		const couponId = coupon?._id;
		// A link without an offer has no coupon to look up; keep that reason rather than calling it an unknown code.
		const problem = coupon || args.problem === 'link_without_offer' ? args.problem : 'not_found';
		const day = resortLocalParts(Date.now()).date;
		const row = await ctx.db.query('couponRefusalDays').withIndex('by_day_and_couponId_and_problem_and_surface', q => q.eq('day', day).eq('couponId', couponId).eq('problem', problem).eq('surface', args.surface)).unique();
		if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
		else await ctx.db.insert('couponRefusalDays', { day, couponId, problem, surface: args.surface, count: 1 });
		return null;
	}
});
