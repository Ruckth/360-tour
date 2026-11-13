import { bahtToSatang } from '../shared/money';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { writeBooking } from '../bookings/model';
import { demoCode } from '../lib/codes';
import { appointmentLookupFields, localDateTimeUtc } from '../services/model';
import { resortLocalParts } from '../shared/resortLocalParts';

/**
 * AI-EVAL test data: services, staff, approved business facts, and blocked dates
 * used to exercise the AI concierge. Every record is tagged so cleanup removes only these rows:
 * - staff: name ends with "[AI-EVAL]"; services: slug starts with "ai-eval-"
 * - businessFacts / staffTimeOff: AI_EVAL_EMAIL
 * - availability: source "manual" rows on AI_EVAL_BLOCKS dates only
 * - bookings / appointments made during tests: guest name contains "AI-EVAL"
 */
export const AI_EVAL_EMAIL = 'ai-eval-seed@test.local';
export const AI_EVAL_TAG = '[AI-EVAL]';
const SLUG_PREFIX = 'ai-eval-';
const OCCUPIED_PHONE = '+66000000000';
const DAY = 24 * 60 * 60 * 1000;
const everyDay = [0, 1, 2, 3, 4, 5, 6];

const staffSeeds = [
	{ key: 'nok', name: 'Nok', role: 'Massage therapist', color: '#D9908A', hours: ['09:00', '18:00'] },
	{ key: 'mali', name: 'Mali', role: 'Massage therapist', color: '#C69BC6', hours: ['10:00', '19:00'] },
	{ key: 'arun', name: 'Arun', role: 'Yoga instructor', color: '#8EAB8B', hours: ['06:30', '12:00'] },
	{ key: 'somchai', name: 'Somchai', role: 'Private chef', color: '#D6A36A', hours: ['15:00', '22:00'] },
	{ key: 'kai', name: 'Kai', role: 'Driver & guide', color: '#81A6B9', hours: ['07:00', '19:00'] }
] as const;

const serviceSeeds = [
	{ slug: 'thai-massage', name: 'Traditional Thai Massage', description: 'Classic 60-minute Thai massage in your villa or the garden sala.', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 1500, staff: ['nok', 'mali'] },
	{ slug: 'aroma-massage', name: 'Aromatherapy Oil Massage', description: '90-minute oil massage with coconut and lemongrass oils.', category: 'Wellness', durationMin: 90, bufferMin: 15, price: 2400, staff: ['nok', 'mali'] },
	{ slug: 'sunrise-yoga', name: 'Sunrise Yoga', description: 'Private beach or garden yoga session for up to 4 guests.', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 900, staff: ['arun'] },
	{ slug: 'chef-bbq', name: 'Private Chef Seafood BBQ', description: 'Seafood BBQ dinner cooked on your terrace, for up to 6 guests.', category: 'Dining', durationMin: 180, bufferMin: 30, price: 6500, staff: ['somchai'] },
	{ slug: 'island-tour', name: 'Island Day Tour', description: 'Private driver and guide around Koh Samui viewpoints, temples and waterfalls.', category: 'Exploration', durationMin: 240, bufferMin: 30, price: 4200, staff: ['kai'] }
] as const;

const answerSeeds = [
	{
		title: 'Check-in and check-out times',
		answer: 'Check-in is from 2:00 PM and check-out is by 11:00 AM (Koh Samui time). Direct bookings get a free late check-out until 2:00 PM, subject to availability. Early check-in can be arranged if the villa is ready — just let us know your arrival time.',
		questions: ['What time is check-in?', 'What time is check in?', 'When is check-in?', 'What are the check-in and check-out times?', 'What time is check-out?', 'Check-in time', 'เช็คอินกี่โมง', '체크인 시간이 언제예요?']
	},
	{
		title: 'Pet policy',
		answer: 'Pets are not allowed in the villas, with the exception of registered assistance animals. Please tell us in advance if you are travelling with an assistance animal so we can prepare.',
		questions: ['Do you allow pets?', 'Are pets allowed?', 'Can I bring my dog?', 'Is the villa pet friendly?', 'Pet policy']
	},
	{
		title: 'Cancellation policy',
		answer: 'Free cancellation up to 48 hours before check-in. Cancellations within 48 hours of arrival, or no-shows, are charged the first night. Unpaid chat bookings expire automatically after 24 hours.',
		questions: ['Can I cancel for free?', 'What if I need to cancel?', 'How do I cancel my booking?']
	},
	{
		title: 'Breakfast',
		answer: 'Breakfast is not included in the nightly rate. A Thai or Western breakfast can be served in your villa for ฿450 per person — order by 8:00 PM the evening before.',
		questions: ['Is breakfast included?', 'Do you serve breakfast?', 'How much is breakfast?']
	},
	{
		title: 'Wi-Fi, parking and smoking',
		answer: 'All villas have free high-speed Wi-Fi and free private parking. Smoking is only allowed on outdoor terraces; a ฿5,000 cleaning fee applies for smoking indoors.',
		questions: ['Is there free WiFi?', 'Is there parking?', 'Can I smoke in the villa?']
	}
] as const;



function datesBetween(from: string, to: string) {
	const out: string[] = [];
	for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += DAY) {
		out.push(new Date(t).toISOString().slice(0, 10));
	}
	return out;
}

async function aiEvalStaff(ctx: MutationCtx) {
	return (await ctx.db.query('staff').take(500)).filter((row) => row.name.endsWith(AI_EVAL_TAG));
}

async function aiEvalServices(ctx: MutationCtx) {
	return (await ctx.db.query('services').take(500)).filter((row) => row.slug.startsWith(SLUG_PREFIX));
}

async function propertyBySlug(ctx: MutationCtx, slug: string) {
	return await ctx.db.query('properties').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
}

export async function seedAiEvalData(ctx: MutationCtx) {
	const now = Date.now();
	const counts = { staff: 0, services: 0, timeOff: 0, occupiedAppointments: 0, facts: 0, blockedDates: 0 };

	const existingStaff = await aiEvalStaff(ctx);
	const staffIds: Record<string, Id<'staff'>> = {};
	for (const seed of staffSeeds) {
		const name = `${seed.name} ${AI_EVAL_TAG}`;
		const found = existingStaff.find((row) => row.name === name);
		staffIds[seed.key] = found?._id ?? await ctx.db.insert('staff', {
			name, role: seed.role, color: seed.color, status: 'active',
			workingHours: everyDay.map((weekday) => ({ weekday, start: seed.hours[0], end: seed.hours[1] })),
			breaks: seed.key === 'arun' ? [] : everyDay.map((weekday) => ({ weekday, start: seed.key === 'somchai' ? '18:00' : '12:00', end: seed.key === 'somchai' ? '18:30' : '13:00', label: 'Break' })),
			createdAt: now, updatedAt: now
		});
		if (!found) counts.staff++;
	}

	const serviceIds: Record<string, Id<'services'>> = {};
	for (const seed of serviceSeeds) {
		const slug = `${SLUG_PREFIX}${seed.slug}`;
		const found = await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
		serviceIds[seed.slug] = found?._id ?? await ctx.db.insert('services', {
			slug, name: seed.name, description: seed.description, category: seed.category,
			durationMin: seed.durationMin, bufferMin: seed.bufferMin, price: bahtToSatang(seed.price), currency: 'THB',
			staffIds: seed.staff.map((key) => staffIds[key]), status: 'active', createdAt: now, updatedAt: now
		});
		if (!found) counts.services++;
	}

	// Tomorrow: Mali is off in the morning and Nok already has a 10:00 massage, so 10:00 is fully taken.
	const tomorrow = resortLocalParts(now + DAY).date;
	const maliOff = await ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) => q.eq('staffId', staffIds.mali)).take(50);
	if (!maliOff.some((row) => row.createdByAdminEmail === AI_EVAL_EMAIL && resortLocalParts(row.start).date === tomorrow)) {
		await ctx.db.insert('staffTimeOff', {
			staffId: staffIds.mali, start: localDateTimeUtc(tomorrow, '10:00'), end: localDateTimeUtc(tomorrow, '14:00'),
			label: `${AI_EVAL_TAG} Personal leave`, createdByAdminEmail: AI_EVAL_EMAIL
		});
		counts.timeOff++;
	}
	for (const slot of [{ staff: 'nok', time: '10:00' }, { staff: 'nok', time: '15:00' }] as const) {
		const start = localDateTimeUtc(tomorrow, slot.time);
		if (await ctx.db.query('appointments').withIndex('by_staff_start', (q) => q.eq('staffId', staffIds[slot.staff]).eq('start', start)).first()) continue;
		const id = await ctx.db.insert('appointments', {
			serviceId: serviceIds['thai-massage'], staffId: staffIds[slot.staff], start,
			end: start + 60 * 60_000, blockedUntil: start + 75 * 60_000,
			guestName: `${AI_EVAL_TAG} Occupied slot`, guestPhone: OCCUPIED_PHONE, guestPhoneDigits: appointmentLookupFields({ guestPhone: OCCUPIED_PHONE }).guestPhoneDigits, source: 'admin',
			serviceNameSnapshot: 'Traditional Thai Massage', staffNameSnapshot: slot.staff, createdBy: AI_EVAL_EMAIL, amountPaid: 0, amountRefunded: 0, status: 'booked', paymentStatus: 'unpaid', price: 150000, currency: 'THB',
			confirmationCode: '', accessToken: crypto.randomUUID(), createdAt: now
		});
		await ctx.db.patch(id, { confirmationCode: demoCode('SVC', id) });
		counts.occupiedAppointments++;
	}

 const existingFacts = await ctx.db.query('businessFacts').withIndex('by_status_and_updatedAt', q => q.eq('status', 'approved')).take(1000);
 for (const seed of answerSeeds) {
  if (existingFacts.some(row => row.title === AI_EVAL_TAG + ' ' + seed.title)) continue;
  await ctx.db.insert('businessFacts', { title: AI_EVAL_TAG + ' ' + seed.title, body: seed.answer, searchText: seed.title + ' ' + seed.answer, source: 'AI-EVAL fixture', status: 'approved', revision: 1, createdAt: now, updatedAt: now, createdByAdminEmail: AI_EVAL_EMAIL, updatedByAdminEmail: AI_EVAL_EMAIL });
  counts.facts++;
 }
	for (const block of AI_EVAL_BLOCKS) {
		const property = await propertyBySlug(ctx, block.propertySlug);
		if (!property) continue;
		for (const date of datesBetween(block.from, block.to)) {
			const row = await ctx.db.query('availability').withIndex('by_property_date', (q) => q.eq('propertyId', property._id).eq('date', date)).first();
			if (row) continue; // never overwrite real inventory
			await ctx.db.insert('availability', { propertyId: property._id, date, status: 'blocked', source: 'manual' });
			counts.blockedDates++;
		}
	}

	return { tomorrow, ...counts };
}

/** Cancels pending bookings/appointments created by AI-EVAL test guests (keeps them for review). */
export async function cancelAiEvalBookings(ctx: MutationCtx) {
	let bookings = 0;
	let appointments = 0;
	for (const booking of await ctx.db.query('bookings').order('desc').take(1000)) {
		if (!booking.guestName.includes('AI-EVAL') || booking.status === 'cancelled') continue;
		if (booking.paymentStatus === 'paid') continue; // never touch paid bookings
		await writeBooking(ctx, booking, { status: 'cancelled' }, { actor: AI_EVAL_EMAIL, kind: 'cancelled' });
		bookings++;
	}
	const services = new Set((await aiEvalServices(ctx)).map((row) => row._id));
	for (const appointment of await ctx.db.query('appointments').order('desc').take(1000)) {
		const tagged = appointment.guestName.includes('AI-EVAL') || services.has(appointment.serviceId);
		if (!tagged || appointment.status !== 'booked' || appointment.guestPhone === OCCUPIED_PHONE) continue;
		await ctx.db.patch(appointment._id, { status: 'cancelled' });
		appointments++;
	}
	return { bookingsCancelled: bookings, appointmentsCancelled: appointments };
}

/** Removes every AI-EVAL seed record. Test bookings are cancelled (not deleted). */
export async function cleanupAiEvalData(ctx: MutationCtx) {
	const cancelled = await cancelAiEvalBookings(ctx);
	const removed = { staff: 0, services: 0, timeOff: 0, appointments: 0, facts: 0, blockedDates: 0 };
	const services = await aiEvalServices(ctx);
	const serviceIds = new Set(services.map((row) => row._id));
	for (const appointment of await ctx.db.query('appointments').take(2000)) {
		if (!serviceIds.has(appointment.serviceId)) continue;
		await ctx.db.delete(appointment._id);
		removed.appointments++;
	}
	for (const service of services) {
		await ctx.db.delete(service._id);
		removed.services++;
	}
	for (const person of await aiEvalStaff(ctx)) {
		for (const off of await ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) => q.eq('staffId', person._id)).take(200)) {
			await ctx.db.delete(off._id);
			removed.timeOff++;
		}
		await ctx.db.delete(person._id);
		removed.staff++;
	}
 for (const fact of await ctx.db.query('businessFacts').withIndex('by_status_and_updatedAt', q => q.eq('status', 'approved')).take(1000)) if (fact.createdByAdminEmail === AI_EVAL_EMAIL) { await ctx.db.delete(fact._id); removed.facts++; }
	for (const block of AI_EVAL_BLOCKS) {
		const property = await propertyBySlug(ctx, block.propertySlug);
		if (!property) continue;
		const rows = await ctx.db.query('availability').withIndex('by_property_date', (q) =>
			q.eq('propertyId', property._id).gte('date', block.from).lt('date', block.to)).take(100);
		for (const row of rows) {
			if (row.source !== 'manual' || row.status !== 'blocked' || row.bookingId || row.icalSourceId) continue;
			await ctx.db.delete(row._id);
			removed.blockedDates++;
		}
	}
	return { ...cancelled, removed };
}

export const AI_EVAL_BLOCKS = [
	{ propertySlug: 'pool-villa', from: '2026-10-09', to: '2026-10-16' },
	{ propertySlug: 'garden-suite', from: '2026-10-02', to: '2026-10-05' },
	{ propertySlug: 'penthouse', from: '2026-10-23', to: '2026-10-26' }
] as const;
