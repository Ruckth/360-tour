import { appendRecordHistory } from './lib/recordHistory';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import { requireStaff } from './lib/staffAccess';
import { orderTitle, roundMoney } from './lib/orderMath';
import { orderRefundTotal } from './lib/orderRefunds';
import { orderState } from './lib/orderLinks';
import { assertValidEmail } from './lib/validation';
import { customerPhoneError } from '../src/lib/booking/phone';

/**
 * Reusable customer profiles for orders (admin only). An order links to a customer by id;
 * customers are never created, matched or merged from a name, so namesakes stay distinct and a
 * booking's guest is not assumed to be the payer.
 */

const SEARCH_LIMIT = 20;
const NAME_MAX = 120;
const PHONE_MAX = 40;
const EMAIL_MAX = 200;
const NOTES_MAX = 1000;

// Checkout sends the revision captured when payment review opens; settlement validates it atomically.
export const CUSTOMER_POS_INTEGRATION_ENABLED = true;

/** POS integration seam: never silently redirect an explicit customer selection. */
export function assertCustomerCanLink(customer: Doc<'customers'> | null) {
	if (!customer) throw new ConvexError('Customer not found');
	if (customer.mergedInto) throw new ConvexError('This profile was merged. Open and review the kept customer before linking.');
	if (customer.archivedAt) throw new ConvexError('Restore this customer before linking to a new order.');
	return customer;
}

/** Call in settleOrder after payment replay handling and before any writes; see delivery contract. */
export function assertCustomerReviewed(customer: Doc<'customers'> | null, expectedRevision: number | undefined) {
	if (!customer) throw new ConvexError('The linked customer no longer exists. Link another customer or remove the link.');
	if (customer.mergedInto) throw new ConvexError('The linked customer was merged. Reopen this order and review its customer.');
	if (expectedRevision !== (customer.revision ?? 0)) throw new ConvexError('The customer changed. Review the customer and pay again.');
}

const customerInput = {
	name: v.string(),
	phone: v.optional(v.string()),
	email: v.optional(v.string()),
	notes: v.optional(v.string())
};

function text(value: string | undefined, label: string, max: number) {
	const trimmed = value?.trim();
	if (trimmed && trimmed.length > max) throw new ConvexError(`${label} must be at most ${max} characters`);
	return trimmed || undefined;
}

/** Trims and validates a profile, with its exact-lookup fields. */
export function cleanCustomer(input: { name: string; phone?: string; email?: string; notes?: string }, previousPhone?: string) {
	const name = text(input.name, 'Name', NAME_MAX);
	if (!name) throw new ConvexError('Enter the customer name');
	const phone = text(input.phone, 'Phone', PHONE_MAX);
	// Unrelated edits must still work for profiles saved before phone validation existed.
	const phoneError = phone !== previousPhone?.trim() ? customerPhoneError(phone) : undefined;
	if (phoneError) throw new ConvexError(phoneError);
	const email = text(input.email, 'Email', EMAIL_MAX);
	if (email) assertValidEmail(email);
	return {
		name,
		phone,
		phoneDigits: phone?.replace(/\D/g, '') || undefined,
		email,
		emailNormalized: email?.toLowerCase(),
		notes: text(input.notes, 'Notes', NOTES_MAX)
	};
}

export function customerCard(customer: Doc<'customers'>) {
	return { _id: customer._id, name: customer.name, phone: customer.phone, email: customer.email,
		revision: customer.revision ?? 0, archivedAt: customer.archivedAt, mergedInto: customer.mergedInto };
}

function pageSize(numItems: number) {
	if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new ConvexError('Page size must be 1–50');
}

function customerValues(customer: { name: string; phone?: string; email?: string; notes?: string }) {
	return { name: customer.name, phone: customer.phone, email: customer.email, notes: customer.notes };
}

/** Exact contact search or name search, with a cursor even when a page contains only hidden rows. */
export const browseCustomers = query({
	args: { query: v.string(), archived: v.boolean(), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const access = await requireStaff(ctx, 'checkout');
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
export const searchCustomers = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		await requireStaff(ctx, 'checkout');
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
export const getCustomer = query({
	args: { customerId: v.id('customers') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
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

export const listCustomerOrders = query({
	args: { customerId: v.id('customers'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
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
export const customerHistory = query({
	args: { customerId: v.id('customers'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		pageSize(args.paginationOpts.numItems);
		return await ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'customer').eq('entityId', args.customerId)).order('desc').paginate(args.paginationOpts);
	}
});

export const createCustomer = mutation({
	args: customerInput,
	handler: async (ctx, args) => {
		const admin = await requireStaff(ctx, 'checkout');
		if (admin.role === 'cashier' && args.notes?.trim()) throw new Error('Not authorized');
		const now = Date.now();
		const profile = cleanCustomer(args);
		const id = await ctx.db.insert('customers', { ...profile, revision: 0, createdBy: admin.email, createdAt: now, updatedAt: now });
		await appendRecordHistory(ctx, { entityType: 'customer', entityId: id, actor: admin.email, kind: 'created', after: profile });
		return id;
	}
});

function expectRevision(customer: Doc<'customers'>, expectedRevision: number | undefined) {
	// Optional only for existing API callers. The production editor always sends its loaded revision.
	if (expectedRevision !== undefined && expectedRevision !== (customer.revision ?? 0)) throw new ConvexError('This customer changed. Go back and reopen the profile before saving.');
}

/**
 * Edits the profile. Paid receipts keep the details they were issued with (orders.customerSnapshot).
 * The customer revision changes without traversing orders. Settlement checks the exact revision
 * reviewed by the cashier, so unseen profile edits require renewed review.
 */
export const updateCustomer = mutation({
	args: { customerId: v.id('customers'), expectedRevision: v.optional(v.number()), ...customerInput },
	handler: async (ctx, { customerId, expectedRevision, ...input }) => {
		const admin = await requireAdmin(ctx);
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

export const setCustomerArchived = mutation({
	args: { customerId: v.id('customers'), archived: v.boolean(), expectedRevision: v.number() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
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

/** The shrinking source index is the durable work queue: no mutable-index cursor can skip a row. */
const MERGE_BATCH = 100;
const mergeInput = { sourceId: v.id('customers'), destinationId: v.id('customers'), sourceRevision: v.number(), destinationRevision: v.number(), reason: v.string(), idempotencyKey: v.string() };

async function moveMergeBatch(ctx: MutationCtx, jobId: Id<'customerMergeJobs'>) {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === 'completed') return;
    const source = await ctx.db.get(job.sourceId);
    const destination = await ctx.db.get(job.destinationId);
    if (!source || source.mergedInto !== job.destinationId || !destination || destination.mergedInto) throw new Error('Merge identities changed. Contact an administrator before resuming.');
    const orders = await ctx.db.query('orders').withIndex('by_customerId_and_updatedAt', q => q.eq('customerId', job.sourceId)).take(MERGE_BATCH + 1);
    for (const order of orders.slice(0, MERGE_BATCH)) {
        await ctx.db.patch(order._id, { customerId: job.destinationId, ...(order.status === 'draft' ? { revision: order.revision + 1 } : {}) });
        await appendRecordHistory(ctx, { entityType: 'order', entityId: order._id, actor: job.actor, kind: 'customer_merged', reason: job.reason, before: { customerId: job.sourceId }, after: { customerId: job.destinationId } });
    }
    const movedOrders = job.movedOrders + Math.min(orders.length, MERGE_BATCH);
    const completed = orders.length <= MERGE_BATCH;
    await ctx.db.patch(jobId, { movedOrders, status: completed ? 'completed' : 'running', updatedAt: Date.now(), ...(completed ? { completedAt: Date.now() } : {}) });
    if (completed) {
        for (const entityId of [job.sourceId, job.destinationId]) await appendRecordHistory(ctx, { entityType: 'customer', entityId, actor: job.actor, kind: 'merged', reason: job.reason, before: job.before, after: { sourceId: job.sourceId, destinationId: job.destinationId, movedOrders } });
    } else {
        await ctx.scheduler.runAfter(0, internal.customers.continueMerge, { jobId });
    }
}

/** Only the scheduler can invoke continuation; the job retains the authenticated initiating actor. */
export const continueMerge = internalMutation({
    args: { jobId: v.id('customerMergeJobs') },
    handler: async (ctx, { jobId }) => { await moveMergeBatch(ctx, jobId); return null; }
});

/** Admin recovery also advances one bounded batch, safely racing an already scheduled invocation. */
export const resumeCustomerMerge = mutation({
    args: { sourceId: v.id('customers') },
    handler: async (ctx, { sourceId }) => {
        await requireAdmin(ctx);
        const job = await ctx.db.query('customerMergeJobs').withIndex('by_sourceId', q => q.eq('sourceId', sourceId)).unique();
        if (!job) throw new ConvexError('No merge to resume');
        await moveMergeBatch(ctx, job._id);
        return null;
    }
});

export async function mergeCustomerRecords(ctx: MutationCtx, args: {
    sourceId: Id<'customers'>; destinationId: Id<'customers'>; sourceRevision: number; destinationRevision: number; reason: string; idempotencyKey: string;
}) {
    const admin = await requireAdmin(ctx);
    if (args.sourceId === args.destinationId) throw new ConvexError('Choose two different customers');
    const reason = args.reason.trim();
    if (!reason || reason.length > 1000) throw new ConvexError('Enter a merge reason (at most 1000 characters)');
    if (args.idempotencyKey.length < 8 || args.idempotencyKey.length > 100) throw new ConvexError('Invalid merge attempt');
    const source = await ctx.db.get(args.sourceId);
    const destination = await ctx.db.get(args.destinationId);
    if (!source || !destination) throw new ConvexError('Customer not found');
    if (source.mergedInto === destination._id && source.mergeKey === args.idempotencyKey) {
        if (source.mergeReason !== reason) throw new ConvexError('This merge attempt was already used with a different reason');
        // Replay never writes another start/completion event. Explicit resume can recover a failed scheduled run.
        return { replayed: true, destinationId: destination._id };
    }
    if (source.mergedInto || destination.mergedInto) throw new ConvexError('A selected customer has already been merged. Reopen both profiles.');
    if (destination.archivedAt) throw new ConvexError('Restore the kept customer before merging');
    expectRevision(source, args.sourceRevision);
    expectRevision(destination, args.destinationRevision);
    // A destination may accept concurrent merges, but cannot itself move until all inbound work ends.
    const incoming = await ctx.db.query('customerMergeJobs').withIndex('by_destinationId_and_status', q => q.eq('destinationId', source._id).eq('status', 'running')).first();
    if (incoming) throw new ConvexError('Finish the in-progress merge into this customer before moving it into another profile.');
    const now = Date.now();
    const before = { sourceId: source._id, destinationId: destination._id, source: customerValues(source), destination: customerValues(destination) };
    // Freeze before moving any references. Concurrent links/payment must observe this revision or conflict.
    await ctx.db.patch(source._id, { mergedInto: destination._id, mergeKey: args.idempotencyKey, mergeReason: reason, archivedAt: source.archivedAt ?? now, revision: (source.revision ?? 0) + 1, updatedAt: now });
    await ctx.db.patch(destination._id, { revision: (destination.revision ?? 0) + 1, updatedAt: now });
    const jobId = await ctx.db.insert('customerMergeJobs', { sourceId: source._id, destinationId: destination._id, reason, actor: admin.email, status: 'running', movedOrders: 0, before, createdAt: now, updatedAt: now });
    for (const entityId of [source._id, destination._id]) await appendRecordHistory(ctx, { entityType: 'customer', entityId, actor: admin.email, kind: 'merge_started', reason, before, after: { sourceId: source._id, destinationId: destination._id } });
    await moveMergeBatch(ctx, jobId);
    return { replayed: false, destinationId: destination._id };
}

export const mergeCustomers = mutation({ args: mergeInput, handler: mergeCustomerRecords });

/** Minimal identity card for the checkout picker; no notes, histories or unrelated orders. */
export const checkoutCustomer = query({ args: { customerId: v.id('customers') }, handler: async (ctx, args) => {
 await requireStaff(ctx, 'checkout');
 const customer = await ctx.db.get(args.customerId);
 return customer ? customerCard(customer) : null;
} });
