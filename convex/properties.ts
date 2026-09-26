import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';

const otaPlatform = v.union(v.literal('booking_com'), v.literal('agoda'), v.literal('airbnb'), v.literal('expedia'));
const MAX_NIGHTLY_RATE = 10_000_000;

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.take(100);
	}
});

export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();
	}
});

export const getById = query({
	args: { id: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

export const getRooms = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('rooms')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(50);
	}
});

/** Public room content for the guest tour. */
export const getTourRooms = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const property = await ctx.db.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug)).unique();
		if (!property || property.status !== 'active') return null;
		const rooms = await ctx.db.query('rooms')
			.withIndex('by_property', (q) => q.eq('propertyId', property._id)).take(50);
		return rooms.map(({ slug, name, imagePath }) => ({ slug, name, imagePath }));
	}
});

/** Public: live direct pricing plus owner-entered OTA rates for an active villa. */
export const getOtaComparison = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const property = await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();
		if (!property || property.status !== 'active') return null;
		const rates = await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', property._id))
			.take(10);
		return {
			currency: property.currency,
			pricePerNight: property.pricePerNight,
			directDiscountPercent: property.directDiscountPercent,
			rates: rates.map(({ platform, nightlyRate, url, updatedAt }) => ({ platform, nightlyRate, url, updatedAt }))
		};
	}
});

export const listOtaRates = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', args.propertyId))
			.take(10);
	}
});

export const upsertOtaRate = mutation({
	args: { propertyId: v.id('properties'), platform: otaPlatform, nightlyRate: v.number(), url: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.propertyId))) throw new Error('Property not found');
		if (!Number.isFinite(args.nightlyRate) || args.nightlyRate <= 0 || args.nightlyRate > MAX_NIGHTLY_RATE) {
			throw new Error('Nightly rate must be a positive amount');
		}
		const fields = {
			nightlyRate: Math.round(args.nightlyRate),
			url: args.url?.trim() ? publicHttpsUrl(args.url.trim()) : undefined,
			updatedAt: Date.now()
		};
		const existing = await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', args.propertyId).eq('platform', args.platform))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, fields);
			return existing._id;
		}
		return await ctx.db.insert('otaRates', { propertyId: args.propertyId, platform: args.platform, ...fields });
	}
});

export const removeOtaRate = mutation({
	args: { rateId: v.id('otaRates') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (await ctx.db.get(args.rateId)) await ctx.db.delete(args.rateId);
	}
});

function publicHttpsUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Listing URL must be a valid HTTPS link');
	}
	if (url.protocol !== 'https:' || url.username || url.password || value.length > 500) {
		throw new Error('Listing URL must be a valid HTTPS link');
	}
	return url.toString();
}

export const getSocialProof = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('socialProof')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.first();
	}
});

export const getReviews = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('reviews')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(100);
	}
});

export const getRecentBookings = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('recentBookingDisplay')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(50);
	}
});

export const getAllRecentBookings = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('recentBookingDisplay').take(100);
	}
});

export const getTourSnippets = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('tourSnippets')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(100);
	}
});

// Admin editing. Properties and rooms are never deleted because bookings reference
// them. Draft and archived villas are excluded from live booking and chat queries.

const propertyStatus = v.union(v.literal('active'), v.literal('draft'), v.literal('archived'));
function required(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

function amount(value: number, label: string, { integer = false, min = 0, max = Infinity } = {}): number {
	if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
		const range = max === Infinity ? `at least ${min}` : `between ${min} and ${max}`;
		throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}${range}`);
	}
	return value;
}

function textList(values: string[], label: string, maxItems: number): string[] {
	const trimmed = values.map((value) => value.trim()).filter(Boolean);
	if (trimmed.length > maxItems) throw new Error(`${label}: at most ${maxItems} items`);
	return trimmed;
}

function imageUrl(value: string): string {
	if (!/^(https:\/\/|\/(?!\/))\S+$/.test(value)) throw new Error('Images must be https:// URLs or /public paths');
	return value;
}

export const adminList = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return await ctx.db.query('properties').take(100);
	}
});

export const adminGet = query({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const property = await ctx.db.get(args.propertyId);
		if (!property) return null;
		const rooms = await ctx.db.query('rooms').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).take(50);
		return { property, rooms };
	}
});

export const update = mutation({
	args: {
		propertyId: v.id('properties'),
		name: v.optional(v.string()),
		tagline: v.optional(v.string()),
		description: v.optional(v.string()),
		pricePerNight: v.optional(v.number()),
		currency: v.optional(v.string()),
		maxGuests: v.optional(v.number()),
		bedrooms: v.optional(v.number()),
		bathrooms: v.optional(v.number()),
		area: v.optional(v.number()),
		amenities: v.optional(v.array(v.string())),
		images: v.optional(v.array(v.string())),
		directDiscountPercent: v.optional(v.number()),
		status: v.optional(propertyStatus)
	},
	handler: async (ctx, { propertyId, ...args }) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(propertyId))) throw new Error('Property not found');
		const changes: Partial<Doc<'properties'>> = {};
		if (args.name !== undefined) changes.name = required(args.name, 'Name');
		if (args.tagline !== undefined) changes.tagline = args.tagline.trim();
		if (args.description !== undefined) changes.description = args.description.trim();
		if (args.pricePerNight !== undefined) changes.pricePerNight = amount(args.pricePerNight, 'Price per night');
		if (args.currency !== undefined) {
			changes.currency = args.currency.trim().toUpperCase();
			if (!/^[A-Z]{3}$/.test(changes.currency)) throw new Error('Currency must be a 3-letter code');
		}
		if (args.maxGuests !== undefined) changes.maxGuests = amount(args.maxGuests, 'Max guests', { integer: true, min: 1 });
		if (args.bedrooms !== undefined) changes.bedrooms = amount(args.bedrooms, 'Bedrooms', { integer: true });
		if (args.bathrooms !== undefined) changes.bathrooms = amount(args.bathrooms, 'Bathrooms');
		if (args.area !== undefined) changes.area = amount(args.area, 'Area');
		if (args.amenities !== undefined) changes.amenities = textList(args.amenities, 'Amenities', 100);
		if (args.images !== undefined) changes.images = textList(args.images, 'Images', 30).map(imageUrl);
		if (args.directDiscountPercent !== undefined) {
			changes.directDiscountPercent = amount(args.directDiscountPercent, 'Direct discount', { max: 100 });
		}
		if (args.status !== undefined) changes.status = args.status;
		await ctx.db.patch(propertyId, changes);
	}
});

export const updateRoom = mutation({
	args: { roomId: v.id('rooms'), name: v.optional(v.string()), imagePath: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.roomId))) throw new Error('Room not found');
		await ctx.db.patch(args.roomId, {
			...(args.name !== undefined ? { name: required(args.name, 'Room name') } : {}),
			...(args.imagePath !== undefined ? { imagePath: imageUrl(required(args.imagePath, 'Room image')) } : {})
		});
	}
});
