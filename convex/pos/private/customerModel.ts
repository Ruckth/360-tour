import { ConvexError, v } from 'convex/values';
import { customerPhoneError } from '../../../src/lib/booking/phone';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { type MutationCtx } from '../../auth/model';
import { requireAdmin } from '../../lib/adminAuth';
import { appendRecordHistory } from '../../lib/recordHistory';
import { assertValidEmail } from '../../lib/validation';

/**
 * Reusable customer profiles for orders (admin only). An order links to a customer by id;
 * customers are never created, matched or merged from a name, so namesakes stay distinct and a
 * booking's guest is not assumed to be the payer.
 */

export const SEARCH_LIMIT = 20;

export const NAME_MAX = 120;

export const PHONE_MAX = 40;

export const EMAIL_MAX = 200;

export const NOTES_MAX = 1000;

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

export const customerInput = {
	name: v.string(),
	phone: v.optional(v.string()),
	email: v.optional(v.string()),
	notes: v.optional(v.string())
};

export function text(value: string | undefined, label: string, max: number) {
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

export function pageSize(numItems: number) {
	if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new ConvexError('Page size must be 1–50');
}

export function customerValues(customer: { name: string; phone?: string; email?: string; notes?: string }) {
	return { name: customer.name, phone: customer.phone, email: customer.email, notes: customer.notes };
}

export function expectRevision(customer: Doc<'customers'>, expectedRevision: number | undefined) {
	// Optional only for existing API callers. The production editor always sends its loaded revision.
	if (expectedRevision !== undefined && expectedRevision !== (customer.revision ?? 0)) throw new ConvexError('This customer changed. Go back and reopen the profile before saving.');
}

/** The shrinking source index is the durable work queue: no mutable-index cursor can skip a row. */
export const MERGE_BATCH = 100;

export const mergeInput = { sourceId: v.id('customers'), destinationId: v.id('customers'), sourceRevision: v.number(), destinationRevision: v.number(), reason: v.string(), idempotencyKey: v.string() };

export async function moveMergeBatch(ctx: MutationCtx, jobId: Id<'customerMergeJobs'>) {
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
        await ctx.scheduler.runAfter(0, internal.pos.customers.continueMerge, { jobId });
    }
}

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
