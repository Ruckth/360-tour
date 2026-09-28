import { mutation, query, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import { uploadProblem } from './lib/imageUploads';
import { MAX_SLUG_LENGTH, SLUG_PATTERN, slugify } from './lib/slug';
import { amount, imageUrl, required } from './properties';

// Villa admin: create/delete drafts, slug, status, uploads, 360 rooms and hotspots.
// Plain field edits stay in `properties.update` / `properties.updateRoom`.

const MAX_ROOMS = 50;
const MAX_HOTSPOTS = 20;
const MAX_DELETE_CHILDREN = 500;

function validSlug(value: string, label: string): string {
	const slug = value.trim().toLowerCase();
	if (!SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) {
		throw new Error(`${label} can only use lowercase letters, numbers and single dashes (max ${MAX_SLUG_LENGTH})`);
	}
	return slug;
}

/** Manual slug: must be free. Auto slug: from `fallbackText`, suffixed -2, -3… until free. */
async function pickSlug(manual: string | undefined, fallbackText: string, fallback: string, label: string, isTaken: (slug: string) => Promise<boolean>) {
	if (manual?.trim()) {
		const slug = validSlug(manual, label);
		if (await isTaken(slug)) throw new Error(`${label} "${slug}" is already used`);
		return slug;
	}
	const base = slugify(fallbackText) || fallback;
	for (let n = 1; n < 100; n++) {
		const slug = n === 1 ? base : `${base}-${n}`;
		if (!(await isTaken(slug))) return slug;
	}
	throw new Error(`Could not pick a free ${label.toLowerCase()}; enter one manually`);
}

async function propertySlugTaken(ctx: QueryCtx, slug: string, except?: Id<'properties'>) {
	const found = await ctx.db.query('properties').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
	return found !== null && found._id !== except;
}

async function hasBookings(ctx: QueryCtx, propertyId: Id<'properties'>) {
	return (await ctx.db.query('bookings').withIndex('by_property', (q) => q.eq('propertyId', propertyId)).first()) !== null;
}

/** Why this villa can't be deleted, or null. Only drafts nobody has booked, blocked or chatted about can go. */
async function deleteBlocker(ctx: QueryCtx, property: Doc<'properties'>): Promise<string | null> {
	if (property.status !== 'draft') return 'Only draft villas can be deleted. Archive it instead.';
	if (await hasBookings(ctx, property._id)) return 'This villa has bookings. Archive it instead.';
	if (await ctx.db.query('availability').withIndex('by_property', (q) => q.eq('propertyId', property._id)).first()) {
		return 'This villa has calendar entries. Archive it instead.';
	}
	if (await ctx.db.query('chatSessions').withIndex('by_property', (q) => q.eq('propertyId', property._id)).first()) {
		return 'Guests have chatted about this villa. Archive it instead.';
	}
	const propertyId = property._id;
	const slug = property.slug;
	const references = [
		['chat answers', await ctx.db.query('chatAnswers').withIndex('by_propertyId_and_status_and_updatedAt', q => q.eq('propertyId', propertyId)).first()],
		['chat answer property scopes', await ctx.db.query('chatAnswerPropertyScopes').withIndex('by_propertySlug', q => q.eq('propertySlug', slug)).first()],
		['chat answer property scopes', await ctx.db.query('chatAnswerPropertyScopes').withIndex('by_propertyId', q => q.eq('propertyId', propertyId)).first()],
		['chat knowledge scopes', await ctx.db.query('chatKnowledgeScopes').withIndex('by_normalizedSlug', q => q.eq('normalizedSlug', slug)).first()],
		['chat topics', await ctx.db.query('chatTopics').withIndex('by_propertyId', q => q.eq('propertyId', propertyId)).first()],
		['chat questions', await ctx.db.query('chatQuestions').withIndex('by_propertyId', q => q.eq('propertyId', propertyId)).first()],
		['chat answer topics', await ctx.db.query('chatAnswerTopics').withIndex('by_propertyId', q => q.eq('propertyId', propertyId)).first()],
		['unknown chat questions', await ctx.db.query('chatUnknownQuestions').withIndex('by_propertyId_and_status_and_createdAt', q => q.eq('propertyId', propertyId)).first()],
		['unknown chat questions', await ctx.db.query('chatUnknownQuestions').withIndex('by_propertySlug', q => q.eq('propertySlug', slug)).first()],
		['curated chat questions', await ctx.db.query('curatedChatQuestions').withIndex('by_propertySlug_and_normalizedQuestion', q => q.eq('propertySlug', slug)).first()],
		['leads', await ctx.db.query('leads').withIndex('by_property', q => q.eq('propertyId', propertyId)).first()],
	] as const;
	const found = [...new Set(references.filter(([, row]) => row !== null).map(([name]) => name))];
	if (found.length) return `This villa has ${found.join(', ')}. Remove those references before deleting it.`;
	return null;
}

async function propertyRooms(ctx: QueryCtx, propertyId: Id<'properties'>) {
	return await ctx.db.query('rooms').withIndex('by_property', (q) => q.eq('propertyId', propertyId)).take(MAX_ROOMS);
}

async function getProperty(ctx: QueryCtx, propertyId: Id<'properties'>) {
	const property = await ctx.db.get(propertyId);
	if (!property) throw new Error('Property not found');
	return property;
}

async function getRoom(ctx: QueryCtx, roomId: Id<'rooms'>) {
	const room = await ctx.db.get(roomId);
	if (!room) throw new Error('Room not found');
	return room;
}

/**
 * Villa editor data: rooms in tour order, whether the slug is locked and whether it can be deleted.
 * Takes the raw id from the URL, so a mistyped link shows "not found" instead of a validation error.
 */
export const get = query({
	args: { propertyId: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const propertyId = ctx.db.normalizeId('properties', args.propertyId);
		const property = propertyId ? await ctx.db.get(propertyId) : null;
		if (!property) return null;
		const rooms = await propertyRooms(ctx, property._id);
		const position = (slug: string) => {
			const index = property.tourRoomIds.indexOf(slug);
			return index === -1 ? Number.MAX_SAFE_INTEGER : index; // rooms missing from the tour go last
		};
		rooms.sort((a, b) => position(a.slug) - position(b.slug));
		return {
			property,
			rooms,
			slugLocked: await hasBookings(ctx, property._id),
			deleteBlocker: await deleteBlocker(ctx, property)
		};
	}
});

export const create = mutation({
	args: { name: v.string(), slug: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const name = required(args.name, 'Name');
		const slug = await pickSlug(args.slug, name, 'villa', 'Slug', (s) => propertySlugTaken(ctx, s));
		const template = await ctx.db.query('properties').first();
		return await ctx.db.insert('properties', {
			tenantId: template?.tenantId,
			slug,
			name,
			tagline: '',
			description: '',
			pricePerNight: 0,
			currency: template?.currency ?? 'THB',
			maxGuests: 2,
			bedrooms: 1,
			bathrooms: 1,
			area: 0,
			images: [],
			amenities: [],
			tourRoomIds: [],
			directDiscountPercent: 0,
			status: 'draft'
		});
	}
});

/**
 * New draft with the villa's details, photos, 360 rooms and OTA rates. Room slugs are per villa, so the copies
 * keep theirs and every hotspot still points at the matching copied room. Bookings, calendars, reviews and the
 * iCal export token are not copied.
 */
export const duplicate = mutation({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const source = await getProperty(ctx, args.propertyId);
		const name = `${source.name} (copy)`;
		const slug = await pickSlug(undefined, name, 'villa', 'Slug', (s) => propertySlugTaken(ctx, s));
		const propertyId = await ctx.db.insert('properties', {
			tenantId: source.tenantId,
			slug,
			name,
			tagline: source.tagline,
			description: source.description,
			pricePerNight: source.pricePerNight,
			currency: source.currency,
			maxGuests: source.maxGuests,
			bedrooms: source.bedrooms,
			bathrooms: source.bathrooms,
			area: source.area,
			images: source.images,
			amenities: source.amenities,
			tourRoomIds: [],
			directDiscountPercent: source.directDiscountPercent,
			status: 'draft'
		});

		const rooms = await propertyRooms(ctx, source._id);
		const roomSlugs = new Set(rooms.map((room) => room.slug));
		for (const room of rooms) {
			await ctx.db.insert('rooms', {
				propertyId,
				slug: room.slug,
				name: room.name,
				imagePath: room.imagePath,
				hotspots: room.hotspots.filter((hotspot) => roomSlugs.has(hotspot.targetRoomSlug))
			});
		}
		await ctx.db.patch(propertyId, { tourRoomIds: source.tourRoomIds.filter((roomSlug) => roomSlugs.has(roomSlug)) });

		const rates = await ctx.db
			.query('otaRates')
			.withIndex('by_property_platform', (q) => q.eq('propertyId', source._id))
			.take(20);
		for (const rate of rates) {
			await ctx.db.insert('otaRates', {
				propertyId,
				platform: rate.platform,
				nightlyRate: rate.nightlyRate,
				url: rate.url,
				updatedAt: Date.now()
			});
		}
		return propertyId;
	}
});

export const setSlug = mutation({
	args: { propertyId: v.id('properties'), slug: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const property = await getProperty(ctx, args.propertyId);
		const slug = validSlug(args.slug, 'Slug');
		if (slug === property.slug) return slug;
		if (await hasBookings(ctx, property._id)) {
			throw new Error('The slug is locked because this villa has bookings: guest links and emails use it');
		}
		if (await propertySlugTaken(ctx, slug, property._id)) throw new Error(`Slug "${slug}" is already used`);
		await ctx.db.patch(property._id, { slug });
		return slug;
	}
});

export const setStatus = mutation({
	args: { propertyId: v.id('properties'), status: v.union(v.literal('active'), v.literal('draft'), v.literal('archived')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const property = await getProperty(ctx, args.propertyId);
		if (args.status === 'active' && property.pricePerNight <= 0) {
			throw new Error('Set a price per night before publishing');
		}
		await ctx.db.patch(property._id, { status: args.status });
	}
});

export const deleteDraft = mutation({
	args: { propertyId: v.id('properties') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const property = await getProperty(ctx, args.propertyId);
		const blocker = await deleteBlocker(ctx, property);
		if (blocker) throw new Error(blocker);
		const propertyId = property._id;
		const children = [
			ctx.db.query('rooms').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('reviews').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('socialProof').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('tourSnippets').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('recentBookingDisplay').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('otaRates').withIndex('by_property_platform', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('pricing').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('icalSources').withIndex('by_property', (q) => q.eq('propertyId', propertyId)),
			ctx.db.query('propertyKnowledge').withIndex('by_property', (q) => q.eq('propertyId', propertyId))
		];
		const childRows = [];
		for (const rows of children) {
			const batch = await rows.take(MAX_DELETE_CHILDREN + 1);
			if (batch.length > MAX_DELETE_CHILDREN) {
				throw new Error(`This villa has more than ${MAX_DELETE_CHILDREN} child records in a table. Remove some before deleting it.`);
			}
			childRows.push(batch);
		}
		for (const batch of childRows) for (const row of batch) await ctx.db.delete(row._id);
		await ctx.db.delete(propertyId);
	}
});

// Uploads: the browser POSTs the file to `generateUploadUrl`, then `saveUploadedImage` checks it and returns
// a public URL that is stored like any other image URL (in `images` or `rooms.imagePath`).

export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return await ctx.storage.generateUploadUrl();
	}
});

export const saveUploadedImage = mutation({
	args: { storageId: v.id('_storage'), kind: v.union(v.literal('photo'), v.literal('panorama')) },
	handler: async (ctx, args): Promise<{ url: string } | { error: string }> => {
		await requireAdmin(ctx);
		const file = await ctx.db.system.get(args.storageId);
		if (!file) throw new Error('Upload not found');
		const problem = uploadProblem(args.kind, file.contentType, file.size);
		if (problem) {
			// Returned, not thrown: throwing would roll back the delete and keep the rejected file.
			await ctx.storage.delete(args.storageId);
			return { error: problem };
		}
		const url = await ctx.storage.getUrl(args.storageId);
		if (!url) throw new Error('Upload not found');
		return { url };
	}
});

// 360 rooms. `properties.tourRoomIds` holds room slugs in tour order; hotspots point at room slugs.

export const createRoom = mutation({
	args: { propertyId: v.id('properties'), name: v.string(), slug: v.optional(v.string()), imagePath: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const property = await getProperty(ctx, args.propertyId);
		const name = required(args.name, 'Room name');
		const imagePath = imageUrl(required(args.imagePath, 'Panorama'));
		const rooms = await propertyRooms(ctx, property._id);
		if (rooms.length >= MAX_ROOMS) throw new Error(`A villa can have at most ${MAX_ROOMS} rooms`);
		const taken = new Set(rooms.map((room) => room.slug));
		const slug = await pickSlug(args.slug, name, 'room', 'Room slug', async (s) => taken.has(s));
		const roomId = await ctx.db.insert('rooms', { propertyId: property._id, slug, name, imagePath, hotspots: [] });
		await ctx.db.patch(property._id, { tourRoomIds: [...property.tourRoomIds.filter((id) => id !== slug), slug] });
		return roomId;
	}
});

export const deleteRoom = mutation({
	args: { roomId: v.id('rooms') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const room = await getRoom(ctx, args.roomId);
		const property = await getProperty(ctx, room.propertyId);
		for (const other of await propertyRooms(ctx, property._id)) {
			if (other._id === room._id) continue;
			const hotspots = other.hotspots.filter((hotspot) => hotspot.targetRoomSlug !== room.slug);
			if (hotspots.length !== other.hotspots.length) await ctx.db.patch(other._id, { hotspots });
		}
		const snippets = await ctx.db.query('tourSnippets').withIndex('by_property', (q) => q.eq('propertyId', property._id)).take(200);
		for (const snippet of snippets) if (snippet.roomSlug === room.slug) await ctx.db.delete(snippet._id);
		await ctx.db.patch(property._id, { tourRoomIds: property.tourRoomIds.filter((slug) => slug !== room.slug) });
		await ctx.db.delete(room._id);
	}
});

/** `roomSlugs` must list every room of the villa once, in the new tour order. */
export const reorderRooms = mutation({
	args: { propertyId: v.id('properties'), roomSlugs: v.array(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const property = await getProperty(ctx, args.propertyId);
		const slugs = new Set((await propertyRooms(ctx, property._id)).map((room) => room.slug));
		const given = new Set(args.roomSlugs);
		if (given.size !== args.roomSlugs.length || given.size !== slugs.size || !args.roomSlugs.every((slug) => slugs.has(slug))) {
			throw new Error('The room order is out of date. Reload and try again.');
		}
		await ctx.db.patch(property._id, { tourRoomIds: args.roomSlugs });
	}
});

export const setHotspots = mutation({
	args: {
		roomId: v.id('rooms'),
		hotspots: v.array(
			v.object({ id: v.optional(v.string()), label: v.string(), targetRoomSlug: v.string(), position: v.array(v.number()) })
		)
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const room = await getRoom(ctx, args.roomId);
		if (args.hotspots.length > MAX_HOTSPOTS) throw new Error(`A room can have at most ${MAX_HOTSPOTS} hotspots`);
		const targets = new Set((await propertyRooms(ctx, room.propertyId)).map((other) => other.slug));
		targets.delete(room.slug);
		const usedIds = new Set<string>();
		const hotspots = args.hotspots.map((hotspot) => {
			const label = required(hotspot.label, 'Hotspot label');
			if (!targets.has(hotspot.targetRoomSlug)) throw new Error(`Hotspot "${label}" must point to another room of this villa`);
			if (hotspot.position.length !== 3) throw new Error(`Hotspot "${label}" needs x, y and z`);
			const position = hotspot.position.map((value) => amount(value, `Hotspot "${label}" position`, { min: -1000, max: 1000 }));
			const base = hotspot.id?.trim() || `${room.slug}-to-${hotspot.targetRoomSlug}`;
			let id = base;
			for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
			usedIds.add(id);
			return { id, label, targetRoomSlug: hotspot.targetRoomSlug, position };
		});
		await ctx.db.patch(room._id, { hotspots });
	}
});
