import { propertiesListResult, propertiesGetBySlugResult, propertiesGetByIdResult, propertiesGetRoomsResult, propertiesGetTourRoomsResult, propertiesGetOtaComparisonResult, propertiesGetSocialProofResult, propertiesGetReviewsResult, propertiesGetTourSnippetsResult } from './validators';
import { publicQuery, adminQuery, adminMutation } from '../auth/model';
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { configurationWriter } from '../settings/model';
import { appendRecordHistory } from '../settings/model';
import { amount, imageUrl, required } from '../shared/validation';
import { toPublicProperty, type PublicProperty } from './model';

const otaPlatform = v.union(v.literal('booking_com'), v.literal('agoda'), v.literal('airbnb'), v.literal('expedia'));
const MAX_NIGHTLY_RATE = 1_000_000_000;

export const list = publicQuery({
  returns: propertiesListResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: {},
	handler: async (ctx): Promise<PublicProperty[]> => {
		const properties = await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.take(100);
		return properties.flatMap((property) => toPublicProperty(property) ?? []);
	}
});

export const getBySlug = publicQuery({
  returns: propertiesGetBySlugResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		return toPublicProperty(
			await ctx.db
				.query('properties')
				.withIndex('by_slug', (q) => q.eq('slug', args.slug))
				.first()
		);
	}
});

export const getById = publicQuery({
  returns: propertiesGetByIdResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { id: v.id('properties') },
	handler: async (ctx, args) => toPublicProperty(await ctx.db.get(args.id))
});

export const getRooms = publicQuery({
  returns: propertiesGetRoomsResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		if ((await ctx.db.get(args.propertyId))?.status !== 'active') return [];
		const rows = await ctx.db
			.query('tourScenes')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(50);
        return rows.map(({ _id, _creationTime, propertyId, slug, name, imagePath, hotspots }) => ({ _id, _creationTime, propertyId, slug, name, imagePath, hotspots }));
	}
});

/** Public 360 rooms of an active villa, in tour order (`tourRoomIds`, then any others by creation). */
export const getTourRooms = publicQuery({
  returns: propertiesGetTourRoomsResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const property = await ctx.db.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug)).unique();
		if (!property || property.status !== 'active') return null;
		const rooms = await ctx.db.query('tourScenes')
			.withIndex('by_property', (q) => q.eq('propertyId', property._id)).take(50);
		const rank = (slug: string) => {
			const index = property.tourRoomIds.indexOf(slug);
			return index === -1 ? Infinity : index;
		};
		// Stable sort: unlisted rooms keep the index's creation order.
		return rooms
			.sort((a, b) => rank(a.slug) - rank(b.slug) || 0)
			.map(({ slug, name, imagePath, hotspots }) => ({ slug, name, imagePath, hotspots }));
	}
});

/** Public: live direct pricing plus owner-entered OTA rates for an active villa. */
export const getOtaComparison = publicQuery({
  returns: propertiesGetOtaComparisonResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const property = await ctx.db
			.query('properties')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.unique();
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

export const listOtaRates = adminQuery({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', args.propertyId))
			.take(10);
	}
});

export const upsertOtaRate = adminMutation({
	args: { propertyId: v.id('properties'), platform: otaPlatform, nightlyRate: v.number(), url: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		if (!(await ctx.db.get(args.propertyId))) throw new Error('Property not found');
		if (!Number.isSafeInteger(args.nightlyRate) || args.nightlyRate <= 0 || args.nightlyRate > MAX_NIGHTLY_RATE) {
			throw new Error('Nightly rate must be a positive amount');
		}
		const fields = {
			nightlyRate: args.nightlyRate,
			url: args.url?.trim() ? publicHttpsUrl(args.url.trim()) : undefined,
			updatedAt: Date.now()
		};
		const existing = await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', args.propertyId).eq('platform', args.platform))
			.unique();
		await appendRecordHistory(ctx, { entityType: 'property', entityId: args.propertyId, actor: admin.email, kind: 'ota_rate_updated',
		 before: existing ? { platform: existing.platform, nightlyRate: existing.nightlyRate, url: existing.url ?? null } : null,
		 after: { platform: args.platform, nightlyRate: fields.nightlyRate, url: fields.url ?? null } });
		if (existing) {
			await ctx.db.patch(existing._id, fields);
			return existing._id;
		}
		return await ctx.db.insert('otaRates', { propertyId: args.propertyId, platform: args.platform, ...fields });
	}
});

export const removeOtaRate = adminMutation({
	args: { rateId: v.id('otaRates') },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const rate = await ctx.db.get(args.rateId);
		if (rate) {
		 await appendRecordHistory(ctx, { entityType: 'property', entityId: rate.propertyId, actor: admin.email, kind: 'ota_rate_removed', before: { platform: rate.platform, nightlyRate: rate.nightlyRate, url: rate.url ?? null }, after: null });
		 await ctx.db.delete(args.rateId);
		}
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

export const getSocialProof = publicQuery({
  returns: propertiesGetSocialProofResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		if ((await ctx.db.get(args.propertyId))?.status !== 'active') return null;
		const proof = await ctx.db
			.query('reviewStats')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.first();
        if (!proof) return null;
        return { _id: proof._id, _creationTime: proof._creationTime, propertyId: proof.propertyId, overallRating: proof.overallRating, totalReviews: proof.totalReviews };
	}
});

export const getReviews = publicQuery({
  returns: propertiesGetReviewsResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		if ((await ctx.db.get(args.propertyId))?.status !== 'active') return [];
		const rows = await ctx.db
			.query('reviews')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(100);
        return rows.map(({ _id, _creationTime, propertyId, authorName, authorCity, authorCountry, authorAvatarUrl, rating, title, body, date, verified, photos }) => ({ _id, _creationTime, propertyId, authorName, authorCity, authorCountry, authorAvatarUrl, rating, title, body, date, verified, photos }));
	}
});

export const getTourSnippets = publicQuery({
  returns: propertiesGetTourSnippetsResult,
  reason: "Anonymous catalogue/availability read; existing active-status checks and public projection remain.",
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		if ((await ctx.db.get(args.propertyId))?.status !== 'active') return [];
		const rows = await ctx.db
			.query('tourSnippets')
			.withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
			.take(100);
        return rows.map(({ _id, _creationTime, propertyId, roomSlug, position, quote, authorName, authorCity, rating }) => ({ _id, _creationTime, propertyId, roomSlug, position, quote, authorName, authorCity, rating }));
	}
});

// Admin editing. Properties and rooms are never deleted because bookings reference
// them. Draft and archived villas are excluded from live booking and chat queries.

const propertyStatus = v.union(v.literal('active'), v.literal('draft'), v.literal('archived'));
function textList(values: string[], label: string, maxItems: number): string[] {
	const trimmed = values.map((value) => value.trim()).filter(Boolean);
	if (trimmed.length > maxItems) throw new Error(`${label}: at most ${maxItems} items`);
	return trimmed;
}

/** True when guest-facing English copy changed, so the public site stops showing bundled i18n text. */
function contentChanged(existing: Doc<'properties'>, changes: Partial<Doc<'properties'>>): boolean {
	const textChanged = (['name', 'tagline', 'description'] as const).some(
		(field) => changes[field] !== undefined && changes[field] !== existing[field]
	);
	return textChanged || (changes.amenities !== undefined && changes.amenities.join('\n') !== existing.amenities.join('\n'));
}

export const adminList = adminQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('properties').take(100);
	}
});

export const adminGet = adminQuery({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		const property = await ctx.db.get(args.propertyId);
		if (!property) return null;
		const rooms = await ctx.db.query('tourScenes').withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).take(50);
		return { property, rooms };
	}
});

export const update = adminMutation({
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
		const admin = ctx.admin;
		const history = configurationWriter(ctx, admin.email);
		const existing = await ctx.db.get(propertyId);
		if (!existing) throw new Error('Property not found');
		const changes: Partial<Doc<'properties'>> = {};
		if (args.name !== undefined) changes.name = required(args.name, 'Name');
		if (args.tagline !== undefined) changes.tagline = args.tagline.trim();
		if (args.description !== undefined) changes.description = args.description.trim();
		if (args.pricePerNight !== undefined) changes.pricePerNight = amount(args.pricePerNight, 'Price per night', { integer: true });
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
			changes.directDiscountPercent = amount(args.directDiscountPercent, 'Direct discount', { integer: true, max: 10000 });
		}
		if (args.status !== undefined) changes.status = args.status;
		if (contentChanged(existing, changes)) changes.contentEditedAt = Date.now();
		await history.patchProperty(propertyId, changes);
	}
});

export const updateRoom = adminMutation({
	args: { roomId: v.id('tourScenes'), name: v.optional(v.string()), imagePath: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const history = configurationWriter(ctx, admin.email);
		if (!(await ctx.db.get(args.roomId))) throw new Error('Room not found');
		await history.patchRoom(args.roomId, {
			...(args.name !== undefined ? { name: required(args.name, 'Room name') } : {}),
			...(args.imagePath !== undefined ? { imagePath: imageUrl(required(args.imagePath, 'Room image')) } : {})
		});
	}
});
