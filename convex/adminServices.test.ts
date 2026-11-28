// @vitest-environment edge-runtime

import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { createAppointmentRecord, localDateTimeUtc, validateService } from './services/model';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const date = '2026-09-25';
const at = (time: string) => localDateTimeUtc(date, time);
const weekdays = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
	const t = convexTest(schema, modules);
	const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
	const staffId = await admin.mutation(api.services.commands.createStaff.createStaff, {
		name: 'Mali', role: 'Therapist', color: '#abc',
		workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
		breaks: weekdays.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' }))
	});
	const serviceId = await admin.mutation(api.services.commands.createService.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: 'Massage', category: 'Wellness',
		durationMin: 60, bufferMin: 15, price: 200000, currency: 'THB', staffIds: [staffId]
	});
	const booking = { serviceId, staffId, guestName: 'Guest', guestPhone: '+66000000000' };
	const appointment = async (id: Id<'appointments'>) => (await t.run((ctx) => ctx.db.get(id)))!;
	const revision = async (id: Id<'appointments'>) => (await appointment(id)).revision ?? 0;
	return { t, admin, staffId, serviceId, booking, appointment, revision };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); });

const durationOptions = [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }, { durationMin: 120, price: 140000 }];

describe('service duration options', () => {
	it.each([
		{ options: [], message: 'distinct' },
		{ options: Array.from({ length: 7 }, (_, i) => ({ durationMin: (i + 1) * 15, price: 0 })), message: 'distinct' },
		{ options: [durationOptions[0], durationOptions[0]], message: 'distinct' },
		{ options: [{ durationMin: 80, price: 1 }], message: 'multiple of 15' },
		{ options: [{ durationMin: 0, price: 1 }], message: 'positive' },
		{ options: [durationOptions[0], { durationMin: 1440, price: 1 }], message: '24 hours' },
		{ options: [{ durationMin: 60, price: -1 }], message: 'satang' },
		{ options: [{ durationMin: 60, price: 8.5 }], message: 'satang' },
		{ options: [{ durationMin: 60, price: Number.MAX_SAFE_INTEGER + 1 }], message: 'satang' },
		{ options: [durationOptions[1]], message: 'default duration' },
	])('validates option sets ($message)', ({ options, message }) => {
		expect(() => validateService({ options, defaultDurationMin: 60, bufferMin: 15 })).toThrow(message);
	});

	it('sorts options, mirrors the chosen default and audits both catalogue edit paths', async () => {
		const { t, admin, staffId } = await setup();
		const serviceId = await admin.mutation(api.services.commands.createService.createService, {
			slug: 'massage-options', name: 'Massage', description: '', category: 'Wellness',
			options: [...durationOptions].reverse(), defaultDurationMin: 90, bufferMin: 15, currency: 'THB', staffIds: [staffId],
		});
		const service = () => t.run(ctx => ctx.db.get(serviceId));
		expect(await service()).toMatchObject({ durationMin: 90, price: 110000, options: durationOptions });
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, defaultDurationMin: 120, expectedRevision: 0 });
		await expect(admin.mutation(api.services.commands.updateService.updateService, { serviceId, defaultDurationMin: 60, expectedRevision: 0 }))
			.rejects.toThrow('STALE_ADJUSTMENT_REVISION');
		const adjusted = await admin.mutation(api.pos.commands.adjust.adjust, {
			target: { targetType: 'service', targetId: serviceId }, kind: 'editCatalogue',
			input: { price: 145000 }, expectedRevision: 1, clientKey: 'edit-default-price',
		});
		if (adjusted.status !== 'applied') throw new Error('Expected an authorized catalogue edit');
		const changed = [...durationOptions.slice(0, 2), { durationMin: 120, price: 145000 }];
		expect(await service()).toMatchObject({ durationMin: 120, price: 145000, options: changed, revision: 2 });
		expect(await t.run(ctx => ctx.db.get(adjusted.adjustmentId))).toMatchObject({ before: { options: durationOptions }, after: { options: changed } });
		expect(await t.run(ctx => ctx.db.query('recordChanges')
			.withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'service').eq('entityId', serviceId)).take(5)))
			.toEqual(expect.arrayContaining([expect.objectContaining({ after: expect.objectContaining({ options: changed }) })]));
		const update = api.services.commands.updateService.updateService;
		await admin.mutation(update, { serviceId, price: 150000 });
		expect(await service()).toMatchObject({ durationMin: 120, price: 150000, options: [...durationOptions.slice(0, 2), { durationMin: 120, price: 150000 }] });
		await expect(admin.mutation(update, { serviceId, durationMin: 60 })).rejects.toThrow('distinct service durations');
		await admin.mutation(update, { serviceId, durationMin: 45 });
		expect((await admin.query(api.services.admin.listServices, {})).find(row => row._id === serviceId))
			.toMatchObject({ durationMin: 45, price: 150000, options: [{ durationMin: 45, price: 150000 }, ...durationOptions.slice(0, 2)] });
		await admin.mutation(update, { serviceId, options: [durationOptions[0]], defaultDurationMin: 60 });
		expect(await service()).toMatchObject({ ...durationOptions[0], options: [durationOptions[0]] });
	});

	it('uses the chosen duration to date the cost schedule of completed work', async () => {
		const { t, admin, serviceId, booking, appointment } = await setup();
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, options: durationOptions, defaultDurationMin: 60 });
		const costScheduleId = await t.run(ctx => ctx.db.insert('serviceCostSchedules', {
			serviceId, from: '2026-09-26', staff: 1000, materials: 0, tools: 0, actor: 'admin@example.com', recordedAt: Date.now(),
		}));
		vi.setSystemTime(new Date('2026-09-27T00:00:00.000Z'));
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, {
			...booking, durationMin: 90, start: at('22:45'),
		});
		expect(await appointment(appointmentId)).toMatchObject({
			status: 'completed', end: localDateTimeUtc('2026-09-26', '00:15'), costScheduleId,
		});
	});

	it('requires a fresh price review before creating an appointment for the chosen duration', async () => {
		const { t, admin, serviceId, booking, appointment } = await setup();
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, options: durationOptions, defaultDurationMin: 60 });
		const create = api.services.commands.createAppointment.createAppointment;
		const args = { ...booking, durationMin: 90, start: at('09:00') };
		await expect(admin.mutation(create, { ...args, expectedPrice: 80000 })).rejects.toThrow(/SERVICE_PRICE_CHANGED.*The price changed to ฿1,100\. Review and try again\./);
		expect(await t.run(ctx => ctx.db.query('appointments').take(1))).toEqual([]);
		const { appointmentId } = await admin.mutation(create, { ...args, expectedPrice: 110000 });
		expect(await appointment(appointmentId)).toMatchObject({ end: at('10:30'), price: 110000 });
	});

	it('uses the chosen option for availability, appointment terms and upcoming usage', async () => {
		const { t, admin, serviceId, staffId, booking, appointment } = await setup();
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, options: durationOptions, defaultDurationMin: 60 });
		const slotArgs = { serviceId, staffId, date };
		const starts = async (durationMin?: number) => (await admin.query(api.services.admin.findOpenSlots, { ...slotArgs, durationMin })).map(slot => slot.start);
		expect(await starts()).toContain(at('10:45'));
		expect(await starts(90)).not.toContain(at('10:45'));
		await expect(starts(45)).resolves.toEqual([]);
		await expect(admin.query(api.services.admin.previewAppointmentTime, { serviceId, staffId, durationMin: 45, start: at('10:45') }))
			.resolves.toEqual({ warnings: [], needsReason: false, problem: 'This duration is no longer offered. Choose another length.' });
		await expect(admin.query(api.services.admin.previewAppointmentTime, { serviceId, staffId, durationMin: 90, start: at('10:45') }))
			.resolves.toMatchObject({ problem: expect.stringContaining('full service and turnaround') });
		const create = (time: string, durationMin?: number) =>
			admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, durationMin, start: at(time) });
		const long = await create('09:00', 90);
		expect(await appointment(long.appointmentId)).toMatchObject({ end: at('10:30'), blockedUntil: at('10:45'), price: 110000 });
		const standard = await create('13:00');
		expect(await appointment(standard.appointmentId)).toMatchObject({ end: at('14:00'), blockedUntil: at('14:15'), price: 80000 });
		const arrived = await create('14:30', 90);
		const cancelled = await create('16:30');
		await t.run(async ctx => {
			await ctx.db.patch(arrived.appointmentId, { status: 'arrived' });
			await ctx.db.patch(cancelled.appointmentId, { status: 'cancelled' });
		});
		const usage = () => admin.query(api.services.admin.upcomingOptionUsage, { serviceId });
		expect(await usage()).toEqual([{ durationMin: 60, count: 1 }, { durationMin: 90, count: 2 }]);
		vi.setSystemTime(at('11:00'));
		expect(await usage()).toEqual([{ durationMin: 60, count: 1 }, { durationMin: 90, count: 1 }]);
		await expect(t.query(api.services.admin.upcomingOptionUsage, { serviceId })).rejects.toThrow('Not authenticated');
	});

	it('checks the reviewed terms when changing only the duration of an appointment', async () => {
		const { admin, serviceId, booking, appointment } = await setup();
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, options: durationOptions, defaultDurationMin: 60 });
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00') });
		const change = { appointmentId, expectedRevision: 0, serviceId, durationMin: 90, guestName: booking.guestName, guestPhone: booking.guestPhone };
		const expectedService = { ...durationOptions[1], bufferMin: 15, currency: 'THB' };
		const update = api.services.commands.updateAppointmentDetails.updateAppointmentDetails;
		await expect(admin.mutation(update, { ...change, expectedService: { ...expectedService, price: 80000 } }))
			.rejects.toThrow('changed since you reviewed');
		await admin.mutation(update, { ...change, expectedService });
		expect(await appointment(appointmentId)).toMatchObject({ serviceId, end: at('10:30'), blockedUntil: at('10:45'), price: 110000, revision: 1 });
	});
});

describe('admin services', () => {
	it.each([
		['', '', undefined],
		['  ', '  ', '  '],
		[' Ann ', '', undefined],
		['', ' +66111 ', undefined],
		['', '', ' ann@example.com '],
		[' Ann ', ' +66111 ', ' ann@example.com '],
	])('reserves an admin appointment with partial guest details (%j, %j, %j)', async (guestName, guestPhone, guestEmail) => {
		const { admin, booking, appointment } = await setup();
		const result = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName, guestPhone, guestEmail });
		expect(await appointment(result.appointmentId)).toMatchObject({ guestName: guestName.trim(), guestPhone: guestPhone.trim(), source: 'admin', status: 'booked' });
		expect((await appointment(result.appointmentId)).guestEmail).toBe(guestEmail?.trim() || undefined);
		expect(result.confirmationCode).toMatch(/^SVC-/);
		await expect(admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName: '', guestPhone: '' })).rejects.toThrow('That time was just taken');
	});

	it('adds and clears guest details later, preserving the slot and recording history', async () => {
		const { admin, booking, appointment, revision } = await setup();
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName: '', guestPhone: '' });
		await admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId, expectedRevision: 0, guestName: ' Ann ', guestPhone: ' +66111 ', guestEmail: 'ann@example.com' });
		await admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId, expectedRevision: await revision(appointmentId), guestName: ' ', guestPhone: ' ', guestEmail: '' });
		expect(await appointment(appointmentId)).toMatchObject({ guestName: '', guestPhone: '', start: at('09:00'), staffId: booking.staffId, serviceId: booking.serviceId });
		expect((await appointment(appointmentId)).guestEmail).toBeUndefined();
		const history = (await admin.query(api.services.admin.listAppointmentHistoryPage, { appointmentId, paginationOpts: { numItems: 100, cursor: null } })).page;
		expect(history).toHaveLength(3);
		expect(history[2]).toMatchObject({ actor: 'admin@example.com', changes: expect.arrayContaining([
			expect.objectContaining({ field: 'created', from: null }),
			{ field: 'effectiveAt', from: null, to: at('09:00') }
		]) });
		expect(history[0].changes).toEqual(expect.arrayContaining([{ field: 'guestName', from: 'Ann', to: '' }, { field: 'guestPhone', from: '+66111', to: '' }]));
	});

	it('cancels and rebooks anonymous appointments as linked, distinct records', async () => {
		const { admin, booking, appointment } = await setup();
		const original = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName: '', guestPhone: '' });
		await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId: original.appointmentId, expectedRevision: 0 });
		const rebooked = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName: '', guestPhone: '', rebookedFromId: original.appointmentId });
		expect(await appointment(rebooked.appointmentId)).toMatchObject({ guestName: '', guestPhone: '', rebookedFromId: original.appointmentId });
		expect(rebooked.appointmentId).not.toBe(original.appointmentId);
		expect(rebooked.confirmationCode).toMatch(/^SVC-/);
		expect((await appointment(original.appointmentId)).status).toBe('cancelled');
	});

	it('keeps shared appointment writes strict for chat sources and validates supplied emails', async () => {
		const { t, admin, booking } = await setup();
		await expect(t.run((ctx) => createAppointmentRecord(ctx, { ...booking, start: at('09:00'), source: 'whatsapp', guestName: '' }))).rejects.toThrow('Guest name is required');
		await expect(t.run((ctx) => createAppointmentRecord(ctx, { ...booking, start: at('09:00'), source: 'messenger', guestPhone: ' ' }))).rejects.toThrow('Guest phone is required');
		await expect(admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName: '', guestPhone: '', guestEmail: 'invalid' })).rejects.toThrow();
	});

	it('preserves contact details for chat-linked appointments when staff create or edit them', async () => {
		const { t, admin, booking } = await setup();
		const chatSessionId = await t.run((ctx) => ctx.db.insert('conversations', { channel: 'web', visitorId: 'visitor', createdAt: Date.now() }));
		await expect(admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), chatSessionId, guestName: '', guestPhone: '' })).rejects.toThrow('Guest name is required');
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), chatSessionId });
		await expect(admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId, expectedRevision: 0, guestName: 'Guest', guestPhone: '' })).rejects.toThrow('Guest phone is required');
	});

	it.each(['whatsapp', 'messenger'] as const)('keeps contact details required when admins edit %s appointments without a chat link', async (source) => {
		const { t, admin, booking, appointment } = await setup();
		const { appointmentId } = await t.run((ctx) => createAppointmentRecord(ctx, { ...booking, start: at('09:00'), source }));
		await expect(admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId, expectedRevision: 0, guestName: '', guestPhone: booking.guestPhone })).rejects.toThrow('Guest name is required');
		await expect(admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId, expectedRevision: 0, guestName: booking.guestName, guestPhone: '' })).rejects.toThrow('Guest phone is required');
		expect(await appointment(appointmentId)).toMatchObject({ guestName: booking.guestName, guestPhone: booking.guestPhone, source });
	});

	it('loads original appointment references only for authenticated admins', async () => {
		const { t, admin, booking } = await setup();
		const original = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00'), guestName: '', guestPhone: '' });
		expect(await admin.query(api.services.admin.getAppointmentReference, { appointmentId: original.appointmentId })).toBe(original.confirmationCode);
		await expect(t.query(api.services.admin.getAppointmentReference, { appointmentId: original.appointmentId })).rejects.toThrow('Not authenticated');
	});
	it('requires an admin for reads and writes', async () => {
		const { t, serviceId } = await setup();
		await expect(t.query(api.services.admin.listStaff, {})).rejects.toThrow('Not authenticated');
		await expect(t.query(api.services.admin.findOpenSlots, { serviceId, date })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.services.commands.createStaff.createStaff, { name: 'X', role: 'Y', color: '#fff', workingHours: [], breaks: [] })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ emailVerified: true, email: 'other@example.com', tokenIdentifier: 'other' });
		await expect(stranger.query(api.services.admin.listServices, {})).rejects.toThrow('Not authorized');
	});

	it('clears the staff photo when the URL is blank', async () => {
		const { t, admin, staffId } = await setup();
		const avatar = async () => (await t.run((ctx) => ctx.db.get(staffId)))?.avatarUrl;
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, avatarUrl: 'https://example.com/mali.jpg' });
		expect(await avatar()).toBe('https://example.com/mali.jpg');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, name: 'Mali K' }); // omitted: kept
		expect(await avatar()).toBe('https://example.com/mali.jpg');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, avatarUrl: ' ' });
		expect(await avatar()).toBeUndefined();
	});

	it('validates staff hours, services and time off', async () => {
		const { admin, staffId, serviceId } = await setup();
		await expect(admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: [{ weekday: 7, start: '09:00', end: '17:00' }] })).rejects.toThrow('Weekday');
		await expect(admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, breaks: [{ weekday: 1, start: '13:00', end: '12:00', label: 'Lunch' }] })).rejects.toThrow('Start must be before end');
		await expect(admin.mutation(api.services.commands.updateService.updateService, { serviceId, durationMin: 61 })).rejects.toThrow('multiple of 15');
		await expect(admin.mutation(api.services.commands.updateService.updateService, { serviceId, bufferMin: 7 })).rejects.toThrow('multiple of 5');
		await expect(admin.mutation(api.services.commands.updateService.updateService, { serviceId, price: -100 })).rejects.toThrow('Price');
		await expect(admin.mutation(api.services.commands.addTimeOff.addTimeOff, { staffId, start: at('09:00'), end: at('09:00') + 61 * 86_400_000, label: 'Leave' })).rejects.toThrow('60 days');
		await expect(admin.mutation(api.services.commands.createService.createService, {
			slug: 'thai-massage', name: 'Duplicate', description: '', category: 'Wellness',
			durationMin: 60, bufferMin: 0, price: 100, currency: 'THB', staffIds: [staffId]
		})).rejects.toThrow('slug already exists');
	});

	it('lists appointments and concrete break/time-off blocks', async () => {
		const { admin, staffId, booking } = await setup();
		const [{ timeOffId }] = await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
			staffId, start: at('09:00') - 2 * 86_400_000, end: at('10:00'), label: 'Training'
		});
		await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('14:00') });
		const schedule = await admin.query(api.services.admin.listSchedule, { from: at('09:00'), to: at('17:00'), staffIds: [staffId] });
		expect(schedule.staff).toHaveLength(1);
		expect(schedule.staff[0].workingHours).toHaveLength(7);
		expect(schedule.services).toHaveLength(1);
		expect(schedule.appointments).toHaveLength(1);
		expect(schedule.blocks).toContainEqual({
			staffId, start: at('12:00'), end: at('13:00'), label: 'Lunch', kind: 'break', date, override: false,
			original: { start: '12:00', end: '13:00', label: 'Lunch' },
			plan: { shifts: [{ start: '09:00', end: '18:00' }], breaks: [{ start: '12:00', end: '13:00', label: 'Lunch' }] }
		});
		expect(schedule.blocks).toContainEqual({ staffId, start: at('09:00'), end: at('10:00'), label: 'Training', kind: 'time_off', timeOff: expect.objectContaining({ _id: timeOffId, start: at('09:00') - 2 * 86_400_000 }) });
		await admin.mutation(api.services.commands.removeTimeOff.removeTimeOff, { timeOffId: timeOffId! });
		expect((await admin.query(api.services.admin.listSchedule, { from: at('09:00'), to: at('17:00') })).blocks.some((block) => block.kind === 'time_off')).toBe(false);
	});

	it('reschedules with conflict checks and enforces status transitions', async () => {
		const { admin, booking, staffId, revision, appointment } = await setup();
		const first = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00') });
		const second = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('13:00') });
		const move = { appointmentId: first.appointmentId, expectedRevision: 0, staffId };
		await expect(admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { ...move, start: at('09:00') })).rejects.toThrow('Nothing to change');
		await expect(admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { ...move, start: at('13:00') })).rejects.toThrow('That time was just taken');
		await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { ...move, start: at('15:00') });
		const schedule = await admin.query(api.services.admin.listSchedule, { from: at('09:00'), to: at('17:00') });
		expect(schedule.appointments.find((a) => a._id === first.appointmentId)).toMatchObject({ staffId, start: at('15:00') });
		await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId: first.appointmentId, status: 'arrived' });
		await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId: first.appointmentId, status: 'in_service' });
		await expect(admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId: first.appointmentId, expectedRevision: await revision(first.appointmentId) })).rejects.toThrow('cannot be cancelled');
		await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId: first.appointmentId, status: 'completed' });
		const completed = await appointment(first.appointmentId);
		await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { ...move, expectedRevision: await revision(first.appointmentId), start: at('16:00') });
		expect(await appointment(first.appointmentId)).toMatchObject({
			start: at('16:00'), status: 'completed', price: completed.price,
			paymentStatus: completed.paymentStatus, currency: completed.currency
		});
		await admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId: second.appointmentId });
		await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId: second.appointmentId, expectedRevision: 1 });
		await expect(admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId: second.appointmentId, status: 'arrived' })).rejects.toThrow('Invalid appointment status transition');
	});

	it('moves appointments without changing their length and refuses to archive staff with upcoming appointments', async () => {
		const { admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00') });
		await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { appointmentId, expectedRevision: 0, staffId, start: at('10:00') });
		const [appointment] = (await admin.query(api.services.admin.listSchedule, { from: at('09:00'), to: at('17:00') })).appointments;
		expect(appointment).toMatchObject({ start: at('10:00'), end: at('11:00'), blockedUntil: at('11:15') });
		await expect(admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { appointmentId, expectedRevision: 1, staffId, start: at('11:30') })).rejects.toThrow('That time was just taken'); // lunch
		await expect(admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId })).rejects.toThrow("Reassign or cancel Mali's 1 upcoming appointment first");
		expect(await admin.mutation(api.services.commands.addTimeOff.addTimeOff, { staffId, start: at('10:00'), end: at('11:00'), label: 'Leave' }))
			.toEqual([{ staffId, name: 'Mali', conflicts: [{ appointmentId, start: at('10:00') }] }]);
		await expect(admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId, status: 'no_show' })).rejects.toThrow('after the start time');
		await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId, expectedRevision: 1 });
		await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId });
	});

	it('refuses new hours that would leave booked appointments outside them', async () => {
		const { admin, booking, staffId } = await setup();
		await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('16:00') });
		const shorter = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '15:00' }));
		await expect(admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: shorter })).rejects.toThrow('outside the new hours');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, name: 'Mali K' }); // unrelated edits still save
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: weekdays.map((weekday) => ({ weekday, start: '10:00', end: '18:00' })) });
	});

	it.each(['arrived', 'in_service'] as const)('protects %s appointments from time off and shorter hours', async (status) => {
		const { t, admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('16:00') });
		await t.run((ctx) => ctx.db.patch(appointmentId, { status }));
		expect(await admin.mutation(api.services.commands.addTimeOff.addTimeOff, {
			staffId, start: at('16:00'), end: at('17:00'), label: 'Leave'
		})).toMatchObject([{ conflicts: [{ appointmentId }] }]);
		await expect(admin.mutation(api.services.commands.updateStaff.updateStaff, {
			staffId, workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '15:00' }))
		})).rejects.toThrow('outside the new hours');
	});

	it('archives staff out of services, rejects them on services and restores', async () => {
		const { admin, staffId, serviceId } = await setup();
		const nokId = await admin.mutation(api.services.commands.createStaff.createStaff, {
			name: 'Nok', role: 'Therapist', color: '#def', workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
		});
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, staffIds: [staffId, nokId] });
		expect(await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId: nokId })).toEqual({ servicesUpdated: 1 });
		expect((await admin.query(api.services.admin.listServices, {}))[0].staffIds).toEqual([staffId]);
		await expect(admin.mutation(api.services.commands.updateService.updateService, { serviceId, staffIds: [staffId, nokId] })).rejects.toThrow('Nok is archived');
		// Archiving through updateStaff takes the same path.
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, status: 'archived' });
		expect((await admin.query(api.services.admin.listServices, {}))[0].staffIds).toEqual([]);
		// A service with no active staff can be archived but not restored.
		expect(await admin.mutation(api.services.commands.archiveService.archiveService, { serviceId })).toEqual({ upcomingAppointments: 0 });
		await expect(admin.mutation(api.services.commands.updateService.updateService, { serviceId, status: 'active' })).rejects.toThrow('Assign at least one active staff member');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId: nokId, status: 'active' });
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, staffIds: [nokId], status: 'active' });
		expect(await admin.query(api.services.admin.listServices, {})).toMatchObject([{ status: 'active', staffIds: [nokId] }]);
		expect((await admin.query(api.services.admin.listStaff, {})).map((person) => person.name)).toEqual(['Nok']);
	});

	it('invalidates open service edits when staff assignments are archived or restored', async () => {
		const { admin, staffId, serviceId } = await setup();
		const current = async () => (await admin.query(api.services.admin.listServices, {}))[0];
		const revision = (await current()).revision ?? 0;
		await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId });
		const archived = await current();
		expect(archived).toMatchObject({ staffIds: [], revision: revision + 1 });
		await expect(admin.mutation(api.services.commands.updateService.updateService, {
			serviceId, staffIds: [staffId], expectedRevision: revision,
		})).rejects.toThrow('STALE_ADJUSTMENT_REVISION');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, status: 'active' });
		expect(await current()).toMatchObject({ staffIds: [staffId], revision: revision + 2 });
		await expect(admin.mutation(api.services.commands.updateService.updateService, {
			serviceId, name: 'Traditional massage', expectedRevision: archived.revision,
		})).rejects.toThrow('STALE_ADJUSTMENT_REVISION');
	});

	it('warns how many upcoming appointments stay booked when a service is archived', async () => {
		const { admin, booking, serviceId, staffId } = await setup();
		const kept = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00') });
		const cancelled = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('14:00') });
		await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId: cancelled.appointmentId, expectedRevision: 0 });
		expect(await admin.query(api.services.admin.countUpcomingAppointments, { serviceId })).toBe(1);
		expect(await admin.query(api.services.admin.countUpcomingAppointments, { staffId })).toBe(1);
		// D23: the archive guard's Open calendar lands on the earliest still-blocking appointment (cancelled ones excluded).
		expect(await admin.query(api.services.admin.firstUpcomingAppointment, { staffId })).toEqual({ appointmentId: kept.appointmentId, start: at('09:00') });
		expect(await admin.mutation(api.services.commands.archiveService.archiveService, { serviceId })).toEqual({ upcomingAppointments: 1 });
		const schedule = await admin.query(api.services.admin.listSchedule, { from: at('00:00'), to: at('23:00') });
		expect(schedule.appointments.find((a) => a._id === kept.appointmentId)).toMatchObject({ status: 'booked' });
	});

	it('keeps showing appointments of archived staff on the schedule', async () => {
		const { admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00') });
		await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId, status: 'completed' });
		vi.setSystemTime(at('12:00'));
		await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId });
		const schedule = await admin.query(api.services.admin.listSchedule, { from: at('00:00'), to: at('23:00') });
		expect(schedule.staff).toMatchObject([{ _id: staffId, status: 'archived' }]);
		expect(schedule.appointments.map((a) => a._id)).toEqual([appointmentId]);
		// Archived staff with nothing in range stay hidden.
		const nextDay = at('00:00') + 86_400_000;
		expect((await admin.query(api.services.admin.listSchedule, { from: nextDay, to: nextDay + 86_400_000 })).staff).toEqual([]);
	});

	it('edits time off with the same checks as adding it', async () => {
		const { admin, booking, staffId } = await setup();
		const timeOffId = (await admin.mutation(api.services.commands.addTimeOff.addTimeOff, { staffId, start: at('09:00'), end: at('11:00'), label: 'Doctor' }))[0].timeOffId!;
		await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('14:00') });
		await admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId, start: at('10:00'), end: at('12:00'), label: ' Dentist ' });
		expect((await admin.query(api.services.admin.listTimeOffPage, { staffId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).page).toMatchObject([{ _id: timeOffId, start: at('10:00'), end: at('12:00'), label: 'Dentist' }]);
		await expect(admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId, start: at('13:00'), end: at('15:00'), label: 'Dentist' })).rejects.toThrow('during this time off');
		await expect(admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId, start: at('10:00'), end: at('10:00') + 61 * 86_400_000, label: 'Leave' })).rejects.toThrow('60 days');
		await expect(admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId, start: at('10:00'), end: at('09:00'), label: 'Leave' })).rejects.toThrow('60 days');
		await expect(admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId, start: at('10:00'), end: at('11:00'), label: ' ' })).rejects.toThrow('Label is required');
		vi.setSystemTime(at('12:30'));
		expect((await admin.query(api.services.admin.listTimeOffPage, { staffId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).page).toEqual([]); // ended
	});

	it('edits appointment details, changes service and records refunds', async () => {
		const { admin, booking, staffId, revision } = await setup();
		const facialId = await admin.mutation(api.services.commands.createService.createService, {
			slug: 'facial', name: 'Facial', description: '', category: 'Wellness',
			durationMin: 90, bufferMin: 0, price: 300000, currency: 'THB', staffIds: [staffId]
		});
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('10:00') });
		const find = async () => (await admin.query(api.services.admin.listSchedule, { from: at('00:00'), to: at('23:00') })).appointments.find((a) => a._id === appointmentId);
		const edit = async (fields: { guestName: string; guestPhone: string; guestEmail?: string; notes?: string; serviceId?: Id<'services'> }, id = appointmentId) =>
			await admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId: id, expectedRevision: await revision(id), ...fields });

		await edit({ guestName: ' Ann ', guestPhone: '+66111', guestEmail: 'ann@example.com', notes: ' Allergic to lavender ' });
		expect(await find()).toMatchObject({ guestName: 'Ann', guestPhone: '+66111', guestEmail: 'ann@example.com', notes: 'Allergic to lavender' });
		await edit({ guestName: 'Ann', guestPhone: '+66111', guestEmail: '', notes: '' });
		const cleared = await find();
		expect(cleared?.guestEmail).toBeUndefined();
		expect(cleared?.notes).toBeUndefined();
		await edit({ guestName: ' ', guestPhone: '+66111' });
		expect(await find()).toMatchObject({ guestName: '', guestPhone: '+66111' });
		await expect(edit({ guestName: 'Ann', guestPhone: '+66111', guestEmail: 'nope' })).rejects.toThrow();

		await edit({ guestName: 'Ann', guestPhone: '+66111', serviceId: facialId });
		expect(await find()).toMatchObject({ serviceId: facialId, end: at('11:30'), blockedUntil: at('11:30'), price: 300000 });
		// 13:00 massage, then 14:15 massage: a 90-minute facial at 13:00 would overlap the second one.
		const later = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('13:00') });
		await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('14:15') });
		await expect(edit({ guestName: 'Guest', guestPhone: '+66000000000', serviceId: facialId }, later.appointmentId)).rejects.toThrow("Mali isn't free");
		const otherId = await admin.mutation(api.services.commands.createStaff.createStaff, {
			name: 'Nok', role: 'Therapist', color: '#def', workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
		});
		const nailsId = await admin.mutation(api.services.commands.createService.createService, {
			slug: 'nails', name: 'Nails', description: '', category: 'Beauty',
			durationMin: 30, bufferMin: 0, price: 50000, currency: 'THB', staffIds: [otherId]
		});
		await expect(edit({ guestName: 'Ann', guestPhone: '+66111', serviceId: nailsId })).rejects.toThrow("Mali doesn't perform Nails");

		await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId })).rejects.toThrow('Only paid appointments');
		await admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId });
		await expect(edit({ guestName: 'Ann', guestPhone: '+66111', serviceId: booking.serviceId })).rejects.toThrow('Paid appointments cannot change service');
		await admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId });
		expect(await find()).toMatchObject({ paymentStatus: 'refunded', refundedAt: Date.now() });
		await expect(admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId })).rejects.toThrow('Only paid appointments');
	});

	it('requires an admin for the new appointment and time-off mutations', async () => {
		const { t, admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('10:00') });
		const timeOffId = (await admin.mutation(api.services.commands.addTimeOff.addTimeOff, { staffId, start: at('15:00'), end: at('16:00'), label: 'Off' }))[0].timeOffId!;
		await expect(t.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId, start: at('15:00'), end: at('17:00'), label: 'Off' })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId, expectedRevision: 0, guestName: 'X', guestPhone: '1', serviceId: booking.serviceId })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.services.admin.listTimeOffPage, { staffId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.services.admin.countUpcomingAppointments, { staffId })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.services.admin.firstUpcomingAppointment, { staffId })).rejects.toThrow('Not authenticated');
	});

	it('adds time off for several staff, skipping those with booked appointments in the way', async () => {
		const { t, admin, booking, staffId } = await setup();
		const hours = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
		const nokId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Nok', role: 'Therapist', color: '#def', workingHours: hours, breaks: [] });
		const pimId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Pim', role: 'Therapist', color: '#fed', workingHours: hours, breaks: [] });
		const { appointmentId } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('10:00') });
		const range = { start: at('00:00'), end: at('00:00') + 86_400_000, label: ' Training ' };

		const results = await admin.mutation(api.services.commands.addTimeOff.addTimeOff, { ...range, staffIds: [staffId, nokId, pimId, nokId] });
		expect(results).toMatchObject([
			{ staffId, name: 'Mali', conflicts: [{ appointmentId, start: at('10:00') }] },
			{ staffId: nokId, name: 'Nok', timeOffId: expect.any(String), conflicts: [] },
			{ staffId: pimId, name: 'Pim', timeOffId: expect.any(String), conflicts: [] }
		]);
		expect(results[0].timeOffId).toBeUndefined();
		expect((await admin.query(api.services.admin.listTimeOffPage, { staffId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).page).toEqual([]);
		expect((await admin.query(api.services.admin.listTimeOffPage, { staffId: nokId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).page).toMatchObject([{ label: 'Training', start: range.start, end: range.end }]);
		expect((await admin.query(api.services.admin.listTimeOffPage, { staffId: pimId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).page).toHaveLength(1);

		// Whole-batch validation still throws and saves nothing.
		await expect(admin.mutation(api.services.commands.addTimeOff.addTimeOff, { ...range, staffIds: [] })).rejects.toThrow('at least one staff member');
		await expect(admin.mutation(api.services.commands.addTimeOff.addTimeOff, { ...range, staffIds: [pimId], label: ' ' })).rejects.toThrow('Label is required');
		await expect(admin.mutation(api.services.commands.addTimeOff.addTimeOff, { ...range, staffIds: [pimId], end: range.start })).rejects.toThrow('60 days');
		expect((await admin.query(api.services.admin.listTimeOffPage, { staffId: pimId, range: 'upcoming', paginationOpts: { numItems: 100, cursor: null } })).page).toHaveLength(1);
		await expect(t.mutation(api.services.commands.addTimeOff.addTimeOff, { ...range, staffIds: [pimId] })).rejects.toThrow('Not authenticated');
	});

	it('saves the services × staff matrix in one batch', async () => {
		const { t, admin, staffId, serviceId } = await setup();
		const hours = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
		const nokId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Nok', role: 'Therapist', color: '#def', workingHours: hours, breaks: [] });
		const nailsId = await admin.mutation(api.services.commands.createService.createService, {
			slug: 'nails', name: 'Nails', description: '', category: 'Beauty', durationMin: 30, bufferMin: 0, price: 50000, currency: 'THB', staffIds: [staffId]
		});
		const staffOf = async () => Object.fromEntries((await admin.query(api.services.admin.listServices, { includeArchived: true })).map((s) => [s.name, s.staffIds]));

		expect(await admin.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [
			{ serviceId, staffIds: [staffId, nokId] },
			{ serviceId: nailsId, staffIds: [staffId] } // unchanged
		] })).toEqual({ updated: 1 });
		expect(await staffOf()).toEqual({ 'Thai massage': [staffId, nokId], Nails: [staffId] });

		// Leaving an active service with no one refuses the whole batch.
		await expect(admin.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [
			{ serviceId, staffIds: [nokId] },
			{ serviceId: nailsId, staffIds: [] }
		] })).rejects.toThrow('Nails would have no staff');
		expect(await staffOf()).toEqual({ 'Thai massage': [staffId, nokId], Nails: [staffId] });

		await expect(admin.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [{ serviceId, staffIds: [nokId, nokId] }] })).rejects.toThrow('distinct');
		await expect(admin.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [{ serviceId, staffIds: [nokId] }, { serviceId, staffIds: [staffId] }] })).rejects.toThrow('only once');
		await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId: nokId });
		await expect(admin.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [{ serviceId, staffIds: [nokId] }] })).rejects.toThrow('Nok is archived');

		// Archived services may be emptied.
		await admin.mutation(api.services.commands.archiveService.archiveService, { serviceId: nailsId });
		expect(await admin.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [{ serviceId: nailsId, staffIds: [] }] })).toEqual({ updated: 1 });
		await expect(t.mutation(api.services.commands.setServiceStaffMatrix.setServiceStaffMatrix, { assignments: [] })).rejects.toThrow('Not authenticated');
	});

	it('previews the least-busy staff member for each open slot, matching auto-assignment', async () => {
		const { admin, booking, staffId, serviceId } = await setup();
		const hours = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
		const nokId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Nok', role: 'Therapist', color: '#def', workingHours: hours, breaks: [] });
		await admin.mutation(api.services.commands.updateService.updateService, { serviceId, staffIds: [staffId, nokId] });
		const slotAt = async (time: string) => (await admin.query(api.services.admin.findOpenSlots, { serviceId, date })).find((slot) => slot.start === at(time));

		// Tie on load: alphabetical, so Mali.
		expect(await slotAt('15:00')).toMatchObject({ autoStaffId: staffId });
		await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, start: at('09:00') });
		// Mali now has one appointment that day, so Nok is previewed and actually assigned.
		expect(await slotAt('15:00')).toMatchObject({ autoStaffId: nokId });
		const { staffId: assigned } = await admin.mutation(api.services.commands.createAppointment.createAppointment, { ...booking, staffId: undefined, start: at('15:00') });
		expect(assigned).toBe(nokId);
		// Only Nok is free at 12:00 (Mali's lunch).
		expect(await slotAt('12:00')).toMatchObject({ staffIds: [nokId], autoStaffId: nokId });
	});
});
