import { ConvexError, getDocumentSize } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { MAX_CONVEX_DOCUMENT_BYTES, MAX_CONVEX_DOCUMENT_ID_LENGTH } from '../../shared/documentSize';

// New tours and the public response stay at 50 rooms. Imported tours above that limit can
// be inspected and reduced in the editor as long as they fit the recovery budget.
export const MAX_TOUR_ROOMS = 50;
const MAX_RECOVERABLE_ROOMS = 500;
const MAX_RECOVERABLE_TOUR_BYTES = 2 * 1024 * 1024;

export function certifyOrdinaryRoom<T extends Omit<Doc<'tourScenes'>, '_id' | '_creationTime'>>(room: T) {
	const certified = { ...room, ordinaryTourCertified: true as const };
	// Certification is optional, including for an ordinary room close to Convex's document limit.
	return getDocumentSize(certified, { customIdLength: MAX_CONVEX_DOCUMENT_ID_LENGTH }) <= MAX_CONVEX_DOCUMENT_BYTES ? certified : room;
}

export async function propertyRooms(ctx: QueryCtx, propertyId: Id<'properties'>) {
	const rooms: Doc<'tourScenes'>[] = [];
	let tourBytes = 0;
	const byProperty = ctx.db.query('tourScenes').withIndex('by_property', (q) => q.eq('propertyId', propertyId));
	for await (const room of byProperty) {
		// The recovery byte budget applies only after the 51st row. Ordinary tours
		// keep their existing support for larger documents and need no size calculation.
		if (rooms.length === MAX_TOUR_ROOMS) {
			for (const previous of rooms) tourBytes += getDocumentSize(previous);
		}
		if (rooms.length >= MAX_TOUR_ROOMS) tourBytes += getDocumentSize(room);
		if (rooms.length === MAX_RECOVERABLE_ROOMS || tourBytes > MAX_RECOVERABLE_TOUR_BYTES) {
			throw new ConvexError('This imported tour exceeds the safe editor limit. Ask support to reduce the imported rooms from a verified export.');
		}
		rooms.push(room);
	}
	return rooms;
}

type RoomEdit = Partial<Pick<Doc<'tourScenes'>, 'name' | 'imagePath' | 'hotspots'>>;

export function roomEditByteGrowth(room: Doc<'tourScenes'>, patch: RoomEdit) {
	return getDocumentSize({ ...room, ...patch }) - getDocumentSize(room);
}

/** A certificate must never consume bytes that an otherwise valid scene edit needs. */
export function roomEditWithCertificate(room: Doc<'tourScenes'>, patch: RoomEdit): RoomEdit & { ordinaryTourCertified?: true } {
	if (!room.ordinaryTourCertified) return patch;

	// UTF-8 uses at most 3 bytes per UTF-16 unit. The fixed allowances dominate
	// field names, system fields, type markers and array/object framing.
	let upperBound = 1024 + 3 * (room.slug.length + room.propertyId.length + room._id.length +
		(patch.name ?? room.name).length + (patch.imagePath ?? room.imagePath).length);
	for (const hotspot of patch.hotspots ?? room.hotspots) {
		upperBound += 128 + 9 * hotspot.position.length +
			3 * (hotspot.id.length + hotspot.label.length + hotspot.targetRoomSlug.length);
	}
	if (upperBound <= MAX_CONVEX_DOCUMENT_BYTES || getDocumentSize({ ...room, ...patch }) <= MAX_CONVEX_DOCUMENT_BYTES) {
		return patch;
	}
	return { ...patch, ordinaryTourCertified: undefined };
}

/** The indexed read and the write belong to the same mutation, so concurrent edits cannot both spend the same headroom. */
export function assertOversizedTourGrowth(rooms: Doc<'tourScenes'>[], growth: number) {
	if (growth <= 0 || rooms.length <= MAX_TOUR_ROOMS) return;
	const projectedBytes = rooms.reduce((bytes, room) => bytes + getDocumentSize(room), growth);
	if (projectedBytes > MAX_RECOVERABLE_TOUR_BYTES) {
		throw new ConvexError('This change would make the oversized tour exceed its safe size limit. Reduce other rooms first.');
	}
}

/**
 * A name/image edit only needs to protect an oversized tour that was readable before the edit.
 * If the first 50 rows already exceed the recovery byte budget, more rows cannot change that conclusion.
 * Stop there so a large ordinary tour does not spend its native transaction budget on validation.
 */
export async function assertUncertifiedRoomGrowth(ctx: QueryCtx, propertyId: Id<'properties'>, growth: number) {
	const byProperty = ctx.db.query('tourScenes').withIndex('by_property', q => q.eq('propertyId', propertyId));
	let count = 0;
	let bytes = 0;
	for await (const room of byProperty) {
		count++;
		bytes += getDocumentSize(room);
		if (count <= MAX_TOUR_ROOMS && bytes > MAX_RECOVERABLE_TOUR_BYTES) return;
		if (count > MAX_RECOVERABLE_ROOMS || count > MAX_TOUR_ROOMS && bytes + growth > MAX_RECOVERABLE_TOUR_BYTES) {
			throw new ConvexError('This change would make the oversized tour exceed its safe size limit. Reduce other rooms first.');
		}
	}
	return count <= MAX_TOUR_ROOMS;
}

export function sortTourRooms(rooms: Doc<'tourScenes'>[], slugs: string[]) {
	const rank = new Map<string, number>();
	for (const slug of slugs) if (!rank.has(slug)) rank.set(slug, rank.size);
	const position = (slug: string) => rank.get(slug) ?? rank.size;
	// The index reads in creation order, and the stable sort preserves ties.
	return rooms.sort((a, b) => position(a.slug) - position(b.slug));
}
