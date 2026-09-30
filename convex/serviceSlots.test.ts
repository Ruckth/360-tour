// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import { localDateTimeUtc, resortLocalParts } from './lib/serviceSlots';
import schema from './schema';

declare global {
	interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>> }
}

const modules = import.meta.glob('./**/*.ts');
const date = '2026-09-25';
const at = (time: string) => localDateTimeUtc(date, time);
const weekdays = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const staffIds = [];
	for (const name of ['Mali', 'Nok']) {
		staffIds.push(await admin.mutation(api.adminServices.createStaff, {
			name, role: 'Therapist', color: '#abc',
			workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
			breaks: weekdays.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' }))
		}));
	}
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: 'Massage', category: 'Wellness',
		durationMin: 60, bufferMin: 30, price: 2000, currency: 'THB', staffIds
	});
	const booking = { serviceId, guestName: 'Guest', guestPhone: '+66000000000' };
	return { t, admin, staffIds, serviceId, booking };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('service slots', () => {
	it('converts Bangkok local time and respects hours and lunch', async () => {
		expect(at('09:00')).toBe(Date.parse('2026-09-25T02:00:00.000Z'));
		expect(resortLocalParts(at('09:00'))).toMatchObject({ date, time: '09:00', weekday: 5 });
		expect(resortLocalParts(Date.parse('2026-09-25T06:00:00.000Z'))).toMatchObject({ date, time: '13:00' });
		expect(resortLocalParts(Date.parse('2026-09-24T20:30:00.000Z'))).toMatchObject({ date, time: '03:30', weekday: 5 });
		expect(at('24:00')).toBe(localDateTimeUtc('2026-09-26', '00:00'));
		expect(localDateTimeUtc('2026-12-31', '24:00')).toBe(localDateTimeUtc('2027-01-01', '00:00'));
		expect(resortLocalParts(Date.parse('2026-12-31T17:30:00.000Z'))).toEqual({ date: '2027-01-01', time: '00:30', weekday: 5 });
		expect(() => at('25:00')).toThrow('HH:mm');
		const { admin, serviceId, staffIds } = await setup();
		const slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: staffIds[0] });
		expect(slots.find((slot) => slot.start === at('09:00'))?.staffIds).toEqual([staffIds[0]]);
		expect(slots.some((slot) => slot.start === at('08:45'))).toBe(false);
		expect(slots.some((slot) => slot.start === at('11:00'))).toBe(false);
		expect(slots.some((slot) => slot.start === at('13:00'))).toBe(true);
		expect(slots.some((slot) => slot.start === at('15:45'))).toBe(false);
	});

	it('applies time off, appointment buffers, and cancellation immediately', async () => {
		const { admin, serviceId, staffIds, booking } = await setup();
		await admin.mutation(api.adminServices.addTimeOff, { staffId: staffIds[0], start: at('13:00'), end: at('14:00'), label: 'Training' });
		let slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: staffIds[0] });
		expect(slots.some((slot) => slot.start === at('13:00'))).toBe(false);
		const created = await admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: staffIds[0], start: at('09:00') });
		expect(created).toMatchObject({ staffId: staffIds[0] });
		expect(created.confirmationCode).toMatch(/^SVC-/);
		slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: staffIds[0] });
		expect(slots.some((slot) => slot.start === at('09:00'))).toBe(false);
		expect(slots.some((slot) => slot.start === at('10:15'))).toBe(false);
		await expect(admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: staffIds[0], start: at('09:15') }))
			.rejects.toThrow('That time was just taken');
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: created.appointmentId });
		slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: staffIds[0] });
		expect(slots.some((slot) => slot.start === at('09:00'))).toBe(true);
	});

	it('auto assigns a free qualified person with the fewest appointments', async () => {
		const { admin, staffIds, booking } = await setup();
		const first = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		expect(first.staffId).toBe(staffIds[0]); // stable name order
		const second = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') });
		expect(second.staffId).toBe(staffIds[1]); // Mali is busy
		const third = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('14:00') });
		expect(third.staffId).toBe(staffIds[0]); // tied counts, stable name order
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: second.appointmentId });
		const fourth = await admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('15:00') });
		expect(fourth.staffId).toBe(staffIds[1]); // fewer non-cancelled appointments
	});

	it('does not offer archived staff or services', async () => {
		const { admin, staffIds, serviceId, booking } = await setup();
		await admin.mutation(api.adminServices.archiveStaff, { staffId: staffIds[0] });
		await admin.mutation(api.adminServices.archiveStaff, { staffId: staffIds[1] });
		expect(await admin.query(api.adminServices.findOpenSlots, { serviceId, date })).toEqual([]);
		await expect(admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') })).rejects.toThrow('That time was just taken');
		await admin.mutation(api.adminServices.updateStaff, { staffId: staffIds[0], status: 'active' });
		await admin.mutation(api.adminServices.archiveService, { serviceId });
		expect(await admin.query(api.adminServices.findOpenSlots, { serviceId, date })).toEqual([]);
		await expect(admin.mutation(api.adminServices.createAppointment, { ...booking, start: at('09:00') })).rejects.toThrow('Service unavailable');
	});

	it('frees no-show time and rejects an unqualified requested staff member', async () => {
		const { admin, staffIds, serviceId, booking } = await setup();
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: staffIds[0], start: at('09:00') });
		vi.setSystemTime(at('09:05'));
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId, status: 'no_show' });
		const slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: staffIds[0] });
		expect(slots.some((slot) => slot.start === at('09:15'))).toBe(true);
		const other = await admin.mutation(api.adminServices.createStaff, { name: 'Chef', role: 'Chef', color: '#abc', workingHours: [], breaks: [] });
		await expect(admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: other, start: at('10:00') }))
			.rejects.toThrow('not available for this service');
	});

	it('uses a roster override instead of the weekly pattern, with its own breaks', async () => {
		const { t, admin, serviceId, staffIds } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.insert('staffDays', {
				staffId: staffIds[0], date, shifts: [{ start: '14:00', end: '22:00' }],
				breaks: [{ start: '18:00', end: '19:00', label: 'Dinner' }], updatedAt: Date.now()
			});
		});
		const slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: staffIds[0] });
		const has = (time: string) => slots.some((slot) => slot.start === at(time));
		expect(has('09:00')).toBe(false); // pattern hours no longer apply
		expect(has('13:00')).toBe(false); // pattern lunch is gone but it's before the shift
		expect(has('14:00')).toBe(true);
		expect(has('16:30')).toBe(true); // ends 17:30 + 30 min buffer = 18:00
		expect(has('16:45')).toBe(false); // runs into the override's dinner break
		expect(has('19:00')).toBe(true);
		expect(has('20:45')).toBe(false); // would end after the shift
		// Other dates keep the pattern.
		const nextDay = await admin.query(api.adminServices.findOpenSlots, { serviceId, date: '2026-09-26', staffId: staffIds[0] });
		expect(nextDay.some((slot) => slot.start === localDateTimeUtc('2026-09-26', '09:00'))).toBe(true);
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('00:00'), to: at('00:00') + 86_400_000, staffIds: [staffIds[0]] });
		expect(schedule.shifts).toEqual([{ staffId: staffIds[0], start: at('14:00'), end: at('22:00') }]);
		expect(schedule.blocks).toEqual([{ staffId: staffIds[0], start: at('18:00'), end: at('19:00'), label: 'Dinner', kind: 'break' }]);
	});

	it('treats an override with no shifts as a day off', async () => {
		const { t, admin, serviceId, staffIds, booking } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.insert('staffDays', { staffId: staffIds[0], date, shifts: [], breaks: [], updatedAt: Date.now() });
		});
		const slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date });
		expect(slots.length).toBeGreaterThan(0);
		expect(slots.every((slot) => !slot.staffIds.includes(staffIds[0]))).toBe(true);
		await expect(admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: staffIds[0], start: at('10:00') }))
			.rejects.toThrow('That time was just taken');
		// The pattern guard in updateStaff ignores dates that have an override.
		const created = await admin.mutation(api.adminServices.createAppointment, { ...booking, staffId: staffIds[1], start: at('10:00') });
		await t.run(async (ctx) => {
			await ctx.db.insert('staffDays', { staffId: staffIds[1], date, shifts: [{ start: '09:00', end: '17:00' }], breaks: [], updatedAt: Date.now() });
		});
		await admin.mutation(api.adminServices.updateStaff, { staffId: staffIds[1], workingHours: [], breaks: [] });
		await t.run(async (ctx) => {
			const row = await ctx.db.query('staffDays').withIndex('by_staff_date', (q) => q.eq('staffId', staffIds[1]).eq('date', date)).unique();
			await ctx.db.delete(row!._id);
		});
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId: staffIds[1], workingHours: weekdays.map((weekday) => ({ weekday, start: '12:00', end: '17:00' })) }))
			.rejects.toThrow('outside the new hours');
		expect(created.staffId).toBe(staffIds[1]);
	});

	it('blocks next-day slots with an appointment that runs past midnight', async () => {
		const { admin } = await setup();
		const staffId = await admin.mutation(api.adminServices.createStaff, {
			name: 'Kai', role: 'Driver', color: '#abc',
			workingHours: weekdays.map((weekday) => ({ weekday, start: '00:00', end: '24:00' })), breaks: []
		});
		const serviceId = await admin.mutation(api.adminServices.createService, {
			slug: 'transfer', name: 'Transfer', description: '', category: 'Arrival',
			durationMin: 60, bufferMin: 30, price: 1500, currency: 'THB', staffIds: [staffId]
		});
		await admin.mutation(api.adminServices.createAppointment, { serviceId, guestName: 'Guest', guestPhone: '+66000000000', start: at('23:00') });
		const slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date: '2026-09-26' });
		expect(slots[0].start).toBe(localDateTimeUtc('2026-09-26', '00:30'));
	});
});
