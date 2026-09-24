import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { demoCode } from '../lib/codes';
import { localDateTimeUtc, resortLocalParts, staffBusyRanges } from '../lib/serviceSlots';

const days = [0, 1, 2, 3, 4, 5, 6];
const staffSeeds = [
	{ name: 'Nok', role: 'Massage therapist', color: '#D9908A', hours: ['09:00', '18:00'] },
	{ name: 'Mali', role: 'Massage therapist', color: '#C69BC6', hours: ['09:00', '18:00'] },
	{ name: 'Arun', role: 'Yoga instructor', color: '#8EAB8B', hours: ['07:00', '17:00'] },
	{ name: 'Somchai', role: 'Private chef', color: '#D6A36A', hours: ['12:00', '22:00'] },
	{ name: 'Kai', role: 'Driver', color: '#81A6B9', hours: ['06:00', '22:00'] }
] as const;

export async function seedStaffServicesData(ctx: MutationCtx) {
	const now = Date.now();
	const staffIds: Id<'staff'>[] = [];
	for (const seed of staffSeeds) {
		let staff = (await ctx.db.query('staff').take(100)).find((row) => row.name === seed.name && row.role === seed.role);
		if (!staff) {
			const id = await ctx.db.insert('staff', {
				name: seed.name, role: seed.role, color: seed.color, status: 'active',
				workingHours: days.map((weekday) => ({ weekday, start: seed.hours[0], end: seed.hours[1] })),
				breaks: days.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' })),
				createdAt: now, updatedAt: now
			});
			staff = await ctx.db.get(id) ?? undefined;
		}
		if (!staff) throw new Error('Could not seed staff');
		staffIds.push(staff._id);
	}
	const serviceSeeds = [
		{ slug: 'thai-massage', name: 'Traditional Thai Massage', description: 'Restorative Thai massage in your villa.', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 2400, staff: [0, 1] },
		{ slug: 'aromatherapy', name: 'Aromatherapy Massage', description: 'A calming oil massage with local botanicals.', category: 'Wellness', durationMin: 90, bufferMin: 15, price: 3200, staff: [0, 1] },
		{ slug: 'private-yoga', name: 'Private Yoga', description: 'A personal yoga session in the garden or on the beach.', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 1800, staff: [2] },
		{ slug: 'private-chef-dinner', name: 'Private Chef Dinner', description: 'A tailored Thai dinner prepared in your villa.', category: 'Dining', durationMin: 180, bufferMin: 30, price: 8500, staff: [3] },
		{ slug: 'airport-transfer', name: 'Airport Transfer', description: 'Private transfer to or from Samui airport.', category: 'Arrival', durationMin: 60, bufferMin: 30, price: 1500, staff: [4] },
		{ slug: 'island-day-tour', name: 'Island Day Tour', description: 'A private driving tour of Samui highlights.', category: 'Exploration', durationMin: 240, bufferMin: 30, price: 4800, staff: [4] }
	] as const;
	const serviceIds: Id<'services'>[] = [];
	for (const seed of serviceSeeds) {
		let service = await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', seed.slug)).first();
		if (!service) {
			const id = await ctx.db.insert('services', {
				slug: seed.slug, name: seed.name, description: seed.description, category: seed.category,
				durationMin: seed.durationMin, bufferMin: seed.bufferMin, price: seed.price, currency: 'THB',
				staffIds: seed.staff.map((index) => staffIds[index]), status: 'active', createdAt: now, updatedAt: now
			});
			service = await ctx.db.get(id);
		}
		if (!service) throw new Error('Could not seed service');
		serviceIds.push(service._id);
	}
	const date = resortLocalParts(now).date;
	const samples = [
		{ service: 0, staff: 0, time: '09:00', guestName: 'Emma Wilson', guestPhone: '+66810001001' },
		{ service: 2, staff: 2, time: '10:00', guestName: 'Daniel Lee', guestPhone: '+66810001002' },
		{ service: 3, staff: 3, time: '18:00', guestName: 'Sofia Martin', guestPhone: '+66810001003' },
		{ service: 4, staff: 4, time: '14:00', guestName: 'Ravi Patel', guestPhone: '+66810001004' }
	] as const;
	let appointmentsCreated = 0;
	for (const sample of samples) {
		const start = localDateTimeUtc(date, sample.time);
		const staffId = staffIds[sample.staff];
		const seededBefore = await ctx.db.query('serviceAppointments').withIndex('by_guestPhone', (q) => q.eq('guestPhone', sample.guestPhone)).first();
		if (seededBefore) continue;
		const existing = await ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) => q.eq('staffId', staffId).eq('start', start)).first();
		if (existing) continue;
		const service = serviceSeeds[sample.service];
		const person = await ctx.db.get(staffId);
		if (!person || (await staffBusyRanges(ctx, person, start, start + (service.durationMin + service.bufferMin) * 60_000)).length) continue;
		const id = await ctx.db.insert('serviceAppointments', {
			serviceId: serviceIds[sample.service], staffId, start,
			end: start + service.durationMin * 60_000,
			blockedUntil: start + (service.durationMin + service.bufferMin) * 60_000,
			guestName: sample.guestName, guestPhone: sample.guestPhone, source: 'admin',
			status: 'booked', paymentStatus: 'unpaid', price: service.price, currency: 'THB',
			confirmationCode: '', accessToken: crypto.randomUUID(), createdAt: now
		});
		await ctx.db.patch(id, { confirmationCode: demoCode('SVC', id) });
		appointmentsCreated++;
	}
	return { staff: staffIds.length, services: serviceIds.length, appointmentsCreated };
}
