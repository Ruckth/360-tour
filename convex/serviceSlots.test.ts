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
});
