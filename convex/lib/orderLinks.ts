import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { orderTitle } from './billMath';

/**
 * How orders relate to bookings and appointments (the "sources" they charge).
 *
 * - An order may be linked to one stay (`bills.bookingId`) or one standalone appointment
 *   (`bills.appointmentId`): opening that booking at checkout reuses its open order.
 * - Each charged stay or appointment is also a line with its own `bookingId`/`appointmentId`,
 *   so an order can carry a stay plus its appointments and extras. A source is charged on at
 *   most one open order at a time.
 * - Paid and void orders are history and never change.
 */

type ReadCtx = QueryCtx | MutationCtx;
export type OrderSource = { bookingId: Id<'bookings'> } | { appointmentId: Id<'serviceAppointments'> };

export const isOpenOrder = (order: Pick<Doc<'bills'>, 'status'>) => order.status === 'draft' || order.status === 'held';

/** Open orders are listed as unpaid; `held` is the legacy spelling of draft. */
export function orderState(order: Pick<Doc<'bills'>, 'status'>): 'unpaid' | 'paid' | 'void' {
	return isOpenOrder(order) ? 'unpaid' : order.status === 'paid' ? 'paid' : 'void';
}

const SOURCE_SCAN = 20;

/** Running numbers in billCounters: "order" and "receipt". */
export const ORDER_COUNTER = 'order';
export const RECEIPT_COUNTER = 'receipt';

/** Next number for the key, written in the caller's transaction so two orders can't share one. */
export async function nextCounter(ctx: MutationCtx, key: string) {
	const row = await ctx.db.query('billCounters').withIndex('by_key', (q) => q.eq('key', key)).unique();
	const value = (row?.value ?? 0) + 1;
	if (row) await ctx.db.patch(row._id, { value });
	else await ctx.db.insert('billCounters', { key, value });
	return value;
}

function sourceLines(ctx: ReadCtx, source: OrderSource) {
	return 'bookingId' in source
		? ctx.db.query('billLines').withIndex('by_bookingId', (q) => q.eq('bookingId', source.bookingId)).order('desc')
		: ctx.db.query('billLines').withIndex('by_appointmentId', (q) => q.eq('appointmentId', source.appointmentId)).order('desc');
}

function linkedWithStatus(ctx: ReadCtx, source: OrderSource, status: Doc<'bills'>['status']) {
	return 'bookingId' in source
		? ctx.db.query('bills').withIndex('by_bookingId_and_status', (q) => q.eq('bookingId', source.bookingId).eq('status', status)).order('desc')
		: ctx.db.query('bills').withIndex('by_appointmentId_and_status', (q) => q.eq('appointmentId', source.appointmentId).eq('status', status)).order('desc');
}

/** A source charged on more rows than this (paid history included) is refused rather than half-checked. */
const MAX_SOURCE_LINES = 500;

/**
 * The open order (other than `exceptOrderId`) that charges this source on one of its lines.
 * Every row for the source is checked (up to MAX_SOURCE_LINES), so an open legacy order behind
 * newer paid or void history is still found and the source is never charged twice.
 */
export async function openOrderCharging(ctx: ReadCtx, source: OrderSource, exceptOrderId?: Id<'bills'>) {
	const seen = new Set<Id<'bills'>>();
	let count = 0;
	for await (const line of sourceLines(ctx, source)) {
		if (++count > MAX_SOURCE_LINES) throw new Error('This booking has too much order history to check. Contact support.');
		if (line.billId === exceptOrderId || seen.has(line.billId)) continue;
		seen.add(line.billId);
		const order = await ctx.db.get(line.billId);
		if (order && isOpenOrder(order)) return order;
	}
	return null;
}

/** The open order linked to this booking or standalone appointment, if any. */
export async function linkedOpenOrder(ctx: ReadCtx, source: OrderSource) {
	return (await linkedWithStatus(ctx, source, 'draft').first()) ?? (await linkedWithStatus(ctx, source, 'held').first());
}

/** Where checkout continues for this source: the open order charging it, else its linked open order. */
export async function activeOrderFor(ctx: ReadCtx, source: OrderSource) {
	return (await openOrderCharging(ctx, source)) ?? (await linkedOpenOrder(ctx, source));
}

/** Recent orders for a source, linked or charging it on a line, newest change first (bounded). */
export async function ordersForSource(ctx: ReadCtx, source: OrderSource, limit = 10) {
	const found = new Map<Id<'bills'>, Doc<'bills'>>();
	for (const status of ['draft', 'held', 'paid', 'void'] as const) {
		for (const order of await linkedWithStatus(ctx, source, status).take(limit)) found.set(order._id, order);
	}
	for (const line of await sourceLines(ctx, source).take(SOURCE_SCAN)) {
		if (found.has(line.billId)) continue;
		const order = await ctx.db.get(line.billId);
		if (order) found.set(order._id, order);
	}
	return [...found.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

type OrderLinks = Partial<Pick<Doc<'bills'>, 'bookingId' | 'appointmentId' | 'parentOrderId' | 'customerId'>>;

/** A new unpaid order with its permanent number. */
export async function insertOrder(ctx: MutationCtx, actor: string, links: OrderLinks = {}): Promise<Doc<'bills'>> {
	const now = Date.now();
	const orderNumber = await nextCounter(ctx, ORDER_COUNTER);
	const set = Object.fromEntries(Object.entries(links).filter(([, value]) => value !== undefined)) as OrderLinks;
	const id = await ctx.db.insert('bills', {
		status: 'draft', orderNumber, currency: 'THB', itemCount: 0, total: 0, due: 0, hasItems: false, revision: 0,
		createdBy: actor, createdAt: now, updatedAt: now, ...set
	});
	return (await ctx.db.get(id))!;
}

/**
 * Gives a new booking (or an appointment that is not part of a stay) its order when it is
 * created, from any channel. The order starts empty: nothing is charged until staff open it at
 * checkout, so a stay paid online never sits as an unpaid charge. An appointment for a stay uses
 * the stay's order.
 */
export async function ensureLinkedOrder(ctx: MutationCtx, source: OrderSource, actor: string) {
	return (await activeOrderFor(ctx, source)) ?? (await insertOrder(ctx, actor, source));
}

/** An order nobody has used: created with its booking, still empty, never paid or audited. */
async function isPlaceholder(ctx: ReadCtx, order: Doc<'bills'>) {
	if (order.status !== 'draft' || order.hasItems || order.customerId || order.receiptNumber !== undefined) return false;
	const [line, payment, audit] = await Promise.all([
		ctx.db.query('billLines').withIndex('by_billId', (q) => q.eq('billId', order._id)).first(),
		ctx.db.query('billPayments').withIndex('by_billId', (q) => q.eq('billId', order._id)).first(),
		ctx.db.query('billAudit').withIndex('by_billId_and_at', (q) => q.eq('billId', order._id)).first()
	]);
	return !line && !payment && !audit;
}

/** Why a booking can't be deleted because of its orders, or null. Orders keep what they charged. */
export async function orderDeleteBlocker(ctx: ReadCtx, bookingId: Id<'bookings'>) {
	if (await sourceLines(ctx, { bookingId }).first()) return 'This booking has an order that charged it. Cancel it instead of deleting it.';
	for (const order of await ordersForSource(ctx, { bookingId })) {
		if (!(await isPlaceholder(ctx, order))) return 'This booking has an order. Cancel it instead of deleting it.';
	}
	return null;
}

/** Removes the empty order created with a booking that is being deleted (see orderDeleteBlocker). */
export async function deletePlaceholderOrders(ctx: MutationCtx, bookingId: Id<'bookings'>) {
	for (const order of await ordersForSource(ctx, { bookingId })) {
		if (await isPlaceholder(ctx, order)) await ctx.db.delete(order._id);
	}
}

/**
 * Refuses to record a payment for a source outside checkout while an open order is charging it,
 * so the same stay or appointment can't be paid twice.
 */
export async function assertNotOnOpenOrder(ctx: ReadCtx, source: OrderSource, what: string) {
	const order = await openOrderCharging(ctx, source);
	if (order) {
		throw new Error(`${what} is on ${orderTitle(order.orderNumber)}, which is still open. Take the payment on that order, or remove it from the order first.`);
	}
}
