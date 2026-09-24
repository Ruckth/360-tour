import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { CHAT_BOOKING_TTL_MS } from './bookings';
import { enforceRateLimit } from './lib/rateLimit';
import {
	assertAppointmentStart,
	createAppointmentRecord,
	findOpenSlots,
	localDateTimeUtc,
	resortLocalParts,
	SLOT_CONFLICT
} from './lib/serviceSlots';

type ReadCtx = QueryCtx | MutationCtx;

async function sessionFor(ctx: ReadCtx, sessionId: Id<'chatSessions'>) {
	const session = await ctx.db.get(sessionId);
	if (!session) throw new Error('Session not found');
	return session;
}

async function activeService(ctx: ReadCtx, slug: string) {
	const service = await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug.trim())).unique();
	if (!service || service.status !== 'active') throw new Error('Service unavailable');
	return service;
}

function firstName(name: string) {
	return name.trim().split(/\s+/)[0];
}

function nearestTimes(slots: Awaited<ReturnType<typeof findOpenSlots>>, start: number) {
	return slots.slice().sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start) || a.start - b.start)
		.slice(0, 3).map((slot) => resortLocalParts(slot.start).time);
}

export const listActiveServices = internalQuery({
	args: {},
	handler: async (ctx) => {
		const services = await ctx.db.query('services').withIndex('by_status', (q) => q.eq('status', 'active')).take(100);
		return await Promise.all(services.map(async (service) => ({
			name: service.name,
			slug: service.slug,
			description: service.description,
			category: service.category,
			durationMin: service.durationMin,
			price: service.price,
			currency: service.currency,
			staff: (await Promise.all(service.staffIds.map((id) => ctx.db.get(id))))
				.filter((person): person is Doc<'staff'> => !!person && person.status === 'active')
				.map((person) => firstName(person.name))
		})));
	}
});

export const checkServiceAvailability = internalQuery({
	args: { serviceSlug: v.string(), date: v.string(), time: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const service = await activeService(ctx, args.serviceSlug);
		const slots = await findOpenSlots(ctx, { serviceId: service._id, date: args.date });
		const openTimes = slots.map((slot) => resortLocalParts(slot.start).time);
		if (args.time === undefined) return { service: service.name, date: args.date, openTimes };
		const requested = localDateTimeUtc(args.date, args.time);
		const available = slots.some((slot) => slot.start === requested);
		return {
			service: service.name, date: args.date, time: args.time,
			available,
			openTimes,
			alternatives: available ? [] : nearestTimes(slots, requested)
		};
	}
});

export const prepareChatServiceBooking = internalMutation({
	args: {
		sessionId: v.id('chatSessions'), serviceSlug: v.string(), date: v.string(), time: v.string(),
		guestName: v.string(), guestPhone: v.optional(v.string()), staffPreference: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const session = await sessionFor(ctx, args.sessionId);
		const guestPhone = (session.channel === 'whatsapp' ? session.visitorPhone : args.guestPhone ?? session.visitorPhone)?.trim();
		if (!guestPhone) throw new Error('Ask the guest for their phone number before preparing the booking.');
		const guestName = args.guestName.trim() || session.visitorName?.trim();
		if (!guestName) throw new Error('Ask the guest for their name before preparing the booking.');
		const service = await activeService(ctx, args.serviceSlug);
		const start = localDateTimeUtc(args.date, args.time);
		if (resortLocalParts(start).date !== args.date || resortLocalParts(start).time !== args.time) {
			throw new Error('Choose a future local date and time in HH:mm format.');
		}
		assertAppointmentStart(start);
		const staff = (await Promise.all(service.staffIds.map((id) => ctx.db.get(id))))
			.filter((person): person is Doc<'staff'> => !!person && person.status === 'active');
		const requestedName = args.staffPreference?.trim();
		const preferred = requestedName ? staff.find((person) => firstName(person.name).toLowerCase() === requestedName.toLowerCase()) : undefined;
		const slots = await findOpenSlots(ctx, { serviceId: service._id, date: args.date, staffId: preferred?._id });
		if (!slots.some((slot) => slot.start === start)) {
			return { error: SLOT_CONFLICT, alternatives: nearestTimes(slots, start) };
		}
		const now = Date.now();
		await ctx.db.patch(args.sessionId, {
			bookingFlowAt: now,
			pendingServiceQuote: {
				serviceSlug: service.slug, serviceName: service.name, ...(preferred ? { staffId: preferred._id } : {}),
				start, guestName, guestPhone, price: service.price, currency: service.currency, createdAt: now
			}
		});
		return {
			service: service.name, date: args.date, time: args.time, durationMin: service.durationMin,
			staff: preferred ? firstName(preferred.name) : 'any available therapist/staff',
			...(requestedName && !preferred ? { staffPreferenceIgnored: `No active ${requestedName} offers this service; any available staff member will be assigned.` } : {}),
			guestName, guestPhone, price: service.price, currency: service.currency
		};
	}
});

export const confirmChatServiceBooking = internalMutation({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await sessionFor(ctx, args.sessionId);
		const quote = session.pendingServiceQuote;
		if (!quote) throw new Error('No prepared service booking. Call prepare_service_booking first.');
		const existing = quote.appointmentId ? await ctx.db.get(quote.appointmentId) : null;
		if (existing) {
			return {
				appointmentId: existing._id, confirmationCode: existing.confirmationCode,
				service: quote.serviceName, ...resortLocalParts(existing.start),
				staff: firstName((await ctx.db.get(existing.staffId))?.name ?? 'Staff'), alreadyConfirmed: true
			};
		}
		if (Date.now() - quote.createdAt >= CHAT_BOOKING_TTL_MS) {
			throw new Error('The prepared service booking expired. Call prepare_service_booking again.');
		}
		const service = await activeService(ctx, quote.serviceSlug);
		if (service.price !== quote.price || service.currency !== quote.currency) {
			return { error: 'The service price changed. Call prepare_service_booking again.', alternatives: [] };
		}
		const date = resortLocalParts(quote.start).date;
		const stays = await ctx.db.query('bookings').withIndex('by_guestPhone', (q) => q.eq('guestPhone', quote.guestPhone)).order('desc').take(100);
		const stay = stays.filter((booking) => booking.status !== 'cancelled' && booking.checkOut > date)
			.sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
		await enforceRateLimit(ctx, `booking-phone:${quote.guestPhone}`, 5, 60 * 60 * 1000);
		await enforceRateLimit(ctx, 'booking:global', 100, 60 * 60 * 1000);
		let created: Awaited<ReturnType<typeof createAppointmentRecord>>;
		try {
			created = await createAppointmentRecord(ctx, {
				serviceId: service._id, start: quote.start, ...(quote.staffId ? { staffId: quote.staffId } : {}),
				guestName: quote.guestName, guestPhone: quote.guestPhone,
				...(session.visitorEmail ? { guestEmail: session.visitorEmail } : {}),
				...(stay ? { bookingId: stay._id } : {}), chatSessionId: args.sessionId,
				source: session.channel === 'facebook' ? 'messenger' : session.channel
			});
		} catch (error) {
			if (!(error instanceof Error) || error.message !== SLOT_CONFLICT) throw error;
			const slots = await findOpenSlots(ctx, { serviceId: service._id, date, staffId: quote.staffId });
			return { error: SLOT_CONFLICT, alternatives: nearestTimes(slots, quote.start) };
		}
		await ctx.db.patch(args.sessionId, { pendingServiceQuote: { ...quote, appointmentId: created.appointmentId } });
		return {
			appointmentId: created.appointmentId, confirmationCode: created.confirmationCode,
			service: service.name, ...resortLocalParts(quote.start),
			staff: firstName((await ctx.db.get(created.staffId))?.name ?? 'Staff'), alreadyConfirmed: false
		};
	}
});

async function guestAppointments(ctx: ReadCtx, session: Doc<'chatSessions'>) {
	const fromChat = await ctx.db.query('serviceAppointments').withIndex('by_chatSession', (q) => q.eq('chatSessionId', session._id)).order('desc').take(20);
	const phone = session.channel === 'whatsapp' ? session.visitorPhone?.trim() : undefined;
	const byPhone = phone
		? await ctx.db.query('serviceAppointments').withIndex('by_guestPhone', (q) => q.eq('guestPhone', phone)).order('desc').take(20)
		: [];
	return [...new Map([...fromChat, ...byPhone].map((row) => [row._id, row])).values()];
}

export const listChatGuestServiceBookings = internalQuery({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const appointments = (await guestAppointments(ctx, await sessionFor(ctx, args.sessionId)))
			.filter((row) => row.start > Date.now()).sort((a, b) => a.start - b.start).slice(0, 10);
		return await Promise.all(appointments.map(async (row) => ({
			reference: row.confirmationCode, service: (await ctx.db.get(row.serviceId))?.name ?? 'Unknown service',
			date: resortLocalParts(row.start).date, time: resortLocalParts(row.start).time, status: row.status
		})));
	}
});

export const cancelChatServiceBooking = internalMutation({
	args: { sessionId: v.id('chatSessions'), reference: v.string(), turnStartedAt: v.number() },
	handler: async (ctx, args) => {
		const session = await sessionFor(ctx, args.sessionId);
		const appointment = (await guestAppointments(ctx, session)).find((row) => row.confirmationCode.toUpperCase() === args.reference.trim().toUpperCase());
		if (!appointment) throw new Error('No service booking with that reference was found for this guest.');
		if (appointment.status === 'cancelled') return { state: 'already_cancelled' as const, reference: appointment.confirmationCode };
		if (appointment.status !== 'booked' || appointment.start <= Date.now()) throw new Error('Only future booked services can be cancelled in chat.');
		const summary = {
			reference: appointment.confirmationCode,
			service: (await ctx.db.get(appointment.serviceId))?.name ?? 'Unknown service',
			date: resortLocalParts(appointment.start).date, time: resortLocalParts(appointment.start).time
		};
		const pending = session.pendingServiceCancellation;
		if (pending?.appointmentId !== appointment._id || pending.createdAt >= args.turnStartedAt || Date.now() - pending.createdAt >= CHAT_BOOKING_TTL_MS) {
			await ctx.db.patch(args.sessionId, {
				bookingFlowAt: Date.now(), pendingServiceCancellation: { appointmentId: appointment._id, createdAt: Date.now() }
			});
			return { state: 'needs_confirmation' as const, ...summary };
		}
		await ctx.db.patch(appointment._id, { status: 'cancelled' });
		await ctx.db.patch(args.sessionId, { pendingServiceCancellation: undefined });
		return { state: 'cancelled' as const, ...summary };
	}
});
