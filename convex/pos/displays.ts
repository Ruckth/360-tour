import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { deviceMutation, deviceQuery, internalMutation, maintenancePaused, publicMutation, staffMutation, staffQuery } from '../auth/model';
import { PAIR_CODE_LENGTH, normalizePairCode, randomPairCode, randomSecret, sha256 } from '../lib/displayTokens';
import { displayOrderState } from '../lib/displayView';
import { enforceRateLimit } from '../lib/rateLimit';
import { CLEAN_BATCH, CLIENT_ID_MAX, DisplayDriver, DisplayState, INVALID_CLAIM_LIMIT, PAIRING_TTL_MS, SECRET_MAX, START_PAIRING_LIMIT, activeDisplays, checkClientId, checkLeaseId, deletePending, deletePresence, deviceLabel, displayByToken, displayError, endLease, ensureDefaultTill, getDefaultTill, handOver, leaseOf, orderIdFrom, presenceOf, retireLinks, revokeActive, setLease } from './private/displayModel';

/**
 * Admin: a one-time link secret. Only its hash is stored, so this is the only time it can be read.
 * Making a link cancels any earlier one still outstanding.
 */
export const createPairLink = staffMutation({
  capability: 'checkout',
	args: { clientId: v.string() },
	handler: async (ctx, args) => {
		const { email } = ctx.staff;
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
export const claimLink = publicMutation({
  reason: "One-use expiring pairing link; generation, replay and rate-limit checks stay in the handler.",
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
export const startPairing = publicMutation({
  reason: "Anonymous pairing bootstrap; rate limited, no order data returned.",
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
export const approveCode = staffMutation({
  capability: 'checkout',
	args: { code: v.string(), clientId: v.string() },
	handler: async (ctx, args) => {
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
export const takeDisplay = staffMutation({
  capability: 'checkout',
	args: { clientId: v.string(), orderId: v.union(v.string(), v.null()) },
	handler: async (ctx, args) => {
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
export const showOrder = staffMutation({
  capability: 'checkout',
	args: { orderId: v.union(v.string(), v.null()), clientId: v.string(), leaseId: v.optional(v.string()) },
	handler: async (ctx, args) => {
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
export const renewDriverLease = staffMutation({
  capability: 'checkout',
	args: { clientId: v.string(), leaseId: v.string(), orderId: v.union(v.string(), v.null()) },
	handler: async (ctx, args): Promise<{ renewed: boolean }> => {
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
export const releaseDisplay = publicMutation({
  reason: "Sign-out cleanup capability; matching driver and lease may only clear the display.",
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
			await ctx.scheduler.runAt(lease.expiresAt, internal.pos.displays.expireLease, args);
			return null;
		}
		await endLease(ctx, till, true);
		return null;
	}
});

/** Public: what the display shows. Read-only, and returns only the customer-facing projection. */
export const current = deviceQuery({
	args: { token: v.string() },
	handler: async (ctx): Promise<DisplayState> => {
		const display = ctx.device;
		if (!display || display.status === 'revoked') return { state: 'unpaired' };
		if (display.status === 'pending') {
			return display.pairCode && (display.pairCodeExpiresAt ?? 0) > Date.now() ? { state: 'pending', code: display.pairCode } : { state: 'unpaired' };
		}
		return await displayOrderState(ctx, await ctx.db.get(display.tillId));
	}
});

/** Public: every 30s from an active display. Writes only `displayPresence`. */
export const heartbeat = deviceMutation({
	args: { token: v.string() },
	handler: async (ctx) => {
		const display = ctx.device;
		if (display?.status !== 'active') return null;
		const presence = await presenceOf(ctx, display._id);
		if (presence) await ctx.db.patch(presence._id, { lastSeenAt: Date.now() });
		else await ctx.db.insert('displayPresence', { displayId: display._id, lastSeenAt: Date.now() });
		return null;
	}
});

/** Admin: the paired displays, and whether this tab (`clientId`), another checkout or none drives them. */
export const listDisplays = staffQuery({
  capability: 'checkout',
	args: { clientId: v.string() },
	handler: async (ctx, args): Promise<{ displays: Array<{ _id: Id<'displays'>; name: string; pairedAt: number; lastSeenAt: number | null }>; driver: DisplayDriver }> => {
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
export const revoke = staffMutation({
  capability: 'checkout',
	args: { displayId: v.id('displays') },
	handler: async (ctx, args) => {
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
    if (maintenancePaused()) return { displays: 0, links: 0 };
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
		if (deleted >= CLEAN_BATCH || links.length === CLEAN_BATCH) await ctx.scheduler.runAfter(0, internal.pos.displays.cleanPending, {});
		return { displays: deleted, links: links.length };
	}
});
