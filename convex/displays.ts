import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './auth/model';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireStaff } from './lib/staffAccess';
import { PAIR_CODE_LENGTH, normalizePairCode, randomPairCode, randomSecret, sha256 } from './lib/displayTokens';
import { DRIVER_LEASE_MS } from './lib/displayLease';
import { displayOrderState, type DisplayOrderState } from './lib/displayView';
import { enforceRateLimit } from './lib/rateLimit';

/**
 * The customer display: a guest-facing screen (any browser, no camera needed) that shows the order
 * open at the admin checkout. Pairing is by a one-time link or a code staff type in; the display
 * then holds a device token, of which only the hash is stored. See lib/displayView.ts for what it shows.
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
const INVALID_CLAIM_LIMIT = 30;
/**
 * Codes started per window, shop-wide. Pending rows are cheap and cleaned up, so the cap is high;
 * it only bounds abuse of the public endpoint. Under such abuse codes may be refused, but link
 * pairing is unaffected.
 */
const START_PAIRING_LIMIT = 600;
const NAME_MAX = 40;
const SECRET_MAX = 128;
const CLIENT_ID_MAX = 100;
const CLEAN_BATCH = 100;

export type DisplayState = { state: 'unpaired' } | { state: 'pending'; code: string } | DisplayOrderState;
export type DisplayDriver = 'here' | 'elsewhere' | 'none';

/** Stable codes the staff dialog can rely on. */
function displayError(code: string, message: string) {
	return new ConvexError({ code, message });
}

function deviceLabel(name: string | undefined) {
	return name?.trim().slice(0, NAME_MAX) || 'Customer display';
}

function checkClientId(clientId: string) {
	if (!clientId || clientId.length > CLIENT_ID_MAX) throw displayError('INVALID_CLIENT', 'Reload the checkout and try again');
	return clientId;
}

/** Lease ids are made by the checkout tab like its client id. */
const checkLeaseId = checkClientId;

async function getDefaultTill(ctx: QueryCtx) {
	return await ctx.db.query('tills').withIndex('by_key', (q) => q.eq('key', 'default')).unique();
}

async function ensureDefaultTill(ctx: MutationCtx) {
	const till = await getDefaultTill(ctx);
	if (till) return till;
	const tillId = await ctx.db.insert('tills', { key: 'default' });
	return (await ctx.db.get(tillId))!;
}

async function displayByToken(ctx: QueryCtx, token: string) {
	if (!token || token.length > SECRET_MAX) return null;
	const tokenHash = await sha256(token);
	return await ctx.db.query('displays').withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash)).unique();
}

function activeDisplays(ctx: QueryCtx, tillId: Id<'tills'>) {
	return ctx.db.query('displays').withIndex('by_tillId_and_status', (q) => q.eq('tillId', tillId).eq('status', 'active'));
}

/** A display's earlier code token: its row goes if still pending, so re-pairing leaves no orphans. Active rows stay. */
async function deletePending(ctx: MutationCtx, token: string | undefined) {
	const display = token ? await displayByToken(ctx, token) : null;
	if (display?.status === 'pending') await ctx.db.delete(display._id);
}

async function presenceOf(ctx: QueryCtx, displayId: Id<'displays'>) {
	return await ctx.db.query('displayPresence').withIndex('by_displayId', (q) => q.eq('displayId', displayId)).unique();
}

async function deletePresence(ctx: MutationCtx, displayId: Id<'displays'>) {
	const presence = await presenceOf(ctx, displayId);
	if (presence) await ctx.db.delete(presence._id);
}

/** One display per till: pairing a new one revokes the others. */
async function revokeActive(ctx: MutationCtx, tillId: Id<'tills'>) {
	const now = Date.now();
	for (const display of await activeDisplays(ctx, tillId).take(50)) {
		await ctx.db.patch(display._id, { status: 'revoked', revokedAt: now });
		await deletePresence(ctx, display._id);
	}
}

/** A URL's order id, normalized like pos.getOrder: anything that isn't an order shows the welcome screen. */
function orderIdFrom(ctx: QueryCtx, orderId: string | null) {
	return (orderId && ctx.db.normalizeId('orders', orderId)) || undefined;
}

async function leaseOf(ctx: QueryCtx, tillId: Id<'tills'>) {
	return await ctx.db.query('displayDriverLeases').withIndex('by_tillId', (q) => q.eq('tillId', tillId)).unique();
}

/**
 * Puts the till under `leaseId` (none: nothing that needs one is shown) until DRIVER_LEASE_MS from
 * now. A new lease schedules its expiry check (expireLease); renewing one only moves the time that
 * check reads, so each lease has one check pending at a time.
 */
async function setLease(ctx: MutationCtx, tillId: Id<'tills'>, leaseId: string | undefined) {
	const lease = await leaseOf(ctx, tillId);
	if (!leaseId) {
		if (lease) await ctx.db.delete(lease._id);
		return;
	}
	const expiresAt = Date.now() + DRIVER_LEASE_MS;
	if (lease?.leaseId === leaseId) return void (await ctx.db.patch(lease._id, { expiresAt }));
	if (lease) await ctx.db.patch(lease._id, { leaseId, expiresAt });
	else await ctx.db.insert('displayDriverLeases', { tillId, leaseId, expiresAt });
	await ctx.scheduler.runAt(expiresAt, internal.displays.expireLease, { tillId, leaseId });
}

/** Clears the screen. Expiry retains the current mount's identity so only that mount can resume; an explicit release retires it. */
async function endLease(ctx: MutationCtx, till: Doc<'tills'>, expired = false) {
	const order = till.orderId ? await ctx.db.get(till.orderId) : null;
	// A paid order keeps its thank-you, which the display times out itself.
	await ctx.db.patch(till._id, order?.status === 'paid' ? { leaseId: undefined } : { leaseId: expired ? till.leaseId : undefined, orderId: undefined });
	await setLease(ctx, till._id, undefined);
}

/** Cancels every outstanding pairing link for the till: only links made after this can claim. */
async function retireLinks(ctx: MutationCtx, till: Doc<'tills'>) {
	await ctx.db.patch(till._id, { pairGeneration: (till.pairGeneration ?? 0) + 1 });
}

/**
 * Changes who drives the display and what it shows in one write, so a new driver or device never
 * inherits the previous customer's order. Pairing passes no order (the welcome screen) and the
 * driving tab republishes its own. A take-over's order gets a lease of its own, which runs out
 * unless the new driver republishes under its lease (it does so at once).
 */
async function handOver(ctx: MutationCtx, till: Doc<'tills'>, driverId: string | undefined, orderId: Id<'orders'> | undefined) {
	const leaseId = orderId ? randomSecret() : undefined;
	await ctx.db.patch(till._id, { driverId, orderId, publishedAt: Date.now(), leaseId });
	await setLease(ctx, till._id, leaseId);
}

/**
 * Admin: a one-time link secret. Only its hash is stored, so this is the only time it can be read.
 * Making a link cancels any earlier one still outstanding.
 */
export const createPairLink = mutation({
	args: { clientId: v.string() },
	handler: async (ctx, args) => {
		const { email } = await requireStaff(ctx, 'checkout');
		const driverId = checkClientId(args.clientId);
		const till = await ensureDefaultTill(ctx);
		const generation = (till.pairGeneration ?? 0) + 1;
		await ctx.db.patch(till._id, { pairGeneration: generation });
		const secret = randomSecret();
		const expiresAt = Date.now() + PAIRING_TTL_MS;
		await ctx.db.insert('displayPairLinks', { tillId: till._id, secretHash: await sha256(secret), expiresAt, createdByEmail: email, driverId, generation });
		return { secret, expiresAt };
	}
});

/**
 * Public: the display opened a pairing link. A valid link always claims; only invalid attempts
 * count toward (and are refused by) the rate limit. They return `{ ok: false }` rather than
 * throwing, so the count commits. A link is valid once, before it expires, and only while it is
 * the till's newest and no display has paired or been disconnected since (links stored before
 * generations existed never are). `previousToken` is the display's code token, whose row is
 * deleted on a successful claim if it is still pending (as in startPairing; an active row is never touched).
 */
export const claimLink = mutation({
	args: { secret: v.string(), deviceName: v.optional(v.string()), previousToken: v.optional(v.string()) },
	handler: async (ctx, args): Promise<{ ok: true; token: string } | { ok: false; code: 'LINK_INVALID' }> => {
		const now = Date.now();
		const secretHash = args.secret && args.secret.length <= SECRET_MAX ? await sha256(args.secret) : '';
		const link = secretHash ? await ctx.db.query('displayPairLinks').withIndex('by_secretHash', (q) => q.eq('secretHash', secretHash)).unique() : null;
		const till = link ? await ctx.db.get(link.tillId) : null;
		if (!link || !till || link.usedAt || link.expiresAt <= now || link.generation === undefined || link.generation !== till.pairGeneration) {
			await enforceRateLimit(ctx, 'display:claim', INVALID_CLAIM_LIMIT, PAIRING_TTL_MS);
			return { ok: false, code: 'LINK_INVALID' };
		}
		await ctx.db.patch(link._id, { usedAt: now });
		await deletePending(ctx, args.previousToken);
		await revokeActive(ctx, link.tillId);
		await retireLinks(ctx, till);
		await handOver(ctx, till, link.driverId, undefined);
		const token = randomSecret();
		await ctx.db.insert('displays', { tillId: link.tillId, name: deviceLabel(args.deviceName), tokenHash: await sha256(token), status: 'active', createdAt: now, pairedAt: now });
		return { ok: true, token };
	}
});

/**
 * Public: the display asks for a code to show. Staff type it into the checkout (approveCode).
 * `previousToken` is the display's last token. If staff approved it meanwhile, it is kept
 * (`status: 'active'`); if still pending, its row is replaced, so refreshes leave no orphans.
 */
export const startPairing = mutation({
	args: { deviceName: v.optional(v.string()), previousToken: v.optional(v.string()) },
	handler: async (ctx, args): Promise<{ status: 'active' } | { status: 'pending'; token: string; code: string; expiresAt: number }> => {
		const previous = args.previousToken ? await displayByToken(ctx, args.previousToken) : null;
		if (previous?.status === 'active') return { status: 'active' };
		await enforceRateLimit(ctx, 'display:start', START_PAIRING_LIMIT, PAIRING_TTL_MS);
		if (previous?.status === 'pending') await ctx.db.delete(previous._id);
		const till = await ensureDefaultTill(ctx);
		let code: string | null = null;
		for (let attempt = 0; attempt < 5 && !code; attempt++) {
			const candidate = randomPairCode();
			if (!(await ctx.db.query('displays').withIndex('by_pairCode', (q) => q.eq('pairCode', candidate)).first())) code = candidate;
		}
		if (!code) throw displayError('CODE_UNAVAILABLE', 'Could not create a code. Try again');
		const token = randomSecret();
		const now = Date.now();
		const expiresAt = now + PAIRING_TTL_MS;
		await ctx.db.insert('displays', {
			tillId: till._id, name: deviceLabel(args.deviceName), tokenHash: await sha256(token), status: 'pending',
			pairCode: code, pairCodeExpiresAt: expiresAt, createdAt: now
		});
		return { status: 'pending', token, code, expiresAt };
	}
});

/** Admin: activate the display showing this code, driven by this browser. Only admins can try codes, so they can't be brute-forced. */
export const approveCode = mutation({
	args: { code: v.string(), clientId: v.string() },
	handler: async (ctx, args) => {
		await requireStaff(ctx, 'checkout');
		const driverId = checkClientId(args.clientId);
		const code = normalizePairCode(args.code);
		if (code.length !== PAIR_CODE_LENGTH) throw displayError('INVALID_CODE', `Enter the ${PAIR_CODE_LENGTH}-character code shown on the display`);
		const display = await ctx.db.query('displays').withIndex('by_pairCode', (q) => q.eq('pairCode', code)).first();
		if (!display || display.status !== 'pending') throw displayError('CODE_NOT_FOUND', 'No display is showing that code');
		if ((display.pairCodeExpiresAt ?? 0) <= Date.now()) throw displayError('CODE_EXPIRED', 'That code has expired. Check the display for a new code');
		await revokeActive(ctx, display.tillId);
		await ctx.db.patch(display._id, { status: 'active', pairCode: undefined, pairCodeExpiresAt: undefined, pairedAt: Date.now() });
		const till = await ctx.db.get(display.tillId);
		if (till) {
			await retireLinks(ctx, till);
			await handOver(ctx, till, driverId, undefined);
		}
		return { displayId: display._id, name: display.name };
	}
});

/** Admin: this tab takes the display over from another checkout, showing its own order (`orderId`) straight away. */
export const takeDisplay = mutation({
	args: { clientId: v.string(), orderId: v.union(v.string(), v.null()) },
	handler: async (ctx, args) => {
		await requireStaff(ctx, 'checkout');
		await handOver(ctx, await ensureDefaultTill(ctx), checkClientId(args.clientId), orderIdFrom(ctx, args.orderId));
		return null;
	}
});

/**
 * Admin: the driving checkout tab publishes the order on screen (null: a new, empty order) under
 * `leaseId`, its mount's lease. From any other tab it does nothing (`shown: false`). The id comes
 * from a URL (see orderIdFrom). Each publish also marks the order active, so a draft left on
 * screen idles only once nobody touches it. A publish without a lease (a checkout loaded before
 * leases) is shown for one lease, as if never renewed.
 */
export const showOrder = mutation({
	args: { orderId: v.union(v.string(), v.null()), clientId: v.string(), leaseId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireStaff(ctx, 'checkout');
		const till = await getDefaultTill(ctx);
		if (!till?.driverId || till.driverId !== args.clientId) return { shown: false };
		const orderId = orderIdFrom(ctx, args.orderId);
		const leaseId = orderId ? (args.leaseId === undefined ? randomSecret() : checkLeaseId(args.leaseId)) : undefined;
		await ctx.db.patch(till._id, { orderId, publishedAt: Date.now(), leaseId });
		await setLease(ctx, till._id, leaseId);
		return { shown: true };
	}
});

/**
 * Admin: the driving checkout, still showing `orderId`, keeps its lease. Renewing is not customer
 * activity (`publishedAt` stays). If the lease ran out meanwhile (the tab slept or lost its
 * connection), the order comes back under it, still idle-timed from its last real activity.
 * `renewed: false` once another tab drives, a newer lease holds the till, or this lease was
 * released or published nothing (a new sale), so a late renewal never brings an order back.
 */
export const renewDriverLease = mutation({
	args: { clientId: v.string(), leaseId: v.string(), orderId: v.union(v.string(), v.null()) },
	handler: async (ctx, args): Promise<{ renewed: boolean }> => {
		await requireStaff(ctx, 'checkout');
		const leaseId = checkLeaseId(args.leaseId);
		const till = await getDefaultTill(ctx);
		const orderId = orderIdFrom(ctx, args.orderId);
		if (!till?.driverId || till.driverId !== args.clientId || till.leaseId !== leaseId || !orderId) return { renewed: false };
		if (till.orderId && till.orderId !== orderId) return { renewed: false };
		// Only an expired current lease can resume. A released or superseded lease cannot republish.
		if (!till.orderId) await ctx.db.patch(till._id, { orderId });
		await setLease(ctx, till._id, leaseId);
		return { renewed: true };
	}
});

/**
 * Public: the checkout that published under `leaseId` is going away (another page, sign-out), so
 * its open order leaves the screen now. Needs no sign-in, since it runs as staff sign out; it can
 * only clear, and only with this tab's id and lease, so an earlier mount's cleanup never clears a
 * newer publish or another tab's take-over.
 */
export const releaseDisplay = mutation({
	args: { clientId: v.string(), leaseId: v.string() },
	handler: async (ctx, args) => {
		if (args.leaseId.length > CLIENT_ID_MAX) return null;
		const till = await getDefaultTill(ctx);
		if (!till?.leaseId || till.leaseId !== args.leaseId || till.driverId !== args.clientId) return null;
		await endLease(ctx, till);
		return null;
	}
});

/** Scheduled at a lease's expiry: ends it unless it was renewed (then checks again then) or superseded. */
export const expireLease = internalMutation({
	args: { tillId: v.id('tills'), leaseId: v.string() },
	handler: async (ctx, args) => {
		const till = await ctx.db.get(args.tillId);
		if (!till || till.leaseId !== args.leaseId) return null;
		const lease = await leaseOf(ctx, till._id);
		if (lease?.leaseId === args.leaseId && lease.expiresAt > Date.now()) {
			await ctx.scheduler.runAt(lease.expiresAt, internal.displays.expireLease, args);
			return null;
		}
		await endLease(ctx, till, true);
		return null;
	}
});

/** Public: what the display shows. Read-only, and returns only the customer-facing projection. */
export const current = query({
	args: { token: v.string() },
	handler: async (ctx, args): Promise<DisplayState> => {
		const display = await displayByToken(ctx, args.token);
		if (!display || display.status === 'revoked') return { state: 'unpaired' };
		if (display.status === 'pending') {
			return display.pairCode && (display.pairCodeExpiresAt ?? 0) > Date.now() ? { state: 'pending', code: display.pairCode } : { state: 'unpaired' };
		}
		return await displayOrderState(ctx, await ctx.db.get(display.tillId));
	}
});

/** Public: every 30s from an active display. Writes only `displayPresence`. */
export const heartbeat = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const display = await displayByToken(ctx, args.token);
		if (display?.status !== 'active') return null;
		const presence = await presenceOf(ctx, display._id);
		if (presence) await ctx.db.patch(presence._id, { lastSeenAt: Date.now() });
		else await ctx.db.insert('displayPresence', { displayId: display._id, lastSeenAt: Date.now() });
		return null;
	}
});

/** Admin: the paired displays, and whether this tab (`clientId`), another checkout or none drives them. */
export const listDisplays = query({
	args: { clientId: v.string() },
	handler: async (ctx, args): Promise<{ displays: Array<{ _id: Id<'displays'>; name: string; pairedAt: number; lastSeenAt: number | null }>; driver: DisplayDriver }> => {
		await requireStaff(ctx, 'checkout');
		const till = await getDefaultTill(ctx);
		if (!till) return { displays: [], driver: 'none' };
		const active = await activeDisplays(ctx, till._id).take(20);
		const displays = await Promise.all(active.map(async (display) => ({
			_id: display._id,
			name: display.name,
			pairedAt: display.pairedAt ?? display.createdAt,
			lastSeenAt: (await presenceOf(ctx, display._id))?.lastSeenAt ?? null
		})));
		const driver = !till.driverId ? 'none' : till.driverId === args.clientId ? 'here' : 'elsewhere';
		return { displays, driver };
	}
});

/** Admin: disconnect a display, cancelling any pairing link still outstanding. With none left, no checkout drives the display and no order is shown. */
export const revoke = mutation({
	args: { displayId: v.id('displays') },
	handler: async (ctx, args) => {
		await requireStaff(ctx, 'checkout');
		const display = await ctx.db.get(args.displayId);
		if (!display || display.status === 'revoked') return null;
		await ctx.db.patch(display._id, { status: 'revoked', revokedAt: Date.now(), pairCode: undefined, pairCodeExpiresAt: undefined });
		await deletePresence(ctx, display._id);
		const till = await ctx.db.get(display.tillId);
		if (!till) return null;
		await retireLinks(ctx, till);
		if (!(await activeDisplays(ctx, till._id).first())) await handOver(ctx, till, undefined, undefined);
		return null;
	}
});

/** Cron: pending displays whose code was never entered, and expired (or used and since expired) pairing links. */
export const cleanPending = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const cutoff = now - PAIRING_TTL_MS;
		let deleted = 0;
		for (const till of await ctx.db.query('tills').take(10)) {
			const stale = await ctx.db.query('displays').withIndex('by_tillId_and_status', (q) => q.eq('tillId', till._id).eq('status', 'pending').lt('_creationTime', cutoff)).take(CLEAN_BATCH - deleted);
			for (const display of stale) await ctx.db.delete(display._id);
			deleted += stale.length;
			if (deleted >= CLEAN_BATCH) break;
		}
		const links = await ctx.db.query('displayPairLinks').withIndex('by_expiresAt', (q) => q.lt('expiresAt', now)).take(CLEAN_BATCH);
		for (const link of links) await ctx.db.delete(link._id);
		if (deleted >= CLEAN_BATCH || links.length === CLEAN_BATCH) await ctx.scheduler.runAfter(0, internal.displays.cleanPending, {});
		return { displays: deleted, links: links.length };
	}
});
