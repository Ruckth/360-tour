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
		const timeOffId = await admin.mutation(api.adminServices.addTimeOff, {
			staffId, start: at('09:00') - 2 * 86_400_000, end: at('10:00'), label: 'Training'
		});
		await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('14:00') });
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('09:00'), to: at('17:00'), staffIds: [staffId] });
		expect(schedule.staff).toHaveLength(1);
		expect(schedule.staff[0].workingHours).toHaveLength(7);
		expect(schedule.services).toHaveLength(1);
		expect(schedule.appointments).toHaveLength(1);
		expect(schedule.blocks).toContainEqual({ staffId, start: at('12:00'), end: at('13:00'), label: 'Lunch', kind: 'break' });
		expect(schedule.blocks).toContainEqual({ staffId, start: at('09:00'), end: at('10:00'), label: 'Training', kind: 'time_off', timeOffId });
		await admin.mutation(api.adminServices.removeTimeOff, { timeOffId });
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
		await expect(admin.mutation(api.adminServices.archiveStaff, { staffId })).rejects.toThrow('upcoming appointments');
		await expect(admin.mutation(api.adminServices.addTimeOff, { staffId, start: at('10:00'), end: at('11:00'), label: 'Leave' })).rejects.toThrow('during this time off');
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
});
