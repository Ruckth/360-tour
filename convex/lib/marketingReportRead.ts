import { ConvexError } from 'convex/values';
import type { Doc, Id, TableNames } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { round2, orderTitle } from './billMath';
import { stayMoney, unitemisedStayMoney } from './bookingMoney';
import { ATTRIBUTION_MODEL, touchFromLink } from './marketingAttribution';
import { MAX_REPORT_DAYS, reportDayCount, reportRangeBounds, type ReportBasis, type ReportData, type ReportMoneyEvent, type ReportSale, type ReportTouch } from './marketingReport';
import { orderPaymentRecord } from './orderLifecycle';
import { ReadBudget, ReadBudgetExceeded } from './readBudget';
import { resortLocalParts } from './serviceSlots';

export const reportSpend = (row: Doc<'marketingSpend'>) => ({ id: row._id, campaignId: row.campaignId, amount: row.amount, from: row.from, to: row.to, ...(row.note !== undefined ? { note: row.note } : {}) });
const dayOf = (at: number) => resortLocalParts(at).date;
const touch = ({ linkId, campaignId, slug, campaignName, source, medium, entry }: ReportTouch): ReportTouch => ({ linkId, campaignId, slug, campaignName, source, medium, entry });

/** Injectable budget for convex-test; every database read in this report passes through it. */
export async function readMarketingReport(ctx: QueryCtx, args: { from: string; to: string; basis: ReportBasis }, budget = new ReadBudget()): Promise<ReportData> {
	const days = reportDayCount(args.from, args.to);
	if (days === null || days > MAX_REPORT_DAYS) throw new ConvexError('Choose a valid range of at most 92 Bangkok days.');
	const { from, to, basis } = args;
	const { start, end } = reportRangeBounds(from, to);
	const data: ReportData = { asOf: Date.now(), ...args, timeZone: 'Asia/Bangkok', currency: 'THB', model: ATTRIBUTION_MODEL, sales: [], events: [], sessions: [], campaigns: [], links: [], coupons: [], properties: [], spend: [], excluded: { nonThb: 0 }, truncated: false };
	const inRange = (day: string) => day >= from && day <= to;
	const cache = new Map<string, unknown>();
	async function get<T extends TableNames>(id: Id<T>): Promise<Doc<T> | null> {
		if (cache.has(id)) return cache.get(id) as Doc<T> | null;
		if (!budget.range()) throw new ReadBudgetExceeded();
		const row = await ctx.db.get(id);
		if (row && !budget.document(row)) throw new ReadBudgetExceeded();
		cache.set(id, row);
		return row;
	}
	async function* scan<T>(range: AsyncIterable<T>): AsyncGenerator<T> {
		if (!budget.range()) throw new ReadBudgetExceeded();
		for await (const row of range) {
			if (!budget.document(row)) throw new ReadBudgetExceeded();
			yield row;
		}
	}
	async function rows<T>(range: AsyncIterable<T>): Promise<T[]> {
		const result: T[] = [];
		for await (const row of scan(range)) append(result, row);
		return result;
	}
	// Leave headroom under Convex's maximum array size, even for small rollup documents.
	function append<T>(target: T[], ...items: T[]) {
		if (target.length + items.length > 8000) throw new ReadBudgetExceeded();
		target.push(...items);
	}
	const excluded = new Set<string>();
	const nonThb = (row: { _id: string; currency: string }) => {
		if (row.currency === 'THB') return false;
		excluded.add(row._id);
		data.excluded.nonThb = excluded.size;
		return true;
	};
	const completed = new Map<string, ReportSale | null>();
	function include(sale: ReportSale, events: ReportMoneyEvent[]) {
		const selected = events.filter(e => inRange(e.day));
		if (basis === 'cash' ? selected.length > 0 : inRange(sale.createdDay)) {
			if (data.sales.length >= 8000 || (basis === 'cash' && data.events.length + selected.length > 8000)) throw new ReadBudgetExceeded();
			data.sales.push(sale);
			if (basis === 'cash') data.events.push(...selected);
		}
		completed.set(sale.id, sale);
		return sale;
	}
	async function coupon(promotion: { couponId: Id<'coupons'>; code: string } | undefined) {
		if (!promotion) return undefined;
		const row = await get(promotion.couponId);
		return { couponId: promotion.couponId, code: promotion.code, ...(row?.campaignId ? { campaignId: row.campaignId } : {}) };
	}
	async function stay(id: Id<'bookings'>) {
		if (completed.has(id)) return completed.get(id);
		const booking = await get(id);
		completed.set(id, null);
		if (!booking || nonThb(booking)) return null;
		const payments = await rows(ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)));
		const refunds = await rows(ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)));
		const recorded = payments.filter(p => p.status === 'recorded');
		const money = stayMoney(booking);
		const legacy = unitemisedStayMoney(money.gross, payments);
		if (!recorded.length && legacy <= 0) return null;
		const dates = recorded.map(p => p.effectiveAt);
		if (legacy > 0 && booking.paidAt !== undefined) dates.push(booking.paidAt);
		const paidDay = dates.length ? dayOf(Math.min(...dates)) : undefined;
		const channel: ReportSale['channel'] = booking.source === 'admin' ? 'admin' : booking.source && booking.source !== 'web' ? 'messaging' : booking.chatSessionId ? 'web_chat' : 'web';
		const attribution = booking.marketingAttribution;
		const tracked = (channel === 'web' || channel === 'web_chat') && attribution?.last;
		const sale: ReportSale = {
			kind: 'stay', id, label: booking.guestName, ...(booking.confirmationCode ? { ref: booking.confirmationCode } : {}), propertyId: booking.propertyId,
			channel, bucket: channel === 'admin' ? 'staff' : channel === 'messaging' ? 'messaging' : tracked ? 'tracked' : 'unknown',
			...(tracked ? { evidence: attribution.evidence, last: touch(tracked), ...(attribution.evidence === 'tracked' && attribution.first ? { first: touch(attribution.first) } : {}) } : {}),
			coupon: await coupon(booking.promotion), createdDay: dayOf(booking.createdAt), paidDay, paid: true,
			collected: round2(recorded.reduce((sum, p) => sum + p.amount, 0) + legacy),
			refunded: money.legacyRefund ? money.refunded : round2(refunds.reduce((sum, r) => sum + r.amount, 0)), discount: booking.promotion?.discount ?? 0
		};
		const events: ReportMoneyEvent[] = recorded.map(p => ({ saleId: id, kind: 'payment', day: dayOf(p.effectiveAt), amount: p.amount }));
		events.push(...refunds.map(r => ({ saleId: id, kind: 'refund' as const, day: dayOf(r.effectiveAt), amount: r.amount })));
		if (legacy > 0 && booking.paidAt !== undefined) events.push({ saleId: id, kind: 'payment', day: dayOf(booking.paidAt), amount: legacy });
		if (money.legacyRefund && !refunds.length && booking.refundedAt !== undefined) events.push({ saleId: id, kind: 'refund', day: dayOf(booking.refundedAt), amount: money.refunded });
		return include(sale, events);
	}
	async function order(id: Id<'bills'>) {
		if (completed.has(id)) return completed.get(id);
		const bill = await get(id);
		completed.set(id, null);
		if (!bill || !['paid', 'void'].includes(bill.status) || bill.voidUnreceived || nonThb(bill)) return null;
		const tenders = await rows(ctx.db.query('billPayments').withIndex('by_billId', q => q.eq('billId', id)));
		const stayPayments = await rows(ctx.db.query('bookingPayments').withIndex('by_billId', q => q.eq('billId', id)));
		const refunds = await rows(ctx.db.query('appointmentRefunds').withIndex('by_billId', q => q.eq('billId', id)));
		const record = orderPaymentRecord(bill, tenders);
		if (record.effectiveAt === null) return null;
		const collected = round2(record.tenders.reduce((sum, p) => sum + p.amount, 0) - stayPayments.filter(p => p.status === 'recorded' && p.origin === 'pos').reduce((sum, p) => sum + p.amount, 0));
		const refunded = round2(refunds.reduce((sum, r) => sum + r.amount, 0));
		const discount = bill.promotion?.discount ?? 0;
		if (collected === 0 && refunded === 0 && discount === 0) return null;
		const booking = bill.bookingId ? await get(bill.bookingId) : null;
		const link = bill.promotion?.viaLinkId ? await get(bill.promotion.viaLinkId) : null;
		const campaign = link ? await get(link.campaignId) : null;
		const day = dayOf(record.effectiveAt);
		const sale: ReportSale = { kind: 'order', id, label: record.customer?.name ?? 'Walk-in', ref: orderTitle(bill.orderNumber), ...(booking ? { propertyId: booking.propertyId } : {}), channel: 'pos', bucket: link && campaign ? 'tracked' : 'staff', ...(link && campaign ? { evidence: 'scanned', last: touch(touchFromLink(link, campaign)) } : {}), coupon: await coupon(bill.promotion), createdDay: day, paidDay: day, paid: true, collected, refunded, discount };
		const events: ReportMoneyEvent[] = collected ? [{ saleId: id, kind: 'payment', day, amount: collected }] : [];
		events.push(...refunds.map(r => ({ saleId: id, kind: 'refund' as const, day: dayOf(r.effectiveAt), amount: r.amount })));
		return include(sale, events);
	}
	async function appointment(id: Id<'serviceAppointments'>) {
		if (completed.has(id)) return completed.get(id);
		const appt = await get(id);
		completed.set(id, null);
		if (!appt || appt.bookingId || nonThb(appt)) return null;
		const payments = (await rows(ctx.db.query('appointmentPayments').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', id)))).filter(p => p.status === 'recorded');
		if (!payments.length) return null;
		const refunds = await rows(ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', id)));
		const ownRefunds = [];
		for (const refund of refunds) if (!refund.billId || !await order(refund.billId)) ownRefunds.push(refund);
		const service = appt.serviceNameSnapshot ? null : await get(appt.serviceId);
		const day = dayOf(Math.min(...payments.map(p => p.effectiveAt)));
		const sale: ReportSale = { kind: 'appointment', id, label: appt.guestName, ref: appt.serviceNameSnapshot ?? service?.name, channel: 'desk', bucket: 'staff', createdDay: day, paidDay: day, paid: true, collected: round2(payments.reduce((sum, p) => sum + p.amount, 0)), refunded: round2(ownRefunds.reduce((sum, r) => sum + r.amount, 0)), discount: 0 };
		return include(sale, [...payments.map(p => ({ saleId: id, kind: 'payment' as const, day: dayOf(p.effectiveAt), amount: p.amount })), ...ownRefunds.map(r => ({ saleId: id, kind: 'refund' as const, day: dayOf(r.effectiveAt), amount: r.amount }))]);
	}
	try {
		if (basis === 'cohort') {
			for await (const row of scan(ctx.db.query('bookings').withIndex('by_createdAt', q => q.gte('createdAt', start).lt('createdAt', end)))) { cache.set(row._id, row); await stay(row._id); }
		} else {
			for await (const row of scan(ctx.db.query('bookingPayments').withIndex('by_effectiveAt', q => q.gte('effectiveAt', start).lt('effectiveAt', end)))) if (row.status === 'recorded') await stay(row.bookingId);
			for await (const row of scan(ctx.db.query('bookingRefunds').withIndex('by_effectiveAt', q => q.gte('effectiveAt', start).lt('effectiveAt', end)))) await stay(row.bookingId);
			// Older money has no payment/refund row. Its business dates are on the stay.
			for await (const row of scan(ctx.db.query('bookings').withIndex('by_paidAt', q => q.gte('paidAt', start).lt('paidAt', end)))) { cache.set(row._id, row); await stay(row._id); }
			for await (const row of scan(ctx.db.query('bookings').withIndex('by_refundedAt', q => q.gte('refundedAt', start).lt('refundedAt', end)))) { cache.set(row._id, row); await stay(row._id); }
		}
		for (const status of ['paid', 'void'] as const) {
			for await (const row of scan(ctx.db.query('bills').withIndex('by_status_and_paidAt', q => q.eq('status', status).gte('paidAt', start).lt('paidAt', end)))) { cache.set(row._id, row); await order(row._id); }
		}
		for await (const row of scan(ctx.db.query('bills').withIndex('by_paymentEffectiveAt', q => q.gte('paymentEffectiveAt', start).lt('paymentEffectiveAt', end)))) { cache.set(row._id, row); await order(row._id); }
		for await (const row of scan(ctx.db.query('appointmentPayments').withIndex('by_effectiveAt', q => q.gte('effectiveAt', start).lt('effectiveAt', end)))) if (row.status === 'recorded') await appointment(row.appointmentId);
		if (basis === 'cash') for await (const row of scan(ctx.db.query('appointmentRefunds').withIndex('by_effectiveAt', q => q.gte('effectiveAt', start).lt('effectiveAt', end)))) {
			if (!row.billId || !await order(row.billId)) await appointment(row.appointmentId);
		}
		for (let at = start; at < end; at += 86_400_000) {
			const day = dayOf(at);
			for await (const row of scan(ctx.db.query('marketingSessionDays').withIndex('by_day_and_linkId', q => q.eq('day', day)))) append(data.sessions, { day, linkId: row.linkId, campaignId: row.campaignId, count: row.count });
		}
		for await (const row of scan(ctx.db.query('marketingSpend').withIndex('by_to', q => q.gte('to', from)))) if (row.deletedAt === undefined && row.from <= to) append(data.spend, reportSpend(row));
		const linkIds = new Set([...data.sessions.flatMap(s => s.linkId ? [s.linkId] : []), ...data.sales.flatMap(s => [s.last?.linkId, s.first?.linkId].filter((id): id is Id<'marketingLinks'> => !!id))]);
		const couponIds = new Set(data.sales.flatMap(s => s.coupon ? [s.coupon.couponId] : []));
		const campaignIds = new Set([...data.spend.map(s => s.campaignId), ...data.sessions.flatMap(s => s.campaignId ? [s.campaignId] : []), ...data.sales.flatMap(s => [s.last?.campaignId, s.first?.campaignId, s.coupon?.campaignId].filter((id): id is Id<'marketingCampaigns'> => !!id))]);
		const seenLinks = new Set<Id<'marketingLinks'>>();
		const addLink = (row: Doc<'marketingLinks'>) => {
			if (seenLinks.has(row._id)) return;
			seenLinks.add(row._id);
			append(data.links, { id: row._id, slug: row.slug, name: row.name, campaignId: row.campaignId, entry: row.entry, status: row.status });
			campaignIds.add(row.campaignId);
			if (row.couponId) couponIds.add(row.couponId);
		};
		for (const status of ['draft', 'active', 'paused'] as const) for await (const row of scan(ctx.db.query('marketingLinks').withIndex('by_status', q => q.eq('status', status)))) addLink(row);
		for (const id of linkIds) if (!seenLinks.has(id)) { const row = await get(id); if (row) addLink(row); }
		const seenCoupons = new Set<Id<'coupons'>>();
		const addCoupon = (row: Doc<'coupons'>) => {
			if (seenCoupons.has(row._id)) return;
			seenCoupons.add(row._id);
			append(data.coupons, { id: row._id, code: row.code, campaignId: row.campaignId, status: row.status });
			if (row.campaignId) campaignIds.add(row.campaignId);
		};
		for (const status of ['draft', 'active', 'paused'] as const) for await (const row of scan(ctx.db.query('coupons').withIndex('by_status', q => q.eq('status', status)))) addCoupon(row);
		for (const id of couponIds) if (!seenCoupons.has(id)) { const row = await get(id); if (row) addCoupon(row); }
		const seenCampaigns = new Set<Id<'marketingCampaigns'>>();
		const addCampaign = (row: Doc<'marketingCampaigns'>) => {
			if (seenCampaigns.has(row._id)) return;
			seenCampaigns.add(row._id);
			append(data.campaigns, { id: row._id, name: row.name, source: row.source, medium: row.medium, status: row.status, budget: row.budget });
		};
		for (const status of ['draft', 'active', 'paused', 'ended'] as const) for await (const row of scan(ctx.db.query('marketingCampaigns').withIndex('by_status', q => q.eq('status', status)))) addCampaign(row);
		for (const id of campaignIds) if (!seenCampaigns.has(id)) { const row = await get(id); if (row) addCampaign(row); }
		for await (const row of scan(ctx.db.query('properties'))) append(data.properties, { id: row._id, name: row.name });
	} catch (error) {
		if (!(error instanceof ReadBudgetExceeded)) throw error;
		data.truncated = true;
	}
	return data;
}
