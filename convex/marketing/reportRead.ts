import { ConvexError } from 'convex/values';
import type { Doc, Id, TableNames } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { MAX_REPORT_DAYS, reportDayCount, reportRangeBounds, type ReportBasis, type ReportData, type ReportMoneyEvent, type ReportSale, type ReportTouch } from '../lib/marketingReport';
import { orderPaymentRecord } from '../pos/model';
import { isSettledOrder } from '../pos/model';
import { orderTitle, roundMoney } from '../lib/orderMath';
import { ReadBudget, ReadBudgetExceeded } from '../lib/readBudget';
import { resortLocalParts } from '../shared/resortLocalParts';
import { stayMoney } from '../lib/stayMoney';
import { ATTRIBUTION_MODEL, touchFromLink } from '../shared/marketingAttribution';

export const reportSpend = (row: Doc<'marketingSpend'>) => ({ id: row._id, campaignId: row.campaignId, amount: row.amount, from: row.from, to: row.to, ...(row.note !== undefined ? { note: row.note } : {}) });

const dayOf = (at: number) => resortLocalParts(at).date;

const touch = ({ linkId, campaignId, slug, campaignName, source, medium, entry }: ReportTouch): ReportTouch => ({ linkId, campaignId, slug, campaignName, source, medium, entry });

const sum = <T>(rows: T[], amount: (row: T) => number) => roundMoney(rows.reduce((total, row) => total + amount(row), 0));

/**
 * Reads in this order so a busy range still answers: names, spend and sessions first; then the money
 * that can be read by date in one range each (receipt tenders, POS stay payments, receipt refunds);
 * then one pass over the sales. Records an archived link, coupon or campaign that a sale points at
 * from a small reserve budget, so they still have names when the main budget ran out.
 * Budgets are injectable for convex-test; every database read passes through one.
 */
export async function readMarketingReport(
	ctx: QueryCtx,
	args: { from: string; to: string; basis: ReportBasis },
	budget = new ReadBudget(),
	reserve = new ReadBudget(2_000, 200, 2 * 1024 * 1024)
): Promise<ReportData> {
	const days = reportDayCount(args.from, args.to);
	if (days === null || days > MAX_REPORT_DAYS) throw new ConvexError('Choose a valid range of at most 92 Bangkok days.');
	const { from, to, basis } = args;
	const { start, end } = reportRangeBounds(from, to);
	const convertedSessions: NonNullable<ReportData['convertedSessions']> = [];
	const data: ReportData = { asOf: Date.now(), ...args, timeZone: 'Asia/Bangkok', currency: 'THB', model: ATTRIBUTION_MODEL, sales: [], events: [], sessions: [], convertedSessions, campaigns: [], links: [], coupons: [], properties: [], spend: [], excluded: { nonThb: 0 }, truncated: false };
	const inRange = (day: string) => day >= from && day <= to;
	const inWindow = (at: number | undefined) => at !== undefined && at >= start && at < end;
	let active = budget;
	const cache = new Map<string, unknown>();
	async function get<T extends TableNames>(id: Id<T>): Promise<Doc<T> | null> {
		if (cache.has(id)) return cache.get(id) as Doc<T> | null;
		if (!active.range()) throw new ReadBudgetExceeded();
		const row = await ctx.db.get(id);
		if (row && !active.document(row)) throw new ReadBudgetExceeded();
		cache.set(id, row);
		return row;
	}
	async function* scan<T>(range: AsyncIterable<T>): AsyncGenerator<T> {
		if (!active.range()) throw new ReadBudgetExceeded();
		for await (const row of range) {
			if (!active.document(row)) throw new ReadBudgetExceeded();
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
	function group<T, K>(items: T[], key: (item: T) => K | undefined) {
		const map = new Map<K, T[]>();
		for (const item of items) {
			const k = key(item);
			if (k === undefined) continue;
			const list = map.get(k);
			if (list) list.push(item);
			else map.set(k, [item]);
		}
		return map;
	}
	const excluded = new Set<string>();
	const nonThb = (row: { _id: string; currency: string }) => {
		if (row.currency === 'THB') return false;
		excluded.add(row._id);
		data.excluded.nonThb = excluded.size;
		return true;
	};

	// ------------------------------------------------------------ names, spend, sessions
	const seenLinks = new Set<Id<'marketingLinks'>>();
	const linkCoupons = new Set<Id<'coupons'>>();
	const addLink = (row: Doc<'marketingLinks'>) => {
		if (seenLinks.has(row._id)) return;
		seenLinks.add(row._id);
		if (row.couponId) linkCoupons.add(row.couponId);
		append(data.links, { id: row._id, slug: row.slug, name: row.name, campaignId: row.campaignId, entry: row.entry, status: row.status });
	};
	const seenCoupons = new Set<Id<'coupons'>>();
	const addCoupon = (row: Doc<'coupons'>) => {
		if (seenCoupons.has(row._id)) return;
		seenCoupons.add(row._id);
		append(data.coupons, { id: row._id, code: row.code, campaignId: row.campaignId, status: row.status });
	};
	const seenCampaigns = new Set<Id<'marketingCampaigns'>>();
	const addCampaign = (row: Doc<'marketingCampaigns'>) => {
		if (seenCampaigns.has(row._id)) return;
		seenCampaigns.add(row._id);
		append(data.campaigns, { id: row._id, name: row.name, source: row.source, medium: row.medium, status: row.status, budget: row.budget });
	};
	async function readNames() {
		for (const status of ['draft', 'active', 'paused', 'ended'] as const) for await (const row of scan(ctx.db.query('marketingCampaigns').withIndex('by_status', q => q.eq('status', status)))) addCampaign(row);
		for (const status of ['draft', 'active', 'paused'] as const) for await (const row of scan(ctx.db.query('marketingLinks').withIndex('by_status', q => q.eq('status', status)))) addLink(row);
		for (const status of ['draft', 'active', 'paused'] as const) for await (const row of scan(ctx.db.query('coupons').withIndex('by_status', q => q.eq('status', status)))) addCoupon(row);
		for await (const row of scan(ctx.db.query('properties'))) append(data.properties, { id: row._id, name: row.name });
		for await (const row of scan(ctx.db.query('marketingSpend').withIndex('by_to', q => q.gte('to', from)))) if (row.deletedAt === undefined && row.from <= to) append(data.spend, reportSpend(row));
		for (let at = start; at < end; at += 86_400_000) {
			const day = dayOf(at);
			for await (const row of scan(ctx.db.query('marketingSessionDays').withIndex('by_day_and_linkId_and_campaignId', q => q.eq('day', day)))) append(data.sessions, { day, linkId: row.linkId, campaignId: row.campaignId, count: row.count });
		}
	}

	// ------------------------------------------------------------ money read by date, one range each
	/** Receipt tenders are written with createdAt = the order's paidAt, so orders paid in the range need no per-order read. */
	let tendersByBill = new Map<Id<'orders'>, Doc<'orderPayments'>[]>();
	/** POS stay payments carry the order's business date (amendOrderPayment moves both together). */
	let stayRowsInRange: Doc<'bookingPayments'>[] = [];
	let stayPosByBill = new Map<Id<'orders'>, Doc<'bookingPayments'>[]>();
	/**
	 * Refunds typed in from the range start on (a day earlier, for clock skew), whatever date they carry.
	 * A date can't be in the future, so this holds every refund dated in the range, and every refund of
	 * an order paid in it: an order is paid before it is refunded. Only an order whose payment date was
	 * corrected later can have older refunds; order() reads those one by one.
	 */
	let posRefundsFromStart: Doc<'orderRefunds'>[] = [];
	let posRefundsByBill = new Map<Id<'orders'>, Doc<'orderRefunds'>[]>();
	let apptRefundsFromStart: Doc<'appointmentRefunds'>[] = [];
	let receiptRefundsByBill = new Map<Id<'orders'>, Doc<'appointmentRefunds'>[]>();
	let stayRefundsFromStart: Doc<'bookingRefunds'>[] = [];
	/** A stay refund against a receipt with no stay payment row returns an old order's stay money. */
	let oldOrderRefundsByBill = new Map<Id<'orders'>, Doc<'bookingRefunds'>[]>();
	async function readMoneyByDate() {
		posRefundsFromStart = await rows(ctx.db.query('orderRefunds').withIndex('by_businessDate', q => q.gte('businessDate', from)));
		posRefundsByBill = group(posRefundsFromStart, r => r.orderId);
		tendersByBill = group(await rows(ctx.db.query('orderPayments').withIndex('by_createdAt', q => q.gte('createdAt', start).lt('createdAt', end))), p => p.orderId);
		stayRowsInRange = await rows(ctx.db.query('bookingPayments').withIndex('by_effectiveAt', q => q.gte('effectiveAt', start).lt('effectiveAt', end)));
		stayPosByBill = group(stayRowsInRange.filter(p => p.origin === 'pos'), p => p.orderId);
		const recordedFrom = start - 86_400_000;
		apptRefundsFromStart = await rows(ctx.db.query('appointmentRefunds').withIndex('by_recordedAt', q => q.gte('recordedAt', recordedFrom)));
		receiptRefundsByBill = group(apptRefundsFromStart, r => r.orderId);
		stayRefundsFromStart = await rows(ctx.db.query('bookingRefunds').withIndex('by_recordedAt', q => q.gte('recordedAt', recordedFrom)));
		oldOrderRefundsByBill = group(stayRefundsFromStart.filter(r => !r.paymentId), r => r.orderId);
	}

	// ------------------------------------------------------------ sales
	const completed = new Map<string, ReportSale | null>();
	function include(sale: ReportSale, events: ReportMoneyEvent[]) {
		const selected = events.filter(e => inRange(e.day));
		const settledDiscount = sale.kind === 'order' && sale.discount > 0 && sale.settlementDay !== undefined && inRange(sale.settlementDay);
		if (basis === 'cash' ? selected.length > 0 || settledDiscount : inRange(sale.createdDay)) {
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
	async function staySession(booking: Doc<'bookings'>): Promise<ReportSale['session'] | undefined> {
		const attribution = booking.marketingAttribution;
		if ((booking.source && booking.source !== 'web') || attribution?.evidence !== 'tracked' || !attribution.sessionId) return undefined;
		const session = attribution.session ?? await get(attribution.sessionId);
		return session ? {
			id: attribution.sessionId, day: dayOf(session.startedAt),
			...(session.linkId ? { linkId: session.linkId } : {}),
			...(session.campaignId ? { campaignId: session.campaignId } : {})
		} : undefined;
	}
	const convertedIds = new Set<Id<'marketingSessions'>>();
	async function rememberConversion(booking: Doc<'bookings'>) {
		const session = await staySession(booking);
		if (!session || !inRange(session.day) || convertedIds.has(session.id)) return;
		append(convertedSessions, session);
		convertedIds.add(session.id);
	}
	async function stay(id: Id<'bookings'>) {
		if (completed.has(id)) return completed.get(id);
		const booking = await get(id);
		completed.set(id, null);
		if (!booking || nonThb(booking)) return null;
		const money = stayMoney(booking);
		// Nothing was ever received (an unpaid hold, or every payment cancelled): skip the ledger reads.
		if (money.gross <= 0) return null;
		const payments = await rows(ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)));
		const allRefunds = await rows(ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)));
		const recorded = payments.filter(p => p.status === 'recorded');
  if (recorded.some(payment => payment.amount > 0)) await rememberConversion(booking);
  const refunds = allRefunds;
  if (!recorded.length) return null;
  const dates = recorded.map(p => p.effectiveAt);
		const paidDay = dates.length ? dayOf(Math.min(...dates)) : undefined;
		const channel: ReportSale['channel'] = booking.source === 'admin' ? 'admin' : booking.source && booking.source !== 'web' ? 'messaging' : booking.chatSessionId ? 'web_chat' : 'web';
		const attribution = booking.marketingAttribution;
		const tracked = (channel === 'web' || channel === 'web_chat') && attribution?.last;
		const session = await staySession(booking);
		const sale: ReportSale = {
			kind: 'stay', id, label: booking.guestName, ...(booking.confirmationCode ? { ref: booking.confirmationCode } : {}), propertyId: booking.propertyId,
			channel, bucket: channel === 'admin' ? 'staff' : channel === 'messaging' ? 'messaging' : tracked ? 'tracked' : 'unknown',
			...(tracked ? { evidence: attribution.evidence, last: touch(tracked), ...(attribution.evidence === 'tracked' && attribution.first ? { first: touch(attribution.first) } : {}) } : {}),
			...(session ? { session } : {}),
			customPrice: !!booking.priceOverride,
			coupon: await coupon(booking.promotion), createdDay: dayOf(booking.createdAt), paidDay, paid: true,
			collected: sum(recorded, p => p.amount),
			refunded: sum(refunds, r => r.amount), discount: booking.priceOverride ? 0 : booking.promotion?.discount ?? 0
		};
		const events: ReportMoneyEvent[] = recorded.map(p => ({ saleId: id, kind: 'payment', day: dayOf(p.effectiveAt), amount: p.amount }));
		events.push(...refunds.map(r => ({ saleId: id, kind: 'refund' as const, day: dayOf(r.effectiveAt), amount: r.amount })));
		return include(sale, events);
	}
	async function order(id: Id<'orders'>) {
		if (completed.has(id)) return completed.get(id);
		const bill = await get(id);
		completed.set(id, null);
		if (!bill || !isSettledOrder(bill) || bill.voidUnreceived || nonThb(bill)) return null;
		const at = bill.paymentEffectiveAt ?? bill.paidAt;
		if (at === undefined) return null;
		// Outside the batched windows (a corrected or historical date) fall back to one read each.
		const tenders = bill.amendedTenders ? [] : inWindow(bill.paidAt) ? (tendersByBill.get(id) ?? []) : await rows(ctx.db.query('orderPayments').withIndex('by_orderId', q => q.eq('orderId', id)));
		const stayRows = inWindow(at) ? (stayPosByBill.get(id) ?? []) : await rows(ctx.db.query('bookingPayments').withIndex('by_orderId', q => q.eq('orderId', id)));
		const batched = at >= start && (bill.paymentEffectiveAt === undefined || bill.paymentEffectiveAt <= (bill.paidAt ?? at));
		const receiptRefunds = batched ? (receiptRefundsByBill.get(id) ?? []) : await rows(ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', id)));
		// An old order that kept its stay money (no stay payment row) also takes the refunds of that money.
		const stayRefunds = stayRows.length ? [] : batched ? (oldOrderRefundsByBill.get(id) ?? []) : (await rows(ctx.db.query('bookingRefunds').withIndex('by_orderId', q => q.eq('orderId', id)))).filter(r => !r.paymentId);
		const refunds = [...receiptRefunds, ...stayRefunds];
		const record = orderPaymentRecord(bill, tenders);
		// The stay part of the order is on the stay (its POS payment row), so the order keeps only its own money.
		const collected = roundMoney(sum(record.tenders, p => p.amount) - sum(stayRows.filter(p => p.status === 'recorded' && p.origin === 'pos'), p => p.amount));

		const posRefunds = batched ? (posRefundsByBill.get(id) ?? []) : await rows(ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', id)));
		const refunded = roundMoney(sum(refunds, r => r.amount) + sum(posRefunds, r => r.amount));
		const discount = bill.promotion?.discount ?? 0;
		if (collected === 0 && refunded === 0 && discount === 0) return null;
		// The order's own stay, or the stay it charged when that stay already had another open order.
		const bookingId = bill.bookingId ?? stayRows[0]?.bookingId;
		const booking = bookingId ? await get(bookingId) : null;
		const link = bill.promotion?.viaLinkId ? await get(bill.promotion.viaLinkId) : null;
		const campaign = link ? await get(link.campaignId) : null;
		const day = dayOf(at);
		const sale: ReportSale = { kind: 'order', id, label: record.customer?.name ?? 'Walk-in', ref: orderTitle(bill.orderNumber), ...(booking ? { propertyId: booking.propertyId } : {}), channel: 'pos', bucket: link && campaign ? 'tracked' : 'staff', ...(link && campaign ? { evidence: 'scanned', last: touch(touchFromLink(link, campaign)) } : {}), coupon: await coupon(bill.promotion), createdDay: day, ...(collected > 0 ? { paidDay: day } : {}), settlementDay: day, paid: true, collected, refunded, discount };
		const events: ReportMoneyEvent[] = collected ? [{ saleId: id, kind: 'payment', day, amount: collected }] : [];
		events.push(...refunds.map(r => ({ saleId: id, kind: 'refund' as const, day: dayOf(r.effectiveAt), amount: r.amount })));
		events.push(...posRefunds.map(r => ({ saleId: id, kind: 'refund' as const, day: r.businessDate, amount: r.amount })));
		return include(sale, events);
	}
	async function appointment(id: Id<'appointments'>) {
		if (completed.has(id)) return completed.get(id);
		const appt = await get(id);
		completed.set(id, null);
		if (!appt || nonThb(appt)) return null;

		const allPayments = await rows(ctx.db.query('appointmentPayments').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', id)));
		const payments: { amount: number; effectiveAt: number }[] = allPayments.filter(p => p.status === 'recorded');
  const refunds = await rows(ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', id)));
		if (!payments.length) return null;
		const ownRefunds = [];
		for (const refund of refunds) if (!refund.orderId || !await order(refund.orderId)) ownRefunds.push(refund);
		const service = appt.serviceNameSnapshot ? null : await get(appt.serviceId);
		// A stay's appointment paid at the desk is never part of the stay's money, so it is its own sale.
		const booking = appt.bookingId ? await get(appt.bookingId) : null;
		const day = dayOf(Math.min(...payments.map(p => p.effectiveAt)));
		const sale: ReportSale = { kind: 'appointment', id, label: appt.guestName, ref: appt.serviceNameSnapshot ?? service?.name, ...(booking ? { propertyId: booking.propertyId } : {}), channel: 'desk', bucket: 'staff', createdDay: day, paidDay: day, paid: true, collected: sum(payments, p => p.amount), refunded: sum(ownRefunds, r => r.amount), discount: 0 };
		return include(sale, [...payments.map(p => ({ saleId: id, kind: 'payment' as const, day: dayOf(p.effectiveAt), amount: p.amount })), ...ownRefunds.map(r => ({ saleId: id, kind: 'refund' as const, day: dayOf(r.effectiveAt), amount: r.amount }))]);
	}
	async function readSales() {
		if (basis === 'cash') for (const row of posRefundsFromStart) if (inRange(row.businessDate)) await order(row.orderId);
		if (basis === 'cohort') {
			for await (const row of scan(ctx.db.query('bookings').withIndex('by_createdAt', q => q.gte('createdAt', start).lt('createdAt', end)))) { cache.set(row._id, row); await stay(row._id); }
		} else {
			for (const row of stayRowsInRange) if (row.status === 'recorded') await stay(row.bookingId);
			for (const row of stayRefundsFromStart) {
				if (!inWindow(row.effectiveAt)) continue;
				await stay(row.bookingId);
				if (row.orderId && !row.paymentId) await order(row.orderId);
			}
			// Older money has no payment/refund row. Its business dates are on the stay.
			for await (const row of scan(ctx.db.query('bookings').withIndex('by_paidAt', q => q.gte('paidAt', start).lt('paidAt', end)))) { cache.set(row._id, row); await stay(row._id); }
			for await (const row of scan(ctx.db.query('bookings').withIndex('by_refundedAt', q => q.gte('refundedAt', start).lt('refundedAt', end)))) { cache.set(row._id, row); await stay(row._id); }
		}
		for (const status of ['paid', 'void'] as const) {
			for await (const row of scan(ctx.db.query('orders').withIndex('by_status_and_paidAt', q => q.eq('status', status).gte('paidAt', start).lt('paidAt', end)))) { cache.set(row._id, row); await order(row._id); }
		}
		for await (const row of scan(ctx.db.query('orders').withIndex('by_paymentEffectiveAt', q => q.gte('paymentEffectiveAt', start).lt('paymentEffectiveAt', end)))) { cache.set(row._id, row); await order(row._id); }
		for await (const row of scan(ctx.db.query('appointmentPayments').withIndex('by_effectiveAt', q => q.gte('effectiveAt', start).lt('effectiveAt', end)))) if (row.status === 'recorded') await appointment(row.appointmentId);
		if (basis === 'cash') for (const row of apptRefundsFromStart) {
			if (!inWindow(row.effectiveAt)) continue;
			if (!row.orderId || !await order(row.orderId)) await appointment(row.appointmentId);
		}
	}

	async function readConversions() {
		for await (const booking of scan(ctx.db.query('bookings').withIndex('by_marketingAttribution_session_startedAt_and_sessionId', q => q.gte('marketingAttribution.session.startedAt', start).lt('marketingAttribution.session.startedAt', end)))) {
			cache.set(booking._id, booking);
			await stay(booking._id);
		}

		for await (const booking of scan(ctx.db.query('bookings').withIndex('by_marketingAttribution_session_startedAt_and_sessionId', q => q.eq('marketingAttribution.session.startedAt', undefined).gt('marketingAttribution.sessionId', undefined)))) {
			const sessionId = booking.marketingAttribution?.sessionId;
			if (!sessionId || convertedIds.has(sessionId)) continue;
			const session = await get(sessionId);
			if (!session || !inWindow(session.startedAt)) continue;
			cache.set(booking._id, booking);
			await stay(booking._id);
		}
	}

	try {
		await readNames();
		await readMoneyByDate();
		await readSales();
		await readConversions();
	} catch (error) {
		if (!(error instanceof ReadBudgetExceeded)) throw error;
		data.truncated = true;
	}
	// Archived links, coupons and campaigns that a sale, a session or spend still points at.
	active = reserve;
	try {
		const linkIds = new Set([...data.sessions.flatMap(s => s.linkId ? [s.linkId] : []), ...convertedSessions.flatMap(s => s.linkId ? [s.linkId] : []), ...data.sales.flatMap(s => [s.last?.linkId, s.first?.linkId].filter((id): id is Id<'marketingLinks'> => !!id))]);
		for (const id of linkIds) if (!seenLinks.has(id)) { const row = await get(id); if (row) addLink(row); }
		const couponIds = new Set([...data.sales.flatMap(s => s.coupon ? [s.coupon.couponId] : []), ...linkCoupons]);
		for (const id of couponIds) if (!seenCoupons.has(id)) { const row = await get(id); if (row) addCoupon(row); }
		const campaignIds = new Set([...data.spend.map(s => s.campaignId), ...data.sessions.flatMap(s => s.campaignId ? [s.campaignId] : []), ...convertedSessions.flatMap(s => s.campaignId ? [s.campaignId] : []), ...data.links.map(l => l.campaignId), ...data.coupons.flatMap(c => c.campaignId ? [c.campaignId] : []), ...data.sales.flatMap(s => [s.last?.campaignId, s.first?.campaignId, s.coupon?.campaignId].filter((id): id is Id<'marketingCampaigns'> => !!id))]);
		for (const id of campaignIds) if (!seenCampaigns.has(id)) { const row = await get(id); if (row) addCampaign(row); }
	} catch (error) {
		if (!(error instanceof ReadBudgetExceeded)) throw error;
		data.truncated = true;
	}
	return data;
}
