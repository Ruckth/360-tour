import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { adminQuery } from '../auth/model';
import { appointmentHistory, appointmentHistoryPage } from './private/appointmentChanges';
import { appointmentFinancials } from './private/appointmentFinance';
import { APPOINTMENT_LOOKBACK, TIME_OFF_LOOKBACK, assertAppointmentStart, boundedIntegrityRows, historicalWarnings, findOpenSlots as openSlots, scheduleDays, staffBusyRanges } from './private/serviceSlots';
import { blocksTime, localDateTimeUtc, localDayRange, planWorking } from '../shared/schedule';
import { resortLocalParts } from '../shared/time';
import { DAY, MINUTE, SELECTED_STAFF_READ_LIMIT, ScheduleBlock, adminStarts, assertPageSize, boundedStaff, countUpcoming, loadAppointment } from './private/administration';

export const listStaff = adminQuery({
	args: { includeArchived: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const rows = args.includeArchived
			? await ctx.db.query('staff').take(201)
			: await ctx.db.query('staff').withIndex('by_status', q => q.eq('status', 'active')).take(201);
		if (rows.length > 200) throw new Error('Too many staff to show safely. Narrow the list or contact support.');
		return rows;
	}
});

/** Shown before archiving a staff member or service. */
export const countUpcomingAppointments = adminQuery({
	args: { staffId: v.optional(v.id('staff')), serviceId: v.optional(v.id('services')) },
	handler: async (ctx, args) => {
		if (args.staffId) return await countUpcoming(ctx, { staffId: args.staffId });
		if (args.serviceId) return await countUpcoming(ctx, { serviceId: args.serviceId });
		throw new Error('Choose a staff member or service');
	}
});

export const listServices = adminQuery({
	args: { includeArchived: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const rows = args.includeArchived
			? await ctx.db.query('services').take(201)
			: await ctx.db.query('services').withIndex('by_status', q => q.eq('status', 'active')).take(201);
		if (rows.length > 200) throw new Error('Too many services to show safely. Narrow the list or contact support.');
		return rows;
	}
});

/** Time off that hasn't ended yet, soonest first. */
export const listTimeOff = adminQuery({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		const now = Date.now();
		const rows: Doc<'staffTimeOff'>[] = [];
		for await (const row of boundedIntegrityRows(ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
			q.eq('staffId', args.staffId).gte('start', now - TIME_OFF_LOOKBACK)
		))) {
			if (row.end > now) rows.push(row);
			if (rows.length > 100) throw new Error('More time off is available. Use the paginated time-off reader.');
		}
		return rows;
	}
});

export const listSchedule = adminQuery({
	args: { from: v.number(), to: v.number(), staffIds: v.optional(v.array(v.id('staff'))) },
	handler: async (ctx, args) => {
		if (!Number.isSafeInteger(args.from) || !Number.isSafeInteger(args.to) || args.to <= args.from || args.to - args.from > 14 * DAY) throw new Error('Schedule range must be at most 14 days');
		const selected = args.staffIds ? new Set(args.staffIds) : undefined;
		const inRange: Doc<'appointments'>[] = [];
		// A few selected people: read only their appointments. Otherwise one scan of the range.
		const ranges = selected && selected.size <= SELECTED_STAFF_READ_LIMIT
			? [...selected].map((staffId) => ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', staffId).gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
			))
			: [ctx.db.query('appointments').withIndex('by_start', (q) =>
				q.gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
			)];
		for (const range of ranges) {
			for await (const appointment of boundedIntegrityRows(range)) {
				const occupiedUntil = blocksTime(appointment) ? appointment.blockedUntil : appointment.end;
				if (occupiedUntil > args.from && (!selected || selected.has(appointment.staffId))) inRange.push(appointment);
				if (inRange.length > 2000) throw new Error('Too many appointments to show safely. Narrow the calendar range.');
			}
		}
		inRange.sort((a, b) => a.start - b.start);
		const activeRows = await ctx.db.query('staff').withIndex('by_status', q => q.eq('status', 'active')).take(201);
		if (activeRows.length > 200) throw new Error('Too many staff to show safely. Contact support.');
		const active = activeRows.filter(person => !selected || selected.has(person._id));
		// Archived staff appear only when they have appointments in range, so their history stays visible.
		const activeIds = new Set(active.map((person) => person._id));
		const archivedIds = [...new Set(inRange.map((appointment) => appointment.staffId))].filter((id) => !activeIds.has(id));
		const archived = (await Promise.all(archivedIds.map((id) => ctx.db.get(id)))).filter((person): person is Doc<'staff'> => !!person);
		const staff = [...active, ...archived];
		const staffSet = new Set(staff.map((person) => person._id));
		const appointments = inRange.filter((appointment) => staffSet.has(appointment.staffId));
		const services = await ctx.db.query('services').take(201);
		if (services.length > 200) throw new Error('Too many services to show safely. Contact support.');
		const blocks: ScheduleBlock[] = [];
		// Working time from the roster (override or weekly pattern), so calendars can shade off-hours.
		const patternHistory: Array<{ staffId: Id<'staff'>; date: string; known: boolean; knownFrom: string }> = [];
		const shifts: Array<{ staffId: Id<'staff'>; start: number; end: number }> = [];
		const clip = (start: number, end: number) => (start < args.to && end > args.from ? { start: Math.max(start, args.from), end: Math.min(end, args.to) } : null);
		for (const person of staff) {
			for (const { date, plan, override, patternHistoryKnown, patternKnownFrom } of await scheduleDays(ctx, person, args.from, args.to)) {
				patternHistory.push({ staffId: person._id, date, known: patternHistoryKnown, knownFrom: patternKnownFrom });
				for (const [start, end] of planWorking(date, plan)) {
					const range = clip(start, end);
					if (range) shifts.push({ staffId: person._id, ...range });
				}
				for (const block of plan.breaks) {
					const range = clip(localDateTimeUtc(date, block.start), localDateTimeUtc(date, block.end));
					// The date, the break as stored and the whole day's plan, so an edit can be checked against what was shown.
					if (range) blocks.push({ staffId: person._id, ...range, label: block.label, kind: 'break', date, original: block, plan, override });
				}
			}
			for await (const row of boundedIntegrityRows(ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', args.from - TIME_OFF_LOOKBACK).lt('start', args.to)
			))) {
				if (row.end > args.from) blocks.push({ staffId: person._id, start: Math.max(row.start, args.from), end: Math.min(row.end, args.to), label: row.label, kind: 'time_off', timeOff: row });
			}
		}
		return { staff, services, appointments, blocks, shifts, patternHistory };
	}
});

/**
 * Open times, each with `autoStaffId`: who `createAppointment` picks when no staff is given
 * (least appointments that day, then by name), so the dialog can preview the assignment.
 */
export const findOpenSlots = adminQuery({
	args: { serviceId: v.id('services'), date: v.string(), staffId: v.optional(v.id('staff')) },
	handler: async (ctx, args) => {
		const service = await ctx.db.get(args.serviceId);
		let slots;
		if (service && args.staffId && args.date <= resortLocalParts(Date.now()).date) {
			const person = await ctx.db.get(args.staffId);
			slots = person ? await adminStarts(ctx, [person], args.date, (service.durationMin + service.bufferMin) * MINUTE) : [];
			slots = slots.filter(slot => slot.start + (service.durationMin + service.bufferMin) * MINUTE <= Date.now() || (person?.status === 'active' && service.status === 'active' && service.staffIds.includes(person._id)));
		} else slots = await openSlots(ctx, args);
		const [dayStart, dayEnd] = localDayRange(args.date);
		const ranked = new Map<Id<'staff'>, { name: string; count: number }>();
		for (const id of new Set(slots.flatMap((slot) => slot.staffIds))) {
			const person = await ctx.db.get(id);
			let count = 0;
			for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', id).gte('start', dayStart).lt('start', dayEnd)
			))) {
				if (blocksTime(appointment)) count++;
			}
			ranked.set(id, { name: person?.name ?? '', count });
		}
		const order = (a: Id<'staff'>, b: Id<'staff'>) => {
			const x = ranked.get(a)!;
			const y = ranked.get(b)!;
			return x.count - y.count || x.name.localeCompare(y.name) || a.localeCompare(b);
		};
		return slots.map((slot) => ({ ...slot, autoStaffId: [...slot.staffIds].sort(order)[0] }));
	}
});

/** The original booking reference for rebooked appointments, including ones outside the visible calendar dates. */
export const getAppointmentReference = adminQuery({
	args: { appointmentId: v.id('appointments') },
	handler: async (ctx, args) => {
		return (await ctx.db.get(args.appointmentId))?.confirmationCode ?? null;
	}
});

export const previewAppointmentTime = adminQuery({
	args: { serviceId: v.id('services'), staffId: v.id('staff'), start: v.number(), appointmentId: v.optional(v.id('appointments')) },
	handler: async (ctx, args) => {
		try { assertAppointmentStart(args.start, { kind: 'admin_historical' }); }
		catch (error) { return { warnings: [], needsReason: false, problem: error instanceof Error ? error.message : 'Choose a valid service time' }; }
		const service = await ctx.db.get(args.serviceId);
		const person = await ctx.db.get(args.staffId);
		if (!service || !person) throw new Error('Staff or service not found');
		const appointment = args.appointmentId ? await loadAppointment(ctx, args.appointmentId) : null;
		const occupied = appointment ? appointment.blockedUntil - appointment.start : (service.durationMin + service.bufferMin) * MINUTE;
		if (args.start + occupied > Date.now()) {
			let problem: string | null = null;
			if ((!appointment || args.staffId !== appointment.staffId) && (service.status !== 'active' || !service.staffIds.includes(args.staffId))) problem = 'Choose an active service and a currently assigned staff member for current or future work.';
			if ((!appointment || blocksTime(appointment)) && (person.status !== 'active' || (await staffBusyRanges(ctx, person, args.start, args.start + occupied, appointment?._id)).length)) problem = 'The staff member is not available for the full service and turnaround. Choose another time or correct the conflicting schedule first.';
			return { warnings: [], needsReason: false, problem };
		}
		return { ...await historicalWarnings(ctx, person, service, args.start, args.start + occupied, appointment?._id), problem: null };
	}
});

export const listAppointmentHistoryPage = adminQuery({
	args: { appointmentId: v.id('appointments'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		assertPageSize(args.paginationOpts.numItems);
		return await appointmentHistoryPage(ctx, args.appointmentId, args.paginationOpts);
	}
});

/** start-based range, [from,to); past/all include ended records. Consumers must follow the cursor. */
export const listTimeOffPage = adminQuery({
	args: { staffId: v.id('staff'), range: v.union(v.literal('upcoming'), v.literal('past'), v.literal('all')), from: v.optional(v.number()), to: v.optional(v.number()), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		assertPageSize(args.paginationOpts.numItems);
		if ((args.from !== undefined && !Number.isSafeInteger(args.from)) || (args.to !== undefined && !Number.isSafeInteger(args.to)) || (args.from !== undefined && args.to !== undefined && args.to <= args.from)) throw new Error('Invalid time-off range');
		const result = await ctx.db.query('staffTimeOff').withIndex('by_staff_start', q => {
			const staff = q.eq('staffId', args.staffId);
			return args.from !== undefined ? (args.to !== undefined ? staff.gte('start', args.from).lt('start', args.to) : staff.gte('start', args.from)) : args.to !== undefined ? staff.lt('start', args.to) : staff;
		}).order('desc').paginate(args.paginationOpts);
		const now = Date.now();
		return { ...result, page: result.page.filter(row => args.range === 'all' || (args.range === 'past' ? row.end <= now : row.end > now)) };
	}
});

/** Open start times for moving this appointment, keeping its length and turnaround; it doesn't block itself. */
export const rescheduleOptions = adminQuery({
	args: { appointmentId: v.id('appointments'), date: v.string() },
	handler: async (ctx, args) => {
		const appointment = await loadAppointment(ctx, args.appointmentId);
		const service = await ctx.db.get(appointment.serviceId);
		const historicalDate = args.date <= resortLocalParts(Date.now()).date;
		const staff = historicalDate ? await boundedStaff(ctx) : service
			? (await Promise.all([...new Set([...service.staffIds, appointment.staffId])].map(id => ctx.db.get(id)))).filter((person): person is Doc<'staff'> => !!person && (person.status === 'active' || person._id === appointment.staffId)) : [];
		const starts = await adminStarts(ctx, staff, args.date, appointment.blockedUntil - appointment.start, appointment._id, !blocksTime(appointment));
		const slots = starts.map(slot => slot.start + appointment.blockedUntil - appointment.start <= Date.now() ? slot : { ...slot, staffIds: slot.staffIds.filter(id => id === appointment.staffId || service?.staffIds.includes(id)) }).filter(slot => slot.staffIds.length);
		return { staff: staff.map(({ _id, name }) => ({ _id, name })), slots };
	}
});

export const getAppointmentFinancials = adminQuery({
 args: { appointmentId: v.id('appointments') },
 handler: async (ctx, args) => {
  return await appointmentFinancials(ctx, await loadAppointment(ctx, args.appointmentId));
 }
});

/** Newest first, at most HISTORY_LIMIT entries. */
export const listAppointmentHistory = adminQuery({
	args: { appointmentId: v.id('appointments') },
	handler: async (ctx, args) => {
		return await appointmentHistory(ctx, args.appointmentId);
	}
});
