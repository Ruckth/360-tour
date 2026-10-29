import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { markBookingPaid } from './bookings';
import { requireAdmin } from './lib/adminAuth';
import { recordAppointmentChange } from './lib/appointmentChanges';
import {
	MAX_QTY,
	MERGES_QTY,
	NOTE_MAX,
	assertBillSize,
	assertDiscount,
	assertPrice,
	assertPriceOverride,
	assertTenders,
	billTotals,
	bookingBalance,
	bookingPayable,
	lineNet,
	round2
} from './lib/billMath';
import { resortLocalParts } from './lib/serviceSlots';

/**
 * Staff POS checkout. A bill is a server draft (so it can be held and resumed on another
 * device) until settleBill pays it in one transaction: payments, the receipt number and the
 * attached bookings and appointments are written together, or not at all.
 */

const MAX_LINES = 100;
const OPEN_BILLS = 20;
const FREQUENT_SCAN = 300;
const FREQUENT_COUNT = 8;
const CURRENCY = 'THB';

const discountValidator = v.object({ type: v.union(v.literal('amount'), v.literal('percent')), value: v.number() });
const tenderValidator = v.object({
	method: v.union(v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer')),
	amount: v.number(),
	received: v.optional(v.number())
});
const itemValidator = v.union(
	v.object({ kind: v.literal('service'), serviceId: v.id('services') }),
	v.object({ kind: v.literal('room'), propertyId: v.id('properties') }),
	v.object({ kind: v.literal('extra'), name: v.string(), price: v.number() })
);

type ReadCtx = QueryCtx | MutationCtx;
type Bill = Doc<'bills'>;
type Line = Doc<'billLines'>;
type Guest = { guestName: string; guestPhone: string; guestEmail?: string };

const billLabel = (bill: Pick<Bill, 'guestName' | 'walkInNumber'>) => bill.guestName || `Walk-in #${bill.walkInNumber}`;
const isOpen = (bill: Bill) => bill.status === 'draft' || bill.status === 'held';
const walkInKey = (now: number) => `walkin:${resortLocalParts(now).date}`;
const ATTACHED_PRICE = "A stay is charged at its booked price. Change the price on the booking itself, then attach it again.";

/** Bills are in baht; a price in another currency is refused rather than read as baht. */
function assertBaht(currency: string, what: string) {
	if (currency !== CURRENCY) throw new Error(`${what} is priced in ${currency}. Checkout takes ${CURRENCY} only.`);
}

async function counterValue(ctx: ReadCtx, key: string) {
	return (await ctx.db.query('billCounters').withIndex('by_key', (q) => q.eq('key', key)).unique())?.value ?? 0;
}

/** Next number for the key, written in the caller's transaction so two bills can't share one. */
async function nextNumber(ctx: MutationCtx, key: string) {
	const row = await ctx.db.query('billCounters').withIndex('by_key', (q) => q.eq('key', key)).unique();
	const value = (row?.value ?? 0) + 1;
	if (row) await ctx.db.patch(row._id, { value });
	else await ctx.db.insert('billCounters', { key, value });
	return value;
}

async function billLines(ctx: ReadCtx, billId: Id<'bills'>) {
	return await ctx.db.query('billLines').withIndex('by_billId', (q) => q.eq('billId', billId)).take(MAX_LINES);
}

/** The bill to change, created on first use. Editing a held bill makes it a draft again. */
async function editableBill(ctx: MutationCtx, billId: Id<'bills'> | undefined, actor: string): Promise<Bill> {
	const now = Date.now();
	if (!billId) {
		const walkInNumber = await nextNumber(ctx, walkInKey(now));
		const id = await ctx.db.insert('bills', {
			status: 'draft', walkInNumber, currency: CURRENCY, itemCount: 0, total: 0, hasItems: false, revision: 0, createdBy: actor, createdAt: now, updatedAt: now
		});
		return (await ctx.db.get(id))!;
	}
	const bill = await ctx.db.get(billId);
	if (!bill) throw new Error('Bill not found');
	if (!isOpen(bill)) throw new Error('This bill is already paid');
	if (bill.status === 'held') await ctx.db.patch(bill._id, { status: 'draft' });
	return bill;
}

async function editableLine(ctx: MutationCtx, lineId: Id<'billLines'>, actor: string) {
	const line = await ctx.db.get(lineId);
	if (!line) throw new Error('Item not found');
	const bill = await editableBill(ctx, line.billId, actor);
	return { line, bill };
}

/** Keeps the bill's item count and total in step with its lines, and marks it changed. */
async function refreshBill(ctx: MutationCtx, billId: Id<'bills'>) {
	const [bill, lines] = await Promise.all([ctx.db.get(billId), billLines(ctx, billId)]);
	const totals = billTotals(lines);
	assertBillSize(totals);
	await ctx.db.patch(billId, {
		itemCount: lines.reduce((n, line) => n + line.qty, 0),
		total: totals.total,
		hasItems: lines.length > 0,
		revision: bill!.revision + 1,
		updatedAt: Date.now()
	});
}

async function assertRoom(ctx: MutationCtx, billId: Id<'bills'>) {
	if ((await billLines(ctx, billId)).length >= MAX_LINES) throw new Error(`A bill holds at most ${MAX_LINES} items`);
}

function cleanText(value: string | undefined, label: string, max = 200) {
	const trimmed = value?.trim();
	if (trimmed && trimmed.length > max) throw new Error(`${label} must be at most ${max} characters`);
	return trimmed || undefined;
}

function appointmentAttachable(appointment: Doc<'serviceAppointments'>) {
	return appointment.paymentStatus === 'unpaid' && appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}

function bookingCheckoutBlock(booking: Doc<'bookings'>) {
	return booking.paymentStatus !== 'paid' && (booking.stripeCheckoutExpiresAt ?? 0) > Date.now()
		? 'Online checkout is in progress. Wait for it to finish or expire before taking payment at the desk.'
		: null;
}

/**
 * An open bill (other than `exceptBillId`) that already carries this booking or appointment.
 * Newest lines first: a source is on at most one open bill, and it is newer than the source's paid history.
 */
async function openBillWith(ctx: ReadCtx, target: { bookingId: Id<'bookings'> } | { appointmentId: Id<'serviceAppointments'> }, exceptBillId?: Id<'bills'>) {
	const lines = 'bookingId' in target
		? await ctx.db.query('billLines').withIndex('by_bookingId', (q) => q.eq('bookingId', target.bookingId)).order('desc').take(20)
		: await ctx.db.query('billLines').withIndex('by_appointmentId', (q) => q.eq('appointmentId', target.appointmentId)).order('desc').take(20);
	for (const line of lines) {
		if (line.billId === exceptBillId) continue;
		const bill = await ctx.db.get(line.billId);
		if (bill && isOpen(bill)) return bill;
	}
	return null;
}

async function bookingLine(ctx: MutationCtx, booking: Doc<'bookings'>) {
	const property = await ctx.db.get(booking.propertyId);
	const { paid } = bookingBalance(booking);
	return {
		kind: 'booking' as const,
		bookingId: booking._id,
		name: `Stay · ${property?.name ?? 'Villa'}`,
		detail: `${booking.checkIn} → ${booking.checkOut} · ${booking.nights} ${booking.nights === 1 ? 'night' : 'nights'}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}`,
		unitPrice: booking.total,
		currency: booking.currency,
		qty: 1,
		...(paid > 0 ? { deposit: paid } : {})
	};
}

async function appointmentLine(ctx: MutationCtx, appointment: Doc<'serviceAppointments'>) {
	const service = await ctx.db.get(appointment.serviceId);
	const { date, time } = resortLocalParts(appointment.start);
	return {
		kind: 'appointment' as const,
		appointmentId: appointment._id,
		serviceId: appointment.serviceId,
		name: service?.name ?? 'Appointment',
		detail: `${date} ${time} · ${appointment.confirmationCode}`,
		unitPrice: appointment.price,
		currency: appointment.currency,
		qty: 1,
		staffId: appointment.staffId,
		startAt: appointment.start
	};
}

/** Attaches a booking or appointment to the bill, taking the guest's details when the bill has none. */
async function attachTo(ctx: MutationCtx, bill: Bill, target: { bookingId?: Id<'bookings'>; appointmentId?: Id<'serviceAppointments'> }) {
	if (Boolean(target.bookingId) === Boolean(target.appointmentId)) throw new Error('Choose one booking or appointment');
	await assertRoom(ctx, bill._id);
	let line;
	let guest: Guest;
	if (target.bookingId) {
		const booking = await ctx.db.get(target.bookingId);
		if (!booking) throw new Error('Booking not found');
		if (!bookingPayable(booking)) throw new Error('This booking has nothing left to pay');
		const blocked = bookingCheckoutBlock(booking);
		if (blocked) throw new Error(blocked);
		assertBaht(booking.currency, 'This booking');
		const other = await openBillWith(ctx, { bookingId: booking._id });
		if (other) throw new Error(other._id === bill._id ? 'This booking is already on the bill' : `This booking is already on ${billLabel(other)}'s bill`);
		line = await bookingLine(ctx, booking);
		guest = booking;
	} else {
		const appointment = await ctx.db.get(target.appointmentId!);
		if (!appointment) throw new Error('Appointment not found');
		if (!appointmentAttachable(appointment)) throw new Error('This appointment has nothing left to pay');
		assertBaht(appointment.currency, 'This appointment');
		const other = await openBillWith(ctx, { appointmentId: appointment._id });
		if (other) throw new Error(other._id === bill._id ? 'This appointment is already on the bill' : `This appointment is already on ${billLabel(other)}'s bill`);
		line = await appointmentLine(ctx, appointment);
		guest = appointment;
	}
	await ctx.db.insert('billLines', { billId: bill._id, ...line, createdAt: Date.now() });
	if (!bill.guestName && guest.guestName) {
		await ctx.db.patch(bill._id, { guestName: guest.guestName, guestPhone: guest.guestPhone || undefined, guestEmail: guest.guestEmail });
	}
	await refreshBill(ctx, bill._id);
}

export const catalog = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const [services, properties, staff, recent] = await Promise.all([
			ctx.db.query('services').withIndex('by_status', (q) => q.eq('status', 'active')).take(200),
			ctx.db.query('properties').withIndex('by_status', (q) => q.eq('status', 'active')).take(100),
			ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200),
			ctx.db.query('billLines').order('desc').take(FREQUENT_SCAN)
		]);
		// Most often rung up lately, for the Frequent tab.
		const counts = new Map<string, number>();
		for (const line of recent) {
			const key = line.kind === 'service' ? `service:${line.serviceId}` : line.kind === 'room' ? `room:${line.propertyId}` : line.kind === 'extra' ? `extra:${line.name}` : null;
			if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		// Only baht prices can go on a bill (see assertBaht).
		return {
			services: services.filter((s) => s.currency === CURRENCY).map((s) => ({ _id: s._id, name: s.name, category: s.category, description: s.description, durationMin: s.durationMin, price: s.price, currency: s.currency, staffIds: s.staffIds })),
			rooms: properties.filter((p) => p.currency === CURRENCY).map((p) => ({ _id: p._id, name: p.name, tagline: p.tagline, price: p.pricePerNight, currency: p.currency, maxGuests: p.maxGuests })),
			/** No extras catalog exists yet; the Extras tab offers custom items. */
			extras: [] as Array<{ name: string; price: number; category: string }>,
			staff: staff.map((s) => ({ _id: s._id, name: s.name, color: s.color })),
			frequent: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, FREQUENT_COUNT).map(([key]) => key)
		};
	}
});

export const nextWalkInNumber = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return (await counterValue(ctx, walkInKey(Date.now()))) + 1;
	}
});

export const getBill = query({
	args: { billId: v.id('bills') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const bill = await ctx.db.get(args.billId);
		if (!bill) return null;
		const [lines, payments, audit] = await Promise.all([
			billLines(ctx, bill._id),
			ctx.db.query('billPayments').withIndex('by_billId', (q) => q.eq('billId', bill._id)).take(10),
			ctx.db.query('billAudit').withIndex('by_billId_and_at', (q) => q.eq('billId', bill._id)).order('desc').take(50)
		]);
		const staffNames = new Map<Id<'staff'>, string>();
		for (const id of new Set(lines.flatMap((line) => (line.staffId ? [line.staffId] : [])))) {
			const person = await ctx.db.get(id);
			if (person) staffNames.set(id, person.name);
		}
		return {
			bill: { ...bill, label: billLabel(bill) },
			lines: lines.map((line) => ({ ...line, net: lineNet(line), staffName: line.staffId ? staffNames.get(line.staffId) ?? 'Former staff member' : undefined })),
			payments,
			audit,
			totals: billTotals(lines)
		};
	}
});

/** Draft and held bills with items, newest first, to resume. */
export const listOpenBills = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const pages = await Promise.all(
			(['held', 'draft'] as const).map((status) =>
				ctx.db.query('bills').withIndex('by_status_and_hasItems_and_updatedAt', (q) => q.eq('status', status).eq('hasItems', true)).order('desc').take(OPEN_BILLS)
			)
		);
		return pages.flat()
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, OPEN_BILLS)
			.map((bill) => ({ _id: bill._id, status: bill.status, label: billLabel(bill), itemCount: bill.itemCount, total: bill.total, currency: bill.currency, updatedAt: bill.updatedAt }));
	}
});

/**
 * The guest's unpaid bookings and appointments, matched by exact phone, email or name.
 * Shown for staff to attach explicitly; nothing is added to a bill automatically.
 */
export const listAttachable = query({
	args: { guestName: v.optional(v.string()), guestPhone: v.optional(v.string()), guestEmail: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const phone = args.guestPhone?.trim() ?? '';
		const digits = phone.replace(/\D/g, '');
		const email = args.guestEmail?.trim().toLowerCase() ?? '';
		const name = args.guestName?.trim() ?? '';
		const [byDigits, byPhone, byEmail, byName, appointmentsByPhone, appointmentsByName] = await Promise.all([
			digits.length >= 4 ? ctx.db.query('bookings').withIndex('by_guestPhoneDigits', (q) => q.eq('guestPhoneDigits', digits)).order('desc').take(20) : [],
			// Raw phone and the name search also find bookings saved before the lookup fields
			// (migrations:backfillBookingGuestLookup), like adminBookings.findGuests.
			phone ? ctx.db.query('bookings').withIndex('by_guestPhone', (q) => q.eq('guestPhone', phone)).order('desc').take(20) : [],
			email.includes('@') ? ctx.db.query('bookings').withIndex('by_guestEmailNormalized', (q) => q.eq('guestEmailNormalized', email)).order('desc').take(20) : [],
			name.length >= 2 ? ctx.db.query('bookings').withSearchIndex('search_guestName', (q) => q.search('guestName', name)).take(20) : [],
			phone ? ctx.db.query('serviceAppointments').withIndex('by_guestPhone', (q) => q.eq('guestPhone', phone)).order('desc').take(20) : [],
			name.length >= 2 ? ctx.db.query('serviceAppointments').withSearchIndex('search_guestName', (q) => q.search('guestName', name)).take(20) : []
		]);
		// A same-name booking or appointment counts only if its contact details match the ones given, if any.
		const sameGuest = (b: Guest) =>
			b.guestName.trim().toLowerCase() === name.toLowerCase() &&
			((!digits && !email) || (digits.length >= 4 && b.guestPhone.replace(/\D/g, '') === digits) || (email.includes('@') && b.guestEmail?.trim().toLowerCase() === email));
		const bookings = new Map<Id<'bookings'>, Doc<'bookings'>>();
		for (const booking of [...byDigits, ...byPhone, ...byEmail, ...byName.filter(sameGuest)]) bookings.set(booking._id, booking);
		const appointments = new Map([...appointmentsByPhone, ...appointmentsByName.filter(sameGuest)].map((a) => [a._id, a]));
		for (const booking of bookings.values()) {
			for (const appointment of await ctx.db.query('serviceAppointments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).take(20)) appointments.set(appointment._id, appointment);
		}

		const rows = [];
		for (const booking of bookings.values()) {
			if (!bookingPayable(booking)) continue;
			const property = await ctx.db.get(booking.propertyId);
			rows.push({
				kind: 'booking' as const,
				id: booking._id as string,
				name: `Stay · ${property?.name ?? 'Villa'}`,
				detail: `${booking.checkIn} → ${booking.checkOut}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}`,
				price: booking.total,
				currency: booking.currency,
				deposit: bookingBalance(booking).paid,
				unavailableReason: bookingCheckoutBlock(booking),
				onBill: (await openBillWith(ctx, { bookingId: booking._id }))?._id ?? null
			});
		}
		for (const appointment of appointments.values()) {
			if (!appointmentAttachable(appointment)) continue;
			const service = await ctx.db.get(appointment.serviceId);
			const { date, time } = resortLocalParts(appointment.start);
			rows.push({
				kind: 'appointment' as const,
				id: appointment._id as string,
				name: service?.name ?? 'Appointment',
				detail: `${date} ${time} · ${appointment.confirmationCode}`,
				price: appointment.price,
				currency: appointment.currency,
				deposit: 0,
				unavailableReason: null,
				onBill: (await openBillWith(ctx, { appointmentId: appointment._id }))?._id ?? null
			});
		}
		return rows;
	}
});

/**
 * Guests who booked an appointment, by name or exact phone, for the checkout customer search
 * (stays come from adminBookings.searchBookings). Covers guests with no villa booking.
 */
export const searchAppointmentGuests = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const text = args.query.trim();
		if (text.length < 2) return [];
		const [byPhone, byName] = await Promise.all([
			ctx.db.query('serviceAppointments').withIndex('by_guestPhone', (q) => q.eq('guestPhone', text)).order('desc').take(20),
			ctx.db.query('serviceAppointments').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(20)
		]);
		return [...byPhone, ...byName].map((a) => ({ guestName: a.guestName, guestPhone: a.guestPhone, guestEmail: a.guestEmail }));
	}
});

/** `?booking=` / `?appointment=` entry: the open bill that already has it, or a new bill for that guest. */
export const openFor = mutation({
	args: { bookingId: v.optional(v.id('bookings')), appointmentId: v.optional(v.id('serviceAppointments')) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		if (Boolean(args.bookingId) === Boolean(args.appointmentId)) throw new Error('Choose one booking or appointment');
		const existing = await openBillWith(ctx, args.bookingId ? { bookingId: args.bookingId } : { appointmentId: args.appointmentId! });
		if (existing) return { billId: existing._id };
		const bill = await editableBill(ctx, undefined, admin.email);
		await attachTo(ctx, bill, args);
		return { billId: bill._id };
	}
});

export const addItem = mutation({
	args: { billId: v.optional(v.id('bills')), item: itemValidator },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const bill = await editableBill(ctx, args.billId, admin.email);
		const { item } = args;
		let line: Omit<Line, '_id' | '_creationTime' | 'billId' | 'createdAt'>;
		if (item.kind === 'service') {
			const service = await ctx.db.get(item.serviceId);
			if (!service || service.status !== 'active') throw new Error('This service is no longer offered');
			assertBaht(service.currency, service.name);
			line = { kind: 'service', serviceId: service._id, name: service.name, detail: `${service.durationMin} min`, unitPrice: service.price, currency: CURRENCY, qty: 1 };
		} else if (item.kind === 'room') {
			const property = await ctx.db.get(item.propertyId);
			if (!property || property.status !== 'active') throw new Error('This villa is not available');
			assertBaht(property.currency, property.name);
			line = { kind: 'room', propertyId: property._id, name: property.name, detail: 'per night', unitPrice: property.pricePerNight, currency: CURRENCY, qty: 1 };
		} else {
			const name = cleanText(item.name, 'Item name', 80);
			if (!name) throw new Error('Name the item');
			assertPrice(item.price);
			line = { kind: 'extra', name, unitPrice: round2(item.price), currency: CURRENCY, qty: 1 };
		}

		// Nights and extras stack into one row unless that row has its own price or discount.
		if (MERGES_QTY[line.kind]) {
			const same = (await billLines(ctx, bill._id)).find((l) =>
				l.kind === line.kind && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
				(line.kind === 'room' ? l.propertyId === line.propertyId : l.name === line.name)
			);
			if (same && same.qty < MAX_QTY) {
				await ctx.db.patch(same._id, { qty: same.qty + 1 });
				await refreshBill(ctx, bill._id);
				return { billId: bill._id, lineId: same._id };
			}
		}
		await assertRoom(ctx, bill._id);
		const lineId = await ctx.db.insert('billLines', { billId: bill._id, ...line, createdAt: Date.now() });
		await refreshBill(ctx, bill._id);
		return { billId: bill._id, lineId };
	}
});

export const attach = mutation({
	args: { billId: v.optional(v.id('bills')), bookingId: v.optional(v.id('bookings')), appointmentId: v.optional(v.id('serviceAppointments')) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const bill = await editableBill(ctx, args.billId, admin.email);
		await attachTo(ctx, bill, args);
		return { billId: bill._id };
	}
});

/**
 * Therapist (null = any), start time (null = now), quantity and discount (null = none) for one row.
 * The quantity moves by `qtyChange` (kept within 1–99), so quick taps on two devices add up.
 */
export const updateLine = mutation({
	args: {
		lineId: v.id('billLines'),
		staffId: v.optional(v.union(v.id('staff'), v.null())),
		startAt: v.optional(v.union(v.number(), v.null())),
		qtyChange: v.optional(v.number()),
		discount: v.optional(v.union(discountValidator, v.null()))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, bill } = await editableLine(ctx, args.lineId, admin.email);
		const patch: Partial<Line> = {};
		if (args.staffId !== undefined) {
			if (line.kind !== 'service') throw new Error('Only walk-in services take a therapist here');
			if (args.staffId) {
				const service = line.serviceId ? await ctx.db.get(line.serviceId) : null;
				const person = await ctx.db.get(args.staffId);
				if (!person || person.status !== 'active') throw new Error('Staff member not found');
				if (!service?.staffIds.includes(args.staffId)) throw new Error(`${person.name} doesn't offer this service`);
			}
			patch.staffId = args.staffId ?? undefined;
		}
		if (args.startAt !== undefined) {
			if (line.kind !== 'service') throw new Error('Only walk-in services take a start time here');
			if (args.startAt !== null && !Number.isSafeInteger(args.startAt)) throw new Error('Invalid start time');
			patch.startAt = args.startAt ?? undefined;
		}
		if (args.qtyChange !== undefined) {
			if (!MERGES_QTY[line.kind]) throw new Error('Add another row instead: each service is its own row');
			if (!Number.isInteger(args.qtyChange) || Math.abs(args.qtyChange) > MAX_QTY) throw new Error('Invalid quantity change');
			patch.qty = Math.min(Math.max(line.qty + args.qtyChange, 1), MAX_QTY);
		}
		if (args.discount !== undefined) {
			if (line.kind === 'booking' && args.discount) throw new Error(ATTACHED_PRICE);
			if (args.discount) assertDiscount(args.discount);
			patch.discount = args.discount && args.discount.value > 0 ? args.discount : undefined;
		}
		await ctx.db.patch(line._id, patch);
		await refreshBill(ctx, bill._id);
	}
});

/** One-off price for a row. Setting a price needs a note; every change is kept in billAudit. */
export const overrideLinePrice = mutation({
	args: { lineId: v.id('billLines'), price: v.union(v.number(), v.null()), note: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, bill } = await editableLine(ctx, args.lineId, admin.email);
		if (line.kind === 'booking' && args.price !== null) throw new Error(ATTACHED_PRICE);
		const fromPrice = line.priceOverride?.price ?? line.unitPrice;
		let note: string | undefined;
		if (args.price === null) {
			if (!line.priceOverride) return;
			note = cleanText(args.note, 'Note', NOTE_MAX);
			await ctx.db.patch(line._id, { priceOverride: undefined });
		} else {
			note = assertPriceOverride(args.price, args.note);
			await ctx.db.patch(line._id, { priceOverride: { price: round2(args.price), note, by: admin.email, at: Date.now() } });
		}
		await ctx.db.insert('billAudit', {
			billId: bill._id, lineId: line._id, at: Date.now(), actor: admin.email, kind: 'price_override',
			fromPrice, toPrice: args.price === null ? line.unitPrice : round2(args.price), note
		});
		await refreshBill(ctx, bill._id);
	}
});

export const removeLine = mutation({
	args: { lineId: v.id('billLines') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, bill } = await editableLine(ctx, args.lineId, admin.email);
		await ctx.db.delete(line._id);
		await refreshBill(ctx, bill._id);
	}
});

/** Names the guest on the bill; null goes back to the walk-in number. */
export const setCustomer = mutation({
	args: {
		billId: v.optional(v.id('bills')),
		guest: v.union(v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()) }), v.null())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const bill = await editableBill(ctx, args.billId, admin.email);
		const name = cleanText(args.guest?.name, 'Name', 120);
		if (args.guest && !name) throw new Error('Enter the guest name');
		await ctx.db.patch(bill._id, {
			guestName: name,
			guestPhone: cleanText(args.guest?.phone, 'Phone', 40),
			guestEmail: cleanText(args.guest?.email, 'Email', 200),
			revision: bill.revision + 1,
			updatedAt: Date.now()
		});
		return { billId: bill._id };
	}
});

export const holdBill = mutation({
	args: { billId: v.id('bills') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const bill = await editableBill(ctx, args.billId, admin.email);
		if (bill.itemCount === 0) throw new Error('Add an item before holding the bill');
		await ctx.db.patch(bill._id, { status: 'held', updatedAt: Date.now() });
	}
});

/** Removes every row and the guest; the bill and its audit trail stay. */
export const clearBill = mutation({
	args: { billId: v.id('bills') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const bill = await editableBill(ctx, args.billId, admin.email);
		for (const line of await billLines(ctx, bill._id)) await ctx.db.delete(line._id);
		await ctx.db.patch(bill._id, { guestName: undefined, guestPhone: undefined, guestEmail: undefined });
		await ctx.db.insert('billAudit', { billId: bill._id, at: Date.now(), actor: admin.email, kind: 'cleared' });
		await refreshBill(ctx, bill._id);
	}
});

/**
 * Pays the bill. `idempotencyKey` identifies one payment attempt: retrying it after a dropped
 * connection returns the first result instead of charging twice. `expectedDue` and
 * `expectedRevision` are what staff reviewed; if the bill changed since, nothing is written.
 */
export const settleBill = mutation({
	args: { billId: v.id('bills'), idempotencyKey: v.string(), expectedDue: v.number(), expectedRevision: v.number(), tenders: v.array(tenderValidator) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const key = args.idempotencyKey.trim();
		if (key.length < 8 || key.length > 100) throw new Error('Invalid payment attempt');
		const bill = await ctx.db.get(args.billId);
		if (!bill) throw new Error('Bill not found');
		if (!isOpen(bill)) {
			if (bill.settleKey === key && bill.receiptNumber !== undefined) return { receiptNumber: bill.receiptNumber, replayed: true };
			throw new Error('This bill is already paid');
		}
		const lines = await billLines(ctx, bill._id);
		if (!lines.length) throw new Error('Add an item first');
		const totals = billTotals(lines);
		if (totals.due !== round2(args.expectedDue) || bill.revision !== args.expectedRevision) throw new Error('The bill changed. Check the total and pay again.');
		assertTenders(args.tenders, totals.due);

		const now = Date.now();
		const changed = (line: Line) => new Error(`${line.name} changed since it was added. Remove it and attach it again.`);
		for (const line of lines) {
			if (line.bookingId) {
				const booking = await ctx.db.get(line.bookingId);
				if (!booking || !bookingPayable(booking) || booking.currency !== CURRENCY) throw changed(line);
				// Same villa, dates, price and deposit as the row staff reviewed (and the receipt prints).
				const fresh = await bookingLine(ctx, booking);
				if (fresh.name !== line.name || fresh.detail !== line.detail || fresh.unitPrice !== line.unitPrice || (fresh.deposit ?? 0) !== (line.deposit ?? 0)) throw changed(line);
				// Charged at the booked price, so the booking's total is what it has now been paid.
				if (line.discount || line.priceOverride) throw new Error(ATTACHED_PRICE);
				await markBookingPaid(ctx, booking._id, 'pos');
				await ctx.db.patch(booking._id, { amountPaid: booking.total });
			}
			if (line.appointmentId) {
				const appointment = await ctx.db.get(line.appointmentId);
				if (!appointment || !appointmentAttachable(appointment)) throw new Error(`${line.name} was paid or cancelled since it was added. Remove it first.`);
				if (
					appointment.currency !== CURRENCY || appointment.price !== line.unitPrice || appointment.serviceId !== line.serviceId ||
					appointment.staffId !== line.staffId || appointment.start !== line.startAt
				) {
					throw changed(line);
				}
				// The appointment keeps what was charged for it, after any discount or price change here.
				await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: lineNet(line) }, { actor: admin.email, kind: 'payment', reason: 'Paid at checkout' });
			}
		}
		for (const tender of args.tenders) {
			await ctx.db.insert('billPayments', { billId: bill._id, ...tender, idempotencyKey: key, createdBy: admin.email, createdAt: now });
		}
		const receiptNumber = await nextNumber(ctx, 'receipt');
		await ctx.db.patch(bill._id, { status: 'paid', receiptNumber, settleKey: key, total: totals.total, paidAt: now, paidBy: admin.email, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: bill._id, at: now, actor: admin.email, kind: 'paid', toPrice: totals.due });
		return { receiptNumber, replayed: false };
	}
});

/**
 * Voids a paid bill. The record and its receipt number stay; attached bookings and appointments
 * keep their paid status (record a refund on them if money is returned).
 */
export const voidBill = mutation({
	args: { billId: v.id('bills'), reason: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const reason = cleanText(args.reason, 'Reason', NOTE_MAX);
		if (!reason) throw new Error('Give a reason for the void');
		const bill = await ctx.db.get(args.billId);
		if (!bill) throw new Error('Bill not found');
		if (bill.status !== 'paid') throw new Error('Only a paid bill can be voided');
		const now = Date.now();
		await ctx.db.patch(bill._id, { status: 'void', voidedAt: now, voidedBy: admin.email, voidReason: reason, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: bill._id, at: now, actor: admin.email, kind: 'void', note: reason });
	}
});
