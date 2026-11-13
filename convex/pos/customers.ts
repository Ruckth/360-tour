import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { adminMutation, adminQuery, internalMutation, staffMutation, staffQuery } from '../auth/model';
import { orderState } from './private/orderLinks';
import { orderTitle, roundMoney } from '../shared/orderMath';
import { orderRefundTotal } from './private/orderRefunds';
import { appendRecordHistory } from '../settings/model';
import { cleanCustomer, CUSTOMER_POS_INTEGRATION_ENABLED, customerCard, customerInput, customerValues, expectRevision, mergeCustomerRecords, mergeInput, moveMergeBatch, pageSize, SEARCH_LIMIT } from './private/customerModel';

/** Exact contact search or name search, with a cursor even when a page contains only hidden rows. */
export const browseCustomers = staffQuery({
  capability: 'checkout',
	args: { query: v.string(), archived: v.boolean(), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const access = ctx.staff;
		if (access.role === 'cashier' && (args.archived || args.query.trim().length < 2)) return { page: [], isDone: true, continueCursor: '' };
		pageSize(args.paginationOpts.numItems);
		const raw = args.query.trim();
		if (raw.length > 200) throw new ConvexError('Search must be at most 200 characters');
		const digits = raw.replace(/\D/g, '');
		const rows = raw.length < 2
			? args.archived
				? ctx.db.query('customers').withIndex('by_archivedAt', q => q.gt('archivedAt', 0))
				: ctx.db.query('customers').withIndex('by_archivedAt', q => q.eq('archivedAt', undefined))
			: raw.includes('@')
				? ctx.db.query('customers').withIndex('by_emailNormalized', q => q.eq('emailNormalized', raw.toLowerCase()))
				: /^[+\d\s()-]+$/.test(raw) && digits.length >= 4
					? ctx.db.query('customers').withIndex('by_phoneDigits', q => q.eq('phoneDigits', digits))
					: ctx.db.query('customers').withSearchIndex('search_name', q => q.search('name', raw));
		const result = await rows.paginate(args.paginationOpts);
		return { ...result, page: result.page.filter(c => Boolean(c.archivedAt) === args.archived).map(customerCard) };
	}
});

/** By exact phone (digits) or email, and by name words. Same-name results are listed separately. */
export const searchCustomers = staffQuery({
  capability: 'checkout',
	args: { query: v.string() },
	handler: async (ctx, args) => {
		const raw = args.query.trim();
		if (raw.length < 2) return [];
		const digits = raw.replace(/\D/g, '');
		const email = raw.toLowerCase();
		const [byPhone, byEmail, byName] = await Promise.all([
			digits.length >= 4 ? ctx.db.query('customers').withIndex('by_phoneDigits', (q) => q.eq('phoneDigits', digits)).take(SEARCH_LIMIT) : [],
			email.includes('@') ? ctx.db.query('customers').withIndex('by_emailNormalized', (q) => q.eq('emailNormalized', email)).take(SEARCH_LIMIT) : [],
			ctx.db.query('customers').withSearchIndex('search_name', (q) => q.search('name', raw)).take(SEARCH_LIMIT)
		]);
		const found = new Map<Id<'customers'>, Doc<'customers'>>();
		for (const customer of [...byPhone, ...byEmail, ...byName]) found.set(customer._id, customer);

		return [...found.values()].filter(c => !c.archivedAt && !c.mergedInto).slice(0, SEARCH_LIMIT).map(customerCard);
	}
});

/** A profile with its most recent orders. */
export const getCustomer = adminQuery({
	args: { customerId: v.id('customers') },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) return null;
		const orders = await ctx.db
			.query('orders')
			.withIndex('by_customerId_and_updatedAt', (q) => q.eq('customerId', customer._id))
			.order('desc')
			.take(11);
		const refundedByOrder = new Map<Id<'orders'>, number>();
		for (const order of orders.slice(0, 10)) refundedByOrder.set(order._id, await orderRefundTotal(ctx, order._id));
		return {
			...customerCard(customer),
			notes: customer.notes,
			mergeEnabled: CUSTOMER_POS_INTEGRATION_ENABLED,
            mergeProgress: await ctx.db.query('customerMergeJobs').withIndex('by_sourceId', q => q.eq('sourceId', customer._id)).unique(),
			ordersHasMore: orders.length > 10,
			orders: orders.slice(0, 10).map((order) => {
				const refundAmounts: { refundedAmountSatang?: number } = { refundedAmountSatang: refundedByOrder.get(order._id) };
				return {
					_id: order._id,
					title: orderTitle(order.orderNumber),
					state: orderState(order),
					total: Math.max(0, roundMoney(order.total - (refundedByOrder.get(order._id) ?? 0))),
					...refundAmounts,
					currency: order.currency,
					updatedAt: order.updatedAt
				};
			})
		};
	}
});

export const listCustomerOrders = adminQuery({
	args: { customerId: v.id('customers'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		pageSize(args.paginationOpts.numItems);
		const result = await ctx.db.query('orders').withIndex('by_customerId_and_updatedAt', q => q.eq('customerId', args.customerId)).order('desc').paginate(args.paginationOpts);
		const page = [];
		for (const order of result.page) {
			const refundedAmountSatang = await orderRefundTotal(ctx, order._id);
			const refundAmounts: { refundedAmountSatang?: number } = { refundedAmountSatang };
			page.push({ _id: order._id, title: orderTitle(order.orderNumber), state: orderState(order), total: Math.max(0, roundMoney(order.total - refundedAmountSatang)), ...refundAmounts, currency: order.currency });
		}
		return { ...result, page };
	}
});

/** Dedicated reader avoids depending on regenerated shared api types. Only customer business history. */
export const customerHistory = adminQuery({
	args: { customerId: v.id('customers'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		pageSize(args.paginationOpts.numItems);
		return await ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'customer').eq('entityId', args.customerId)).order('desc').paginate(args.paginationOpts);
	}
});

export const createCustomer = staffMutation({
  capability: 'checkout',
	args: customerInput,
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		if (admin.role === 'cashier' && args.notes?.trim()) throw new Error('Not authorized');
		const now = Date.now();
		const profile = cleanCustomer(args);
		const id = await ctx.db.insert('customers', { ...profile, revision: 0, createdBy: admin.email, createdAt: now, updatedAt: now });
		await appendRecordHistory(ctx, { entityType: 'customer', entityId: id, actor: admin.email, kind: 'created', after: profile });
		return id;
	}
});

/**
 * Edits the profile. Paid receipts keep the details they were issued with (orders.customerSnapshot).
 * The customer revision changes without traversing orders. Settlement checks the exact revision
 * reviewed by the cashier, so unseen profile edits require renewed review.
 */
export const updateCustomer = adminMutation({
	args: { customerId: v.id('customers'), expectedRevision: v.optional(v.number()), ...customerInput },
	handler: async (ctx, { customerId, expectedRevision, ...input }) => {
		const admin = ctx.admin;
		const customer = await ctx.db.get(customerId);
		if (!customer) throw new ConvexError('Customer not found');
		if (customer.mergedInto) throw new ConvexError('This profile was merged. Open the kept customer to edit it.');
		expectRevision(customer, expectedRevision);
		const next = cleanCustomer(input, customer.phone);
		if (JSON.stringify(customerValues(next)) === JSON.stringify(customerValues(customer))) return;
		const now = Date.now();
		await ctx.db.patch(customerId, { ...next, revision: (customer.revision ?? 0) + 1, updatedAt: now });
		await appendRecordHistory(ctx, { entityType: 'customer', entityId: customerId, actor: admin.email, kind: 'edited', before: customerValues(customer), after: customerValues(next) });
	}
});

export const setCustomerArchived = adminMutation({
	args: { customerId: v.id('customers'), archived: v.boolean(), expectedRevision: v.number() },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError('Customer not found');
		if (customer.mergedInto) throw new ConvexError('Merged profiles cannot be restored. Open the kept customer.');
		expectRevision(customer, args.expectedRevision);
		if (Boolean(customer.archivedAt) === args.archived) return;
		const archivedAt = args.archived ? Date.now() : undefined;
		await ctx.db.patch(customer._id, { archivedAt, revision: (customer.revision ?? 0) + 1, updatedAt: Date.now() });
		await appendRecordHistory(ctx, { entityType: 'customer', entityId: customer._id, actor: admin.email, kind: args.archived ? 'archived' : 'restored', before: { archived: Boolean(customer.archivedAt) }, after: { archived: args.archived } });
	}
});

/** Only the scheduler can invoke continuation; the job retains the authenticated initiating actor. */
export const continueMerge = internalMutation({
    args: { jobId: v.id('customerMergeJobs') },
    handler: async (ctx, { jobId }) => { await moveMergeBatch(ctx, jobId); return null; }
});

/** Admin recovery also advances one bounded batch, safely racing an already scheduled invocation. */
export const resumeCustomerMerge = adminMutation({
    args: { sourceId: v.id('customers') },
    handler: async (ctx, { sourceId }) => {
        const job = await ctx.db.query('customerMergeJobs').withIndex('by_sourceId', q => q.eq('sourceId', sourceId)).unique();
        if (!job) throw new ConvexError('No merge to resume');
        await moveMergeBatch(ctx, job._id);
        return null;
    }
});

export const mergeCustomers = adminMutation({ args: mergeInput, handler: mergeCustomerRecords });

/** Minimal identity card for the checkout picker; no notes, histories or unrelated orders. */
export const checkoutCustomer = staffQuery({
  capability: 'checkout', args: { customerId: v.id('customers') }, handler: async (ctx, args) => {
 const customer = await ctx.db.get(args.customerId);
 return customer ? customerCard(customer) : null;
} });
