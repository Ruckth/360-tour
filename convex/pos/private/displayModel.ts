import { ConvexError } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { DRIVER_LEASE_MS } from '../../lib/displayLease';
import { randomSecret, sha256 } from '../../lib/displayTokens';

/**
 * The customer display: a guest-facing screen (any browser, no camera needed) that shows the order
 * open at the admin checkout. Pairing is by a one-time link or a code staff type in; the display
 * then holds a device token, of which only the hash is stored. See convex/pos/private/displayView.ts for what it shows.
 *
 * One checkout tab drives the display: the one that last paired it (by link, code or "This
 * computer", which is a link opened in a popup) or took it over (`till.driverId`, a random id per
 * tab). showOrder from any other tab is ignored, so a second checkout never puts its order in front
 * of this guest. Every change of driver also sets the order shown, in the same write.
 *
 * An open order stays on screen only under the publishing checkout's lease (`till.leaseId`, one
 * per mount of the checkout page): the checkout renews it while open and releases it when it
 * leaves, and a crashed, closed or signed-out tab lets it run out (lib/displayLease.ts), when the
 * server clears the order itself. Renewing is not customer activity, so the display's idle timer
 * still counts from the last change or publish. A paid order's thank-you outlives the lease.
 *
 * Only the newest pairing link works (`till.pairGeneration`), and only until a display pairs or is
 * disconnected, so a QR left on a staff screen can't take the display over later.
 */

export const PAIRING_TTL_MS = 10 * 60_000;

/** Invalid link claims allowed per window; valid links always claim. */
export const INVALID_CLAIM_LIMIT = 30;

/**
 * Codes started per window, shop-wide. Pending rows are cheap and cleaned up, so the cap is high;
 * it only bounds abuse of the public endpoint. Under such abuse codes may be refused, but link
 * pairing is unaffected.
 */
export const START_PAIRING_LIMIT = 600;

export const NAME_MAX = 40;

export const SECRET_MAX = 128;

export const CLIENT_ID_MAX = 100;

export const CLEAN_BATCH = 100;

/** Stable codes the staff dialog can rely on. */
export function displayError(code: string, message: string) {
	return new ConvexError({ code, message });
}

export function deviceLabel(name: string | undefined) {
	return name?.trim().slice(0, NAME_MAX) || 'Customer display';
}

export function checkClientId(clientId: string) {
	if (!clientId || clientId.length > CLIENT_ID_MAX) throw displayError('INVALID_CLIENT', 'Reload the checkout and try again');
	return clientId;
}

/** Lease ids are made by the checkout tab like its client id. */
export const checkLeaseId = checkClientId;

export async function getDefaultTill(ctx: QueryCtx) {
	return await ctx.db.query('tills').withIndex('by_key', (q) => q.eq('key', 'default')).unique();
}

export async function ensureDefaultTill(ctx: MutationCtx) {
	const till = await getDefaultTill(ctx);
	if (till) return till;
	const tillId = await ctx.db.insert('tills', { key: 'default' });
	return (await ctx.db.get(tillId))!;
}

export async function displayByToken(ctx: QueryCtx, token: string) {
	if (!token || token.length > SECRET_MAX) return null;
	const tokenHash = await sha256(token);
	return await ctx.db.query('displays').withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash)).unique();
}

export function activeDisplays(ctx: QueryCtx, tillId: Id<'tills'>) {
	return ctx.db.query('displays').withIndex('by_tillId_and_status', (q) => q.eq('tillId', tillId).eq('status', 'active'));
}

/** A display's earlier code token: its row goes if still pending, so re-pairing leaves no orphans. Active rows stay. */
export async function deletePending(ctx: MutationCtx, token: string | undefined) {
	const display = token ? await displayByToken(ctx, token) : null;
	if (display?.status === 'pending') await ctx.db.delete(display._id);
}

export async function presenceOf(ctx: QueryCtx, displayId: Id<'displays'>) {
	return await ctx.db.query('displayPresence').withIndex('by_displayId', (q) => q.eq('displayId', displayId)).unique();
}

export async function deletePresence(ctx: MutationCtx, displayId: Id<'displays'>) {
	const presence = await presenceOf(ctx, displayId);
	if (presence) await ctx.db.delete(presence._id);
}

/** One display per till: pairing a new one revokes the others. */
export async function revokeActive(ctx: MutationCtx, tillId: Id<'tills'>) {
	const now = Date.now();
	for (const display of await activeDisplays(ctx, tillId).take(50)) {
		await ctx.db.patch(display._id, { status: 'revoked', revokedAt: now });
		await deletePresence(ctx, display._id);
	}
}

/** A URL's order id, normalized like convex/pos/orders.ts:getOrder: anything that isn't an order shows the welcome screen. */
export function orderIdFrom(ctx: QueryCtx, orderId: string | null) {
	return (orderId && ctx.db.normalizeId('orders', orderId)) || undefined;
}

export async function leaseOf(ctx: QueryCtx, tillId: Id<'tills'>) {
	return await ctx.db.query('displayDriverLeases').withIndex('by_tillId', (q) => q.eq('tillId', tillId)).unique();
}

/**
 * Puts the till under `leaseId` (none: nothing that needs one is shown) until DRIVER_LEASE_MS from
 * now. A new lease schedules its expiry check (expireLease); renewing one only moves the time that
 * check reads, so each lease has one check pending at a time.
 */
export async function setLease(ctx: MutationCtx, tillId: Id<'tills'>, leaseId: string | undefined) {
	const lease = await leaseOf(ctx, tillId);
	if (!leaseId) {
		if (lease) await ctx.db.delete(lease._id);
		return;
	}
	const expiresAt = Date.now() + DRIVER_LEASE_MS;
	if (lease?.leaseId === leaseId) return void (await ctx.db.patch(lease._id, { expiresAt }));
	if (lease) await ctx.db.patch(lease._id, { leaseId, expiresAt });
	else await ctx.db.insert('displayDriverLeases', { tillId, leaseId, expiresAt });
	await ctx.scheduler.runAt(expiresAt, internal.pos.displays.expireLease, { tillId, leaseId });
}

/** Clears the screen. Expiry retains the current mount's identity so only that mount can resume; an explicit release retires it. */
export async function endLease(ctx: MutationCtx, till: Doc<'tills'>, expired = false) {
	const order = till.orderId ? await ctx.db.get(till.orderId) : null;
	// A paid order keeps its thank-you, which the display times out itself.
	await ctx.db.patch(till._id, order?.status === 'paid' ? { leaseId: undefined } : { leaseId: expired ? till.leaseId : undefined, orderId: undefined });
	await setLease(ctx, till._id, undefined);
}

/** Cancels every outstanding pairing link for the till: only links made after this can claim. */
export async function retireLinks(ctx: MutationCtx, till: Doc<'tills'>) {
	await ctx.db.patch(till._id, { pairGeneration: (till.pairGeneration ?? 0) + 1 });
}

/**
 * Changes who drives the display and what it shows in one write, so a new driver or device never
 * inherits the previous customer's order. Pairing passes no order (the welcome screen) and the
 * driving tab republishes its own. A take-over's order gets a lease of its own, which runs out
 * unless the new driver republishes under its lease (it does so at once).
 */
export async function handOver(ctx: MutationCtx, till: Doc<'tills'>, driverId: string | undefined, orderId: Id<'orders'> | undefined) {
	const leaseId = orderId ? randomSecret() : undefined;
	await ctx.db.patch(till._id, { driverId, orderId, publishedAt: Date.now(), leaseId });
	await setLease(ctx, till._id, leaseId);
}
