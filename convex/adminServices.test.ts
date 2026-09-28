// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { localDateTimeUtc } from './lib/serviceSlots';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const date = '2026-09-25';
const at = (time: string) => localDateTimeUtc(date, time);
const weekdays = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const staffId = await admin.mutation(api.adminServices.createStaff, {
		name: 'Mali', role: 'Therapist', color: '#abc',
		workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
		breaks: weekdays.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' }))
	});
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: 'Massage', category: 'Wellness',
		durationMin: 60, bufferMin: 15, price: 2000, currency: 'THB', staffIds: [staffId]
	});
	const booking = { serviceId, staffId, guestName: 'Guest', guestPhone: '+66000000000' };
	return { t, admin, staffId, serviceId, booking };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('admin services', () => {
	it('requires an admin for reads and writes', async () => {
		const { t, serviceId } = await setup();
		await expect(t.query(api.adminServices.listStaff, {})).rejects.toThrow('Not authenticated');
		await expect(t.query(api.adminServices.findOpenSlots, { serviceId, date })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.adminServices.createStaff, { name: 'X', role: 'Y', color: '#fff', workingHours: [], breaks: [] })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other' });
		await expect(stranger.query(api.adminServices.listServices, {})).rejects.toThrow('Not authorized');
	});

	it('validates staff hours, services and time off', async () => {
		const { admin, staffId, serviceId } = await setup();
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, workingHours: [{ weekday: 7, start: '09:00', end: '17:00' }] })).rejects.toThrow('Weekday');
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, breaks: [{ weekday: 1, start: '13:00', end: '12:00', label: 'Lunch' }] })).rejects.toThrow('Start must be before end');
		await expect(admin.mutation(api.adminServices.updateService, { serviceId, durationMin: 61 })).rejects.toThrow('multiple of 15');
		await expect(admin.mutation(api.adminServices.updateService, { serviceId, bufferMin: 7 })).rejects.toThrow('multiple of 5');
		await expect(admin.mutation(api.adminServices.updateService, { serviceId, price: -1 })).rejects.toThrow('Price');
		await expect(admin.mutation(api.adminServices.addTimeOff, { staffId, start: at('09:00'), end: at('09:00') + 61 * 86_400_000, label: 'Leave' })).rejects.toThrow('60 days');
		await expect(admin.mutation(api.adminServices.createService, {
			slug: 'thai-massage', name: 'Duplicate', description: '', category: 'Wellness',
			durationMin: 60, bufferMin: 0, price: 1, currency: 'THB', staffIds: [staffId]
		})).rejects.toThrow('slug already exists');
	});

	it('lists appointments and concrete break/time-off blocks', async () => {
		const { admin, staffId, booking } = await setup();
		const [{ timeOffId }] = await admin.mutation(api.adminServices.addTimeOff, {
			staffId, start: at('09:00') - 2 * 86_400_000, end: at('10:00'), label: 'Training'
		});
		await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('14:00') });
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('09:00'), to: at('17:00'), staffIds: [staffId] });
		expect(schedule.staff).toHaveLength(1);
		expect(schedule.staff[0].workingHours).toHaveLength(7);
		expect(schedule.services).toHaveLength(1);
		expect(schedule.appointments).toHaveLength(1);
		expect(schedule.blocks).toContainEqual({ staffId, start: at('12:00'), end: at('13:00'), label: 'Lunch', kind: 'break' });
		expect(schedule.blocks).toContainEqual({ staffId, start: at('09:00'), end: at('10:00'), label: 'Training', kind: 'time_off', timeOff: expect.objectContaining({ _id: timeOffId, start: at('09:00') - 2 * 86_400_000 }) });
		await admin.mutation(api.adminServices.removeTimeOff, { timeOffId: timeOffId! });
		expect((await admin.query(api.adminServices.listSchedule, { from: at('09:00'), to: at('17:00') })).blocks.some((block) => block.kind === 'time_off')).toBe(false);
	});

	it('reschedules with conflict checks and enforces status transitions', async () => {
		const { admin, booking, staffId } = await setup();
		const first = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		const second = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('13:00') });
		await admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId: first.appointmentId, start: at('09:00') });
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId: first.appointmentId, start: at('13:00') })).rejects.toThrow('That time was just taken');
		await admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId: first.appointmentId, start: at('15:00') });
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('09:00'), to: at('17:00') });
		expect(schedule.appointments.find((a) => a._id === first.appointmentId)).toMatchObject({ staffId, start: at('15:00') });
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: first.appointmentId, status: 'arrived' });
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: first.appointmentId, status: 'in_service' });
		await expect(admin.mutation(api.adminServices.cancelAppointment, { appointmentId: first.appointmentId })).rejects.toThrow('cannot be cancelled');
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: first.appointmentId, status: 'completed' });
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId: first.appointmentId, start: at('16:00') })).rejects.toThrow('cannot be rescheduled');
		await admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId: second.appointmentId });
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: second.appointmentId });
		await expect(admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: second.appointmentId, status: 'arrived' })).rejects.toThrow('Invalid appointment status transition');
	});

	it('seeds staff and services idempotently', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const t = convexTest(schema, modules);
		expect((await t.mutation(internal.seed.seedStaffServices, {})).appointmentsCreated).toBe(4);
		expect(await t.mutation(internal.seed.seedStaffServices, {})).toMatchObject({ staff: 5, services: 6, appointmentsCreated: 0 });
		const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
		expect(await admin.query(api.adminServices.listStaff, {})).toHaveLength(5);
		expect(await admin.query(api.adminServices.listServices, {})).toHaveLength(6);
	});

	it('resizes appointments and refuses to archive staff with upcoming appointments', async () => {
		const { admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		await admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId, start: at('09:00'), durationMin: 90 });
		const [appointment] = (await admin.query(api.adminServices.listSchedule, { from: at('09:00'), to: at('17:00') })).appointments;
		expect(appointment).toMatchObject({ end: at('10:30'), blockedUntil: at('10:45') });
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId, start: at('11:00'), durationMin: 90 })).rejects.toThrow('That time was just taken'); // lunch
		await expect(admin.mutation(api.adminServices.archiveStaff, { staffId })).rejects.toThrow("Reassign or cancel Mali's 1 upcoming appointment first");
		expect(await admin.mutation(api.adminServices.addTimeOff, { staffId, start: at('10:00'), end: at('11:00'), label: 'Leave' }))
			.toEqual([{ staffId, name: 'Mali', conflicts: [{ appointmentId, start: at('09:00') }] }]);
		await expect(admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId, status: 'no_show' })).rejects.toThrow('after the start time');
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId });
		await admin.mutation(api.adminServices.archiveStaff, { staffId });
	});

	it('refuses new hours that would leave booked appointments outside them', async () => {
		const { admin, booking, staffId } = await setup();
		await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('16:00') });
		const shorter = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '15:00' }));
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, workingHours: shorter })).rejects.toThrow('outside the new hours');
		await admin.mutation(api.adminServices.updateStaff, { staffId, name: 'Mali K' }); // unrelated edits still save
		await admin.mutation(api.adminServices.updateStaff, { staffId, workingHours: weekdays.map((weekday) => ({ weekday, start: '10:00', end: '18:00' })) });
	});

	it.each(['arrived', 'in_service'] as const)('protects %s appointments from time off and shorter hours', async (status) => {
		const { t, admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('16:00') });
		await t.run((ctx) => ctx.db.patch(appointmentId, { status }));
		expect(await admin.mutation(api.adminServices.addTimeOff, {
			staffId, start: at('16:00'), end: at('17:00'), label: 'Leave'
		})).toMatchObject([{ conflicts: [{ appointmentId }] }]);
		await expect(admin.mutation(api.adminServices.updateStaff, {
			staffId, workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '15:00' }))
		})).rejects.toThrow('outside the new hours');
	});

	it('archives staff out of services, rejects them on services and restores', async () => {
		const { admin, staffId, serviceId } = await setup();
		const nokId = await admin.mutation(api.adminServices.createStaff, {
			name: 'Nok', role: 'Therapist', color: '#def', workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
		});
		await admin.mutation(api.adminServices.updateService, { serviceId, staffIds: [staffId, nokId] });
		expect(await admin.mutation(api.adminServices.archiveStaff, { staffId: nokId })).toEqual({ servicesUpdated: 1 });
		expect((await admin.query(api.adminServices.listServices, {}))[0].staffIds).toEqual([staffId]);
		await expect(admin.mutation(api.adminServices.updateService, { serviceId, staffIds: [staffId, nokId] })).rejects.toThrow('Nok is archived');
		// Archiving through updateStaff takes the same path.
		await admin.mutation(api.adminServices.updateStaff, { staffId, status: 'archived' });
		expect((await admin.query(api.adminServices.listServices, {}))[0].staffIds).toEqual([]);
		// A service with no active staff can be archived but not restored.
		expect(await admin.mutation(api.adminServices.archiveService, { serviceId })).toEqual({ upcomingAppointments: 0 });
		await expect(admin.mutation(api.adminServices.updateService, { serviceId, status: 'active' })).rejects.toThrow('Assign at least one active staff member');
		await admin.mutation(api.adminServices.updateStaff, { staffId: nokId, status: 'active' });
		await admin.mutation(api.adminServices.updateService, { serviceId, staffIds: [nokId], status: 'active' });
		expect(await admin.query(api.adminServices.listServices, {})).toMatchObject([{ status: 'active', staffIds: [nokId] }]);
		expect((await admin.query(api.adminServices.listStaff, {})).map((person) => person.name)).toEqual(['Nok']);
	});

	it('warns how many upcoming appointments stay booked when a service is archived', async () => {
		const { admin, booking, serviceId, staffId } = await setup();
		const kept = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		const cancelled = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('14:00') });
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: cancelled.appointmentId });
		expect(await admin.query(api.adminServices.countUpcomingAppointments, { serviceId })).toBe(1);
		expect(await admin.query(api.adminServices.countUpcomingAppointments, { staffId })).toBe(1);
		expect(await admin.mutation(api.adminServices.archiveService, { serviceId })).toEqual({ upcomingAppointments: 1 });
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('00:00'), to: at('23:00') });
		expect(schedule.appointments.find((a) => a._id === kept.appointmentId)).toMatchObject({ status: 'booked' });
	});

	it('keeps showing appointments of archived staff on the schedule', async () => {
		const { admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId, status: 'completed' });
		vi.setSystemTime(at('12:00'));
		await admin.mutation(api.adminServices.archiveStaff, { staffId });
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('00:00'), to: at('23:00') });
		expect(schedule.staff).toMatchObject([{ _id: staffId, status: 'archived' }]);
		expect(schedule.appointments.map((a) => a._id)).toEqual([appointmentId]);
		// Archived staff with nothing in range stay hidden.
		const nextDay = at('00:00') + 86_400_000;
		expect((await admin.query(api.adminServices.listSchedule, { from: nextDay, to: nextDay + 86_400_000 })).staff).toEqual([]);
	});

	it('edits time off with the same checks as adding it', async () => {
		const { admin, booking, staffId } = await setup();
		const timeOffId = (await admin.mutation(api.adminServices.addTimeOff, { staffId, start: at('09:00'), end: at('11:00'), label: 'Doctor' }))[0].timeOffId!;
		await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('14:00') });
		await admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('10:00'), end: at('12:00'), label: ' Dentist ' });
		expect(await admin.query(api.adminServices.listTimeOff, { staffId })).toMatchObject([{ _id: timeOffId, start: at('10:00'), end: at('12:00'), label: 'Dentist' }]);
		await expect(admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('13:00'), end: at('15:00'), label: 'Dentist' })).rejects.toThrow('during this time off');
		await expect(admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('10:00'), end: at('10:00') + 61 * 86_400_000, label: 'Leave' })).rejects.toThrow('60 days');
		await expect(admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('10:00'), end: at('09:00'), label: 'Leave' })).rejects.toThrow('60 days');
		await expect(admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('10:00'), end: at('11:00'), label: ' ' })).rejects.toThrow('Label is required');
		vi.setSystemTime(at('12:30'));
		expect(await admin.query(api.adminServices.listTimeOff, { staffId })).toEqual([]); // ended
	});

	it('edits appointment details, changes service and records refunds', async () => {
		const { admin, booking, staffId } = await setup();
		const facialId = await admin.mutation(api.adminServices.createService, {
			slug: 'facial', name: 'Facial', description: '', category: 'Wellness',
			durationMin: 90, bufferMin: 0, price: 3000, currency: 'THB', staffIds: [staffId]
		});
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('10:00') });
		const find = async () => (await admin.query(api.adminServices.listSchedule, { from: at('00:00'), to: at('23:00') })).appointments.find((a) => a._id === appointmentId);

		await admin.mutation(api.adminServices.updateAppointmentDetails, { appointmentId, guestName: ' Ann ', guestPhone: '+66111', guestEmail: 'ann@example.com', notes: ' Allergic to lavender ' });
		expect(await find()).toMatchObject({ guestName: 'Ann', guestPhone: '+66111', guestEmail: 'ann@example.com', notes: 'Allergic to lavender' });
		await admin.mutation(api.adminServices.updateAppointmentDetails, { appointmentId, guestName: 'Ann', guestPhone: '+66111', guestEmail: '', notes: '' });
		const cleared = await find();
		expect(cleared?.guestEmail).toBeUndefined();
		expect(cleared?.notes).toBeUndefined();
		await expect(admin.mutation(api.adminServices.updateAppointmentDetails, { appointmentId, guestName: ' ', guestPhone: '+66111' })).rejects.toThrow('Guest name is required');
		await expect(admin.mutation(api.adminServices.updateAppointmentDetails, { appointmentId, guestName: 'Ann', guestPhone: '+66111', guestEmail: 'nope' })).rejects.toThrow();

		await admin.mutation(api.adminServices.changeAppointmentService, { appointmentId, serviceId: facialId });
		expect(await find()).toMatchObject({ serviceId: facialId, end: at('11:30'), blockedUntil: at('11:30'), price: 3000 });
		// 13:00 massage, then 14:15 massage: a 90-minute facial at 13:00 would overlap the second one.
		const later = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('13:00') });
		await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('14:15') });
		await expect(admin.mutation(api.adminServices.changeAppointmentService, { appointmentId: later.appointmentId, serviceId: facialId })).rejects.toThrow("Mali isn't free");
		const otherId = await admin.mutation(api.adminServices.createStaff, {
			name: 'Nok', role: 'Therapist', color: '#def', workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
		});
		const nailsId = await admin.mutation(api.adminServices.createService, {
			slug: 'nails', name: 'Nails', description: '', category: 'Beauty',
			durationMin: 30, bufferMin: 0, price: 500, currency: 'THB', staffIds: [otherId]
		});
		await expect(admin.mutation(api.adminServices.changeAppointmentService, { appointmentId, serviceId: nailsId })).rejects.toThrow("Mali doesn't perform Nails");

		await expect(admin.mutation(api.adminServices.refundAppointment, { appointmentId })).rejects.toThrow('Only paid appointments');
		await admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId });
		await expect(admin.mutation(api.adminServices.changeAppointmentService, { appointmentId, serviceId: booking.serviceId })).rejects.toThrow('Paid appointments cannot change service');
		await admin.mutation(api.adminServices.refundAppointment, { appointmentId });
		expect(await find()).toMatchObject({ paymentStatus: 'refunded', refundedAt: Date.now() });
		await expect(admin.mutation(api.adminServices.refundAppointment, { appointmentId })).rejects.toThrow('Only paid appointments');
	});

	it('requires an admin for the new appointment and time-off mutations', async () => {
		const { t, admin, booking, staffId } = await setup();
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('10:00') });
		const timeOffId = (await admin.mutation(api.adminServices.addTimeOff, { staffId, start: at('15:00'), end: at('16:00'), label: 'Off' }))[0].timeOffId!;
		await expect(t.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('15:00'), end: at('17:00'), label: 'Off' })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.adminServices.updateAppointmentDetails, { appointmentId, guestName: 'X', guestPhone: '1' })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.adminServices.changeAppointmentService, { appointmentId, serviceId: booking.serviceId })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.adminServices.refundAppointment, { appointmentId })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.adminServices.listTimeOff, { staffId })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.adminServices.countUpcomingAppointments, { staffId })).rejects.toThrow('Not authenticated');
	});

	it('adds time off for several staff, skipping those with booked appointments in the way', async () => {
		const { t, admin, booking, staffId } = await setup();
		const hours = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
		const nokId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#def', workingHours: hours, breaks: [] });
		const pimId = await admin.mutation(api.adminServices.createStaff, { name: 'Pim', role: 'Therapist', color: '#fed', workingHours: hours, breaks: [] });
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('10:00') });
		const range = { start: at('00:00'), end: at('00:00') + 86_400_000, label: ' Training ' };

		const results = await admin.mutation(api.adminServices.addTimeOff, { ...range, staffIds: [staffId, nokId, pimId, nokId] });
		expect(results).toMatchObject([
			{ staffId, name: 'Mali', conflicts: [{ appointmentId, start: at('10:00') }] },
			{ staffId: nokId, name: 'Nok', timeOffId: expect.any(String), conflicts: [] },
			{ staffId: pimId, name: 'Pim', timeOffId: expect.any(String), conflicts: [] }
		]);
		expect(results[0].timeOffId).toBeUndefined();
		expect(await admin.query(api.adminServices.listTimeOff, { staffId })).toEqual([]);
		expect(await admin.query(api.adminServices.listTimeOff, { staffId: nokId })).toMatchObject([{ label: 'Training', start: range.start, end: range.end }]);
		expect(await admin.query(api.adminServices.listTimeOff, { staffId: pimId })).toHaveLength(1);

		// Whole-batch validation still throws and saves nothing.
		await expect(admin.mutation(api.adminServices.addTimeOff, { ...range, staffIds: [] })).rejects.toThrow('at least one staff member');
		await expect(admin.mutation(api.adminServices.addTimeOff, { ...range, staffIds: [pimId], label: ' ' })).rejects.toThrow('Label is required');
		await expect(admin.mutation(api.adminServices.addTimeOff, { ...range, staffIds: [pimId], end: range.start })).rejects.toThrow('60 days');
		expect(await admin.query(api.adminServices.listTimeOff, { staffId: pimId })).toHaveLength(1);
		await expect(t.mutation(api.adminServices.addTimeOff, { ...range, staffIds: [pimId] })).rejects.toThrow('Not authenticated');
	});

	it('saves the services × staff matrix in one batch', async () => {
		const { t, admin, staffId, serviceId } = await setup();
		const hours = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
		const nokId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#def', workingHours: hours, breaks: [] });
		const nailsId = await admin.mutation(api.adminServices.createService, {
			slug: 'nails', name: 'Nails', description: '', category: 'Beauty', durationMin: 30, bufferMin: 0, price: 500, currency: 'THB', staffIds: [staffId]
		});
		const staffOf = async () => Object.fromEntries((await admin.query(api.adminServices.listServices, { includeArchived: true })).map((s) => [s.name, s.staffIds]));

		expect(await admin.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [
			{ serviceId, staffIds: [staffId, nokId] },
			{ serviceId: nailsId, staffIds: [staffId] } // unchanged
		] })).toEqual({ updated: 1 });
		expect(await staffOf()).toEqual({ 'Thai massage': [staffId, nokId], Nails: [staffId] });

		// Leaving an active service with no one refuses the whole batch.
		await expect(admin.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [
			{ serviceId, staffIds: [nokId] },
			{ serviceId: nailsId, staffIds: [] }
		] })).rejects.toThrow('Nails would have no staff');
		expect(await staffOf()).toEqual({ 'Thai massage': [staffId, nokId], Nails: [staffId] });

		await expect(admin.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [{ serviceId, staffIds: [nokId, nokId] }] })).rejects.toThrow('distinct');
		await expect(admin.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [{ serviceId, staffIds: [nokId] }, { serviceId, staffIds: [staffId] }] })).rejects.toThrow('only once');
		await admin.mutation(api.adminServices.archiveStaff, { staffId: nokId });
		await expect(admin.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [{ serviceId, staffIds: [nokId] }] })).rejects.toThrow('Nok is archived');

		// Archived services may be emptied.
		await admin.mutation(api.adminServices.archiveService, { serviceId: nailsId });
		expect(await admin.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [{ serviceId: nailsId, staffIds: [] }] })).toEqual({ updated: 1 });
		await expect(t.mutation(api.adminServices.setServiceStaffMatrix, { assignments: [] })).rejects.toThrow('Not authenticated');
	});

	it('previews the least-busy staff member for each open slot, matching auto-assignment', async () => {
		const { admin, booking, staffId, serviceId } = await setup();
		const hours = weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' }));
		const nokId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#def', workingHours: hours, breaks: [] });
		await admin.mutation(api.adminServices.updateService, { serviceId, staffIds: [staffId, nokId] });
		const slotAt = async (time: string) => (await admin.query(api.adminServices.findOpenSlots, { serviceId, date })).find((slot) => slot.start === at(time));

		// Tie on load: alphabetical, so Mali.
		expect(await slotAt('15:00')).toMatchObject({ autoStaffId: staffId });
		await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		// Mali now has one appointment that day, so Nok is previewed and actually assigned.
		expect(await slotAt('15:00')).toMatchObject({ autoStaffId: nokId });
		const { staffId: assigned } = await admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: undefined, start: at('15:00') });
		expect(assigned).toBe(nokId);
		// Only Nok is free at 12:00 (Mali's lunch).
		expect(await slotAt('12:00')).toMatchObject({ staffIds: [nokId], autoStaffId: nokId });
	});
});
