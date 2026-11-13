import type { Infer } from 'convex/values';
import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { syncAffiliateCredit } from '../../marketing/model';
import { appendBookingHistory } from '../../bookings/model';
import { syncOrderCouponRedemption } from '../../marketing/model';
import { orderLineLinks } from './lineLinks';
import { orderLines } from './orderLines';
import { MAX_QTY, MERGES_QTY, NOTE_MAX, assertDiscount, assertPrice, assertPriceOverride, roundMoney } from '../../lib/orderMath';
import { assertNoPosRefunds } from './orderRefunds';
import { changeSchedule } from '../../lib/serviceSchedule';
import { assertCashierDiscount, canReadCheckoutOrder, requireCashierAction, type StaffActor } from '../../auth/model';
import { ATTACHED_PRICE, CURRENCY, FEE_FIXED, Line, LineFields, addItemArgs, appointmentLine, assertBaht, assertRoom, attachArgs, attachTo, bookingLine, cleanText, editableLine, editableOrder, isSourceRow, lineSnapshot, logOrder, oneSource, overrideLinePriceArgs, refreshOrder, sourceIssue, sourceRows, updateLineArgs, updateSourceLineArgs, voidOrderArgs } from './orderModel';

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeAddItem(ctx: MutationCtx, args: Infer<typeof addItemArgs>, admin: StaffActor) {
 if (args.item.kind === 'extra') await requireCashierAction(ctx, admin, 'customPrice');
		const order = await editableOrder(ctx, args.orderId, admin.email);
		const { item } = args;
		let line: LineFields;
		if (item.kind === 'service') {
			const service = await ctx.db.get(item.serviceId);
			if (!service || service.status !== 'active') throw new ConvexError('This service is no longer offered');
			assertBaht(service.currency, service.name);
			// Not scheduled until staff set a date or time (lib/serviceSchedule.ts); never "now".
			line = { kind: 'service', serviceId: service._id, name: service.name, detail: `${service.durationMin} min`, unitPrice: service.price, currency: CURRENCY, qty: 1, schedule: {} };
		} else if (item.kind === 'room') {
			const property = await ctx.db.get(item.propertyId);
			if (!property || property.status !== 'active') throw new ConvexError('This villa is not available');
			assertBaht(property.currency, property.name);
			line = { kind: 'room', propertyId: property._id, name: property.name, detail: 'per night', unitPrice: property.pricePerNight, currency: CURRENCY, qty: 1 };
		} else {
			const name = cleanText(item.name, 'Item name', 80);
			if (!name) throw new ConvexError('Name the item');
			assertPrice(item.price);
			line = { kind: 'extra', name, unitPrice: roundMoney(item.price), currency: CURRENCY, qty: 1 };
		}

		// Nights and extras stack into one row unless that row has its own price or discount.
		if (MERGES_QTY[line.kind]) {
			const same = (await orderLines(ctx, order._id)).find((l) =>
				l.kind === line.kind && !l.fee && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
				(line.kind === 'room' ? l.propertyId === line.propertyId : l.name === line.name)
			);
			if (same && same.qty < MAX_QTY) {
				await ctx.db.patch(same._id, { qty: same.qty + 1 });
				await refreshOrder(ctx, order._id);
				await logOrder(ctx, order._id, admin.email, 'line_updated', { before: lineSnapshot(same), after: lineSnapshot({ ...same, qty: same.qty + 1 }) });
				return { orderId: order._id, lineId: same._id };
			}
		}
		await assertRoom(ctx, order._id);
		const lineId = await ctx.db.insert('orderLines', { orderId: order._id, ...line, catalogUnitPrice: line.catalogUnitPrice ?? line.unitPrice, createdAt: Date.now() });
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'line_added', { after: { ...lineSnapshot(line), lineId } });
		return { orderId: order._id, lineId };
}

export async function executeAttach(ctx: MutationCtx, args: Infer<typeof attachArgs>, admin: StaffActor) {
 const source = oneSource(args);
 const order = await editableOrder(ctx, args.orderId, admin.email);
 await attachTo(ctx, order, source, admin);
 return { orderId: order._id };
}

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeUpdateLine(ctx: MutationCtx, args: Infer<typeof updateLineArgs>, admin: StaffActor) {
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (line.fee && (args.qtyChange !== undefined || args.discount)) throw new ConvexError(FEE_FIXED);
		const patch: Partial<Line> = {};
		if (args.staffId !== undefined) {
			if (line.kind !== 'service') throw new ConvexError('Only service rows take a therapist here');
			if (args.staffId) {
				const service = line.serviceId ? await ctx.db.get(line.serviceId) : null;
				const person = await ctx.db.get(args.staffId);
				if (!person || person.status !== 'active') throw new ConvexError('Staff member not found');
				if (!service?.staffIds.includes(args.staffId)) throw new ConvexError(`${person.name} doesn't offer this service`);
			}
			patch.staffId = args.staffId ?? undefined;
		}
		const scheduling = args.serviceDate !== undefined || args.serviceTime !== undefined;
		if (scheduling) {
			if (line.kind !== 'service') throw new ConvexError('Only service rows take a date and time here');
			const current = line.schedule ?? {};
			const next = changeSchedule(current, { date: args.serviceDate, time: args.serviceTime });
			if ('problem' in next) throw new ConvexError(next.problem);
			patch.schedule = next.schedule;
			patch.startAt = undefined;
		}
		if (args.qtyChange !== undefined) {
			if (!MERGES_QTY[line.kind]) throw new ConvexError('Add another row instead: each service is its own row');
			if (!Number.isInteger(args.qtyChange) || Math.abs(args.qtyChange) > MAX_QTY) throw new ConvexError('Invalid quantity change');
			patch.qty = Math.min(Math.max(line.qty + args.qtyChange, 1), MAX_QTY);
		}
		if (args.discount !== undefined) {
			if (line.kind === 'booking' && args.discount) throw new ConvexError(ATTACHED_PRICE);
			if (args.discount) assertDiscount(args.discount);
			patch.discount = args.discount && args.discount.value > 0 ? args.discount : undefined;
		}
		if (args.discount !== undefined || args.qtyChange !== undefined) await assertCashierDiscount(ctx, admin, { ...line, ...patch });
		await ctx.db.patch(line._id, patch);
		await refreshOrder(ctx, order._id);
		const before = lineSnapshot(line);
		const after = lineSnapshot({ ...line, ...patch });
		if (JSON.stringify(before) !== JSON.stringify(after)) await logOrder(ctx, order._id, admin.email, 'line_updated', { before, after });
}

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeOverrideLinePrice(ctx: MutationCtx, args: Infer<typeof overrideLinePriceArgs>, admin: StaffActor) {
 await requireCashierAction(ctx, admin, 'customPrice');
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (line.kind === 'booking' && args.price !== null) throw new ConvexError(ATTACHED_PRICE);
		if (line.fee && args.price !== null) throw new ConvexError(FEE_FIXED);
		await assertCashierDiscount(ctx, admin, { ...line, priceOverride: args.price === null ? undefined : { price: roundMoney(args.price) } });
		const fromPrice = line.priceOverride?.price ?? line.unitPrice;
		let note: string | undefined;
		if (args.price === null) {
			if (!line.priceOverride) return;
			note = cleanText(args.note, 'Note', NOTE_MAX);
			await ctx.db.patch(line._id, { priceOverride: undefined });
		} else {
			note = assertPriceOverride(args.price, args.note);
			await ctx.db.patch(line._id, { priceOverride: { price: roundMoney(args.price), note, by: admin.email, at: Date.now() } });
		}
		await ctx.db.insert('orderAudit', {
			orderId: order._id, lineId: line._id, at: Date.now(), actor: admin.email, kind: 'price_override',
			fromPrice, toPrice: args.price === null ? line.unitPrice : roundMoney(args.price), note
		});
		await refreshOrder(ctx, order._id);
}

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeUpdateSourceLine(ctx: MutationCtx, args: Infer<typeof updateSourceLineArgs>, admin: StaffActor) {
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (!isSourceRow(line)) throw new ConvexError('Only booking, appointment and fee rows follow their source');
		const issue = await sourceIssue(ctx, line);
		if (!issue) return { result: 'current' as const };
		if (issue.kind === 'online') throw new ConvexError(issue.message);
		// A fee row is never "updated": its appointment either still takes the fee or the row goes.
		if (line.fee && issue.kind === 'changed') return { result: 'current' as const };
		const at = Date.now();
		if (issue.kind === 'settled' || issue.kind === 'gone') {
			await ctx.db.delete(line._id);
			await ctx.db.insert('orderAudit', { orderId: order._id, lineId: line._id, at, actor: admin.email, kind: 'source_removed', fromPrice: line.unitPrice, note: `${line.name}: ${issue.message}` });
			await refreshOrder(ctx, order._id);
			return { result: 'removed' as const };
		}
		let fresh: LineFields;
		if (line.bookingId) {
			const booking = (await ctx.db.get(line.bookingId))!;
			assertBaht(booking.currency, 'This booking');
			fresh = await bookingLine(ctx, booking);
		} else {
			const appointment = (await ctx.db.get(line.appointmentId!))!;
			assertBaht(appointment.currency, 'This appointment');
			fresh = await appointmentLine(ctx, appointment);
		}
		if (fresh.unitPrice !== line.unitPrice) await requireCashierAction(ctx, admin, 'customPrice');
		await assertCashierDiscount(ctx, admin, { ...line, ...fresh });
		// A deposit that is gone (e.g. a refunded online payment) is cleared, not kept from the old row.
		await ctx.db.patch(line._id, { ...fresh, deposit: fresh.deposit });
		await ctx.db.insert('orderAudit', { orderId: order._id, lineId: line._id, at, actor: admin.email, kind: 'source_updated', fromPrice: line.unitPrice, toPrice: fresh.unitPrice, note: fresh.detail });
		await refreshOrder(ctx, order._id);
		return { result: 'updated' as const };
}

/** Shared by the direct mutation and atomic manager approval. Actor is never client supplied. */
export async function executeVoidOrder(ctx: MutationCtx, args: Infer<typeof voidOrderArgs>, admin: StaffActor) {
 await requireCashierAction(ctx, admin, 'voidPaidSale');
		const reason = cleanText(args.reason, 'Reason', NOTE_MAX);
		if (!reason) throw new ConvexError('Give a reason for the void');
		const order = await ctx.db.get(args.orderId);
		if (!order || !canReadCheckoutOrder(admin, order)) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order can be voided');
		await assertNoPosRefunds(ctx, order._id);
		const now = Date.now();
		await syncOrderCouponRedemption(ctx, order._id, 'reversed');
		await ctx.db.patch(order._id, { status: 'void', voidedAt: now, voidedBy: admin.email, voidReason: reason, updatedAt: now });
		await syncAffiliateCredit(ctx, {orderId: order._id}, admin.email);
		await ctx.db.insert('orderAudit', { orderId: order._id, at: now, actor: admin.email, kind: 'void', note: reason });
		// Stays charged at checkout or linked later; their payments are kept.
		const stays = [...(await sourceRows(ctx, order._id)), ...(await orderLineLinks(ctx, order._id, 'active'))].flatMap((row) => (row.bookingId ? [row.bookingId] : []));
		for (const bookingId of new Set(stays)) {
			if (await ctx.db.get(bookingId)) {
				await appendBookingHistory(ctx, bookingId, {
					actor: admin.email, kind: 'order_voided', reason,
					after: { orderId: order._id, receiptNumber: order.receiptNumber ?? null, paymentKept: true }
				});
			}
		}
}
