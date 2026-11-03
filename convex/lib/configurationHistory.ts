import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { appendRecordHistory } from './recordHistory';
import { BUSINESS_FIELDS, type EffectiveSettings } from './siteSettings';

/** Allow lists, never a spread of a database row: tokens and future provider fields stay out. */
export function settingsSnapshot(settings: EffectiveSettings) {
	const business = Object.fromEntries(BUSINESS_FIELDS.map((field) => [field, settings[field]]));
	return {
		...business,
		bookingRules: settings.bookingRules,
		ai: { tone: settings.ai.tone, maxWords: settings.ai.maxWords },
		email: {
			fromName: settings.email.fromName,
			ownerNotificationEmail: settings.email.ownerNotificationEmail,
			footer: settings.email.footer
		}
	};
}
export function propertySnapshot(p: Doc<'properties'>) {
	return {
		slug: p.slug,
		name: p.name,
		tagline: p.tagline,
		description: p.description,
		pricePerNight: p.pricePerNight,
		currency: p.currency,
		maxGuests: p.maxGuests,
		bedrooms: p.bedrooms,
		bathrooms: p.bathrooms,
		area: p.area,
		images: p.images,
		amenities: p.amenities,
		tourRoomIds: p.tourRoomIds,
		directDiscountPercent: p.directDiscountPercent,
		status: p.status,
		...(p.translations ? { translations: p.translations } : {})
	};
}
export function roomSnapshot(r: Doc<'rooms'>) {
	return { propertyId: r.propertyId, slug: r.slug, name: r.name, imagePath: r.imagePath, hotspots: r.hotspots };
}

/** Durable discovery entry survives primary deletion; only these two entity types are supported. */
export async function logConfiguration(
	ctx: MutationCtx,
	actor: string,
	kind: string,
	before: Doc<'properties'> | Doc<'rooms'> | null,
	after: Doc<'properties'> | Doc<'rooms'> | null,
	type: 'property' | 'room'
) {
	const row = after ?? before;
	if (!row) throw new Error('Missing configuration record');
	const entityId = row._id;
	const propertyId = type === 'property' ? (row._id as Id<'properties'>) : (row as Doc<'rooms'>).propertyId;
	const snapshot = (value: typeof row) =>
		type === 'property' ? propertySnapshot(value as Doc<'properties'>) : roomSnapshot(value as Doc<'rooms'>);
	await appendRecordHistory(ctx, {
		entityType: type,
		entityId,
		actor,
		kind,
		before: before ? snapshot(before) : null,
		after: after ? snapshot(after) : null
	});
	const existing = await ctx.db
		.query('configurationHistoryIndex')
		.withIndex('by_entityType_and_entityId', (q) => q.eq('entityType', type).eq('entityId', entityId))
		.unique();
	const fields = { name: row.name, slug: row.slug, deleted: !after, updatedAt: Date.now() };
	if (existing) await ctx.db.patch(existing._id, fields);
	else await ctx.db.insert('configurationHistoryIndex', { entityType: type, entityId, propertyId, ...fields });
}

/** Private typed writer: records every owned property/room change in the same transaction. */
export function configurationWriter(ctx: MutationCtx, actor: string) {
	return {
		async insertProperty(fields: Omit<Doc<'properties'>, '_id' | '_creationTime'>) {
			const id = await ctx.db.insert('properties', fields);
			await logConfiguration(ctx, actor, 'created', null, await ctx.db.get(id), 'property');
			return id;
		},
		async insertRoom(fields: Omit<Doc<'rooms'>, '_id' | '_creationTime'>) {
			const id = await ctx.db.insert('rooms', fields);
			await logConfiguration(ctx, actor, 'created', null, await ctx.db.get(id), 'room');
			return id;
		},
		async patchProperty(id: Id<'properties'>, fields: Partial<Omit<Doc<'properties'>, '_id' | '_creationTime'>>) {
			const before = await ctx.db.get(id);
			await ctx.db.patch(id, fields);
			await logConfiguration(ctx, actor, 'updated', before, await ctx.db.get(id), 'property');
		},
		async patchRoom(id: Id<'rooms'>, fields: Partial<Omit<Doc<'rooms'>, '_id' | '_creationTime'>>) {
			const before = await ctx.db.get(id);
			await ctx.db.patch(id, fields);
			await logConfiguration(ctx, actor, 'updated', before, await ctx.db.get(id), 'room');
		},
		async deleteProperty(id: Id<'properties'>) {
			await logConfiguration(ctx, actor, 'deleted', await ctx.db.get(id), null, 'property');
			await ctx.db.delete(id);
		},
		async deleteRoom(id: Id<'rooms'>) {
			await logConfiguration(ctx, actor, 'deleted', await ctx.db.get(id), null, 'room');
			await ctx.db.delete(id);
		}
	};
}

/** OTA rates are business configuration owned by a villa, with no provider credentials. */
export async function logOtaRate(
	ctx: MutationCtx,
	actor: string,
	before: Doc<'otaRates'> | null,
	after: Doc<'otaRates'> | null
) {
	const row = after ?? before;
	if (!row) throw new Error('Missing OTA rate');
	const safe = (value: Doc<'otaRates'>) => ({
		platform: value.platform,
		nightlyRate: value.nightlyRate,
		url: value.url ?? null
	});
	await appendRecordHistory(ctx, {
		entityType: 'property',
		entityId: row.propertyId,
		actor,
		kind: after ? 'ota_rate_updated' : 'ota_rate_removed',
		before: before ? safe(before) : null,
		after: after ? safe(after) : null
	});
}
