import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
	couponRefusalProblemValidator, couponRefusalSurfaceValidator, reportBasisValidator,
	type CouponRefusalSummary, type ReportData, type ReportSpend
} from './lib/marketingReport';

/**
 * Release 3b · Report. Contract stubs: the backend package fills in every handler.
 * See convex/lib/marketingReport.ts for the money rules and the shape the dashboard reads.
 */

const NOT_BUILT = 'Release 3b: not implemented yet';

/**
 * Admin. One read for the dashboard and its CSV. `from`/`to` are Bangkok days, inclusive, at most
 * MAX_REPORT_DAYS apart. Property filter and last/first touch are applied by the UI on this data.
 * Must stay inside the read budget (lib/readBudget.ts); set `truncated` instead of throwing.
 */
export const getReport = query({
	args: { from: v.string(), to: v.string(), basis: reportBasisValidator },
	handler: async (_ctx, _args): Promise<ReportData> => {
		throw new Error(NOT_BUILT);
	}
});

/** Admin. A campaign's spend entries, newest first, deleted ones left out. */
export const listSpend = query({
	args: { campaignId: v.id('marketingCampaigns') },
	handler: async (_ctx, _args): Promise<ReportSpend[]> => {
		throw new Error(NOT_BUILT);
	}
});

/** Admin. Adds or edits one entry (validateSpend), with history (entityType `marketingSpend`). */
export const saveSpend = mutation({
	args: {
		id: v.optional(v.id('marketingSpend')),
		campaignId: v.id('marketingCampaigns'),
		amount: v.number(),
		from: v.string(),
		to: v.string(),
		note: v.optional(v.string())
	},
	handler: async (_ctx, _args): Promise<Id<'marketingSpend'>> => {
		throw new Error(NOT_BUILT);
	}
});

/** Admin. Soft delete with history; the entry leaves every report. */
export const deleteSpend = mutation({
	args: { id: v.id('marketingSpend') },
	handler: async (_ctx, _args): Promise<null> => {
		throw new Error(NOT_BUILT);
	}
});

/** Admin. Refusals for one coupon over the last `days` Bangkok days (default 30, max 90). */
export const couponRefusals = query({
	args: { couponId: v.id('coupons'), days: v.optional(v.number()) },
	handler: async (_ctx, _args): Promise<CouponRefusalSummary> => {
		throw new Error(NOT_BUILT);
	}
});

/**
 * Counts one refusal the user just saw. Never throws for bad input or the rate limit: it drops it.
 * `booking` is public (the guest funnel); `admin_booking` and `pos` require an admin.
 * The code is normalized and looked up; an unknown code is counted without a coupon and the
 * typed text is never stored. Counts are diagnostic: a browser reports them.
 */
export const noteCouponRefusal = mutation({
	args: { code: v.string(), problem: couponRefusalProblemValidator, surface: couponRefusalSurfaceValidator },
	handler: async (_ctx, _args): Promise<null> => {
		throw new Error(NOT_BUILT);
	}
});
