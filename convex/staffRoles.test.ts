import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { APPROVAL_TTL_MS, DEFAULT_CASHIER_RULES, STAFF_INVITATION_TTL_MS, type ApprovalPayload, type CashierRules } from './shared/staffTypes';
import schema from './schema';
import { requireAdmin } from './auth/private/adminAuth';

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-12T03:00:00Z');
beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner' });
  const manager = t.withIdentity({ email: 'manager@example.com', tokenIdentifier: 'issuer|manager' });
  const cashier = t.withIdentity({ email: 'cashier@example.com', tokenIdentifier: 'issuer|cashier' });
  for (const [email, role, client] of [
    ['manager@example.com', 'manager', manager], ['cashier@example.com', 'cashier', cashier],
  ] as const) {
    await owner.mutation(api.auth.staffAccess.setGrant, { email, role });
    await client.mutation(api.auth.staffAccess.claimInvite, {});
  }
  const serviceId = await t.run(ctx => ctx.db.insert('services', {
    slug: 'staff-test', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 100000, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
  }));
  const propertyId = await t.run(ctx => ctx.db.insert('properties', {
    slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100000, currency: 'THB', maxGuests: 4,
    bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active',
  }));
  const sale = () => cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'service', serviceId } });
  const view = async (orderId: Id<'orders'>) => (await cashier.query(api.pos.orders.getOrder, { orderId }))!;
  const pay = async (orderId: Id<'orders'>) => {
    const current = await view(orderId);
    return await cashier.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, idempotencyKey: `payment:${orderId}`, expectedDue: current.totals.due,
      expectedRevision: current.order.revision, tenders: current.totals.due ? [{ method: 'cash', amount: current.totals.due }] : [],
      ...(current.customer && 'revision' in current.customer ? { expectedCustomerRevision: current.customer.revision } : {}),
    });
  };
  const rules = async (patch: Partial<Omit<CashierRules, 'revision'>>) => {
    const current = await owner.query(api.settings.cashierRules.getCashierRules, {});
    const { revision, ...fields } = current;
    return await owner.mutation(api.settings.cashierRules.updateCashierRules, { expectedRevision: revision, ...fields, ...patch });
  };
  const request = (orderId: Id<'orders'>, payload: ApprovalPayload) => cashier.mutation(api.pos.staffApprovals.create, { orderId, payload, reason: 'Guest recovery' });
  const discountRequest = (orderId: Id<'orders'>, lineId: Id<'orderLines'>) => request(orderId, { kind: 'discount', lineId, discount: { type: 'amount', value: 10001 } });
  const coupon = async () => {
    const { couponId } = await owner.mutation(api.marketing.commands.saveCoupon.saveCoupon, { code: 'TWENTY', scope: 'services', benefit: { kind: 'percent', percent: 2000 } });
    await owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    return couponId;
  };
  const booking = () => t.run(ctx => insertFixture(ctx, 'bookings', {
    propertyId, guestName: 'Guest', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678', checkIn: '2026-11-13', checkOut: '2026-11-14',
    guests: 2, nights: 1, subtotal: 100000, discountAmount: 0, total: 100000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: now,
  }));
  const appointment = (price = 100000, bookingId?: Id<'bookings'>) => t.run(async ctx => {
    const staffId = await ctx.db.insert('staff', { name: 'Therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: now, updatedAt: now });
    return await insertFixture(ctx, 'appointments', {
      serviceId, staffId, start: now + 3_600_000, end: now + 7_200_000, blockedUntil: now + 7_200_000,
      guestName: 'Appointment guest', guestPhone: '0800000000', source: 'admin', status: 'booked', paymentStatus: 'unpaid',
      price, currency: 'THB', confirmationCode: 'APPT', accessToken: 'test-only', createdAt: now, ...(bookingId ? { bookingId } : {}),
    });
  });
  return { t, owner, manager, cashier, serviceId, propertyId, sale, view, pay, rules, request, discountRequest, coupon, booking, appointment };
}
const needsApproval = (kind: string) => ({ data: expect.objectContaining({ code: 'NEEDS_APPROVAL', kind }) });

describe('staff permissions and invitations', () => {
  it('keeps allowlisted owners unchanged without grants, even with a corrupt cashier grant', async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' });
    expect(await owner.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role: 'owner', cashierRules: DEFAULT_CASHIER_RULES,
      capabilities: { checkout: true, approve: true, settings: true, manageTeam: true, bookings: true, marketing: true } });
    await owner.mutation(api.settings.settings.update, { business: { businessName: 'Still owner' } });
    await t.run(ctx => ctx.db.insert('staffGrants', { email: 'owner@example.com', tokenIdentifier: 'owner', role: 'cashier', createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com' }));
    expect((await owner.query(api.auth.staffAccess.myAccess, {})).role).toBe('owner');
    await expect(owner.mutation(api.auth.staffAccess.setGrant, { email: 'OWNER@example.com', role: 'cashier' })).rejects.toThrow('cannot be downgraded');
    await owner.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Owner charge', price: 100000 } });
  });

  it('gives managers operations, but no settings writes, Team or implicit marketing access', async () => {
    const s = await setup();
    expect(await s.manager.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role: 'manager', capabilities: { checkout: true, approve: true, manageTeam: false, settings: false, bookings: true, marketing: false } });
    await expect(s.manager.query(api.settings.settings.get, {})).resolves.toBeTruthy();
    await expect(s.manager.query(api.services.admin.listServices, {})).resolves.toHaveLength(1);
    await expect(s.manager.mutation(api.settings.settings.update, { business: { businessName: 'Denied' } })).rejects.toThrow('Not authorized');
    await expect(s.manager.mutation(api.settings.settings.restore, { expectedRevision: 0, side: 'after', historyId: await s.t.run(ctx => ctx.db.insert('recordChanges', { entityType: 'settings', entityId: 'default', actor: 'owner@example.com', kind: 'updated', recordedAt: now, effectiveAt: now })) })).rejects.toThrow('Not authorized');
    await expect(s.manager.query(api.auth.staffAccess.listPeople, {})).rejects.toThrow('Not authorized');
    await expect(s.manager.mutation(api.auth.staffAccess.setGrant, { email: 'next@example.com', role: 'manager' })).rejects.toThrow('Not authorized');
    await expect(s.manager.query(api.marketing.access.listGrants, {})).rejects.toThrow('Not authorized');
    await expect(s.manager.query(api.settings.recordHistory.list, { entityType: 'marketingGrant', paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow('Not authorized');
    expect(await s.manager.action(ctx => requireAdmin(ctx))).toEqual({ email: 'manager@example.com' });
    await expect(s.cashier.action(ctx => requireAdmin(ctx))).rejects.toThrow('Not authorized');
  });

  it('denies direct cashier calls outside checkout and exposes only search contact cards', async () => {
    const s = await setup();
    const customerId = await s.owner.mutation(api.pos.customers.createCustomer, { name: 'Alice', notes: 'Private guest details', email: 'alice@example.com' });
    await expect(s.cashier.query(api.settings.settings.get, {})).rejects.toThrow('Not authorized');
    await expect(s.cashier.query(api.services.admin.listServices, {})).rejects.toThrow('Not authorized');
    await expect(s.cashier.query(api.auth.staffAccess.listPeople, {})).rejects.toThrow('Not authorized');
    await expect(s.cashier.query(api.pos.orders.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow('Not authorized');
    await expect(s.cashier.query(api.pos.customers.getCustomer, { customerId })).rejects.toThrow('Not authorized');
    await expect(s.cashier.mutation(api.pos.customers.updateCustomer, { customerId, expectedRevision: 0, name: 'Changed' })).rejects.toThrow('Not authorized');
    await expect(s.cashier.mutation(api.pos.customers.createCustomer, { name: 'New guest', notes: 'No' })).rejects.toThrow('Not authorized');
    expect(await s.cashier.query(api.pos.customers.checkoutCustomer, { customerId })).not.toHaveProperty('notes');
    expect(await s.cashier.query(api.pos.customers.searchCustomers, { query: 'Alice' })).toMatchObject([{ name: 'Alice' }]);
    expect((await s.cashier.query(api.pos.customers.browseCustomers, { query: '', archived: false, paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([]);
    const bookingId = await s.booking();
    await expect(s.cashier.query(api.bookings.admin.getForAdmin, { bookingId })).rejects.toThrow('Not authorized');
    await expect(s.cashier.mutation(api.bookings.commands.recordRefund.recordRefund, { bookingId, expectedRevision: 0, amount: 100, currency: 'THB', method: 'cash', reason: 'No', idempotencyKey: 'cashier-refund' })).rejects.toThrow('Not authorized');
  });

  it('uses identity-bound claims, expiry, explicit resend, role change and revoke', async () => {
    const s = await setup();
    const client = s.t.withIdentity({ email: 'invite@example.com', tokenIdentifier: 'issuer|invite' });
    const impostor = s.t.withIdentity({ email: 'invite@example.com', tokenIdentifier: 'different-issuer|invite' });
    const grantId = await s.owner.mutation(api.auth.staffAccess.setGrant, { email: ' INVITE@example.com ', role: 'cashier' });
    expect((await client.query(api.auth.staffAccess.myAccess, {})).pendingInvitation).toMatchObject({ role: 'cashier', expiresAt: now + STAFF_INVITATION_TTL_MS });
    expect((await client.query(api.auth.staffAccess.myAccess, {})).role).toBeNull();
    vi.mocked(Date.now).mockReturnValue(now + STAFF_INVITATION_TTL_MS);
    await expect(client.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('Invitation expired');
    await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'invite@example.com', role: 'manager' });
    await expect(client.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('Invitation expired');
    await s.owner.mutation(api.auth.staffAccess.updateInvitation, { grantId: grantId!, action: 'resend' });
    await client.mutation(api.auth.staffAccess.claimInvite, {});
    await client.mutation(api.auth.staffAccess.claimInvite, {});
    expect((await client.query(api.auth.staffAccess.myAccess, {})).role).toBe('manager');
    expect((await impostor.query(api.auth.staffAccess.myAccess, {})).role).toBeNull();
    await expect(impostor.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('No unclaimed');
    await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'invite@example.com', role: 'cashier' });
    expect((await client.query(api.auth.staffAccess.myAccess, {})).role).toBe('cashier');
    await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'invite@example.com', role: null });
    expect((await client.query(api.auth.staffAccess.myAccess, {})).role).toBeNull();
  });

  it('expires invites and combines independent staff/marketing grants without granting marketing by role', async () => {
    const s = await setup();
    const id = await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'invite@example.com', role: 'cashier' });
    await s.owner.mutation(api.auth.staffAccess.updateInvitation, { grantId: id!, action: 'expire' });
    await s.owner.mutation(api.marketing.access.setGrant, { email: 'cashier@example.com', role: 'viewer' });
    await s.cashier.mutation(api.marketing.access.claimInvite, {});
    const people = await s.owner.query(api.auth.staffAccess.listPeople, {});
    expect(people.find(p => p.email === 'owner@example.com')).toMatchObject({ role: 'owner' });
    expect(people.find(p => p.email === 'cashier@example.com')).toMatchObject({ role: 'cashier', staffGrant: { role: 'cashier', claimed: true }, marketingGrant: { role: 'viewer', claimed: true } });
    expect(people.find(p => p.email === 'invite@example.com')).toMatchObject({ staffGrant: { expired: true } });
    expect((await s.cashier.query(api.auth.staffAccess.myAccess, {})).capabilities.marketing).toBe(true);
  });

  it('validates rule limits and optimistic revisions', async () => {
    const s = await setup();
    for (const discountLimitPercent of [-1, 10001, 100.1]) await expect(s.rules({ discountLimitPercent })).rejects.toThrow('two decimals');
    await s.rules({ discountLimitPercent: 1234 });
    const { revision, ...defaults } = DEFAULT_CASHIER_RULES;
    await expect(s.owner.mutation(api.settings.cashierRules.updateCashierRules, { ...defaults, expectedRevision: revision })).rejects.toMatchObject({ data: expect.objectContaining({ code: 'STALE_RULES' }) });
    await expect(s.manager.mutation(api.settings.cashierRules.updateCashierRules, { ...defaults, expectedRevision: 1 })).rejects.toThrow('Not authorized');
  });
});

describe('cashier money boundaries', () => {
  it.each(['amount', 'percent'] as const)('enforces inclusive ten percent in satang for %s and replacement edits', async type => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const value = type === 'amount' ? 10000 : 1000;
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type, value } });
    expect((await s.view(orderId)).totals.total).toBe(90000);
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type, value: value / 2 } });
    expect((await s.view(orderId)).totals.total).toBe(95000);
    await expect(s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type, value: type === 'amount' ? 10001 : 1001 } })).rejects.toMatchObject({ data: expect.objectContaining({ code: 'NEEDS_APPROVAL', amount: type === 'amount' ? 10001 : 10010, subtotalSatang: 100000, limitSatang: 10000 }) });
    expect((await s.view(orderId)).totals.total).toBe(95000);
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: null });
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type, value } });
    expect((await s.view(orderId)).totals.total).toBe(90000);
  });

  it('uses current quantity and rounds half-satang like the existing bill math', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'room', propertyId: s.propertyId } });
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, qtyChange: 1, discount: { type: 'amount', value: 20000 } });
    expect((await s.view(orderId)).totals.total).toBe(180000);
    await expect(s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, qtyChange: -1 })).rejects.toMatchObject(needsApproval('discount'));
    await s.t.run(ctx => ctx.db.patch(s.serviceId, { price: 1005 }));
    const tiny = await s.sale();
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId: tiny.lineId, discount: { type: 'percent', value: 1000 } });
    expect((await s.view(tiny.orderId)).totals.total).toBe(904);
  });

  it('allows coupons over 10%, a linked customer, payment, receipt and customer display operations', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const customerId = await s.cashier.mutation(api.pos.customers.createCustomer, { name: 'Buyer', email: 'buyer@example.com' });
    await s.cashier.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
    await s.coupon();
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 10000 } });
    await s.cashier.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'TWENTY' });
    expect((await s.view(orderId)).totals).toMatchObject({ total: 72000, coupon: 18000 });
    await s.cashier.mutation(api.pos.commands.removeOrderCoupon.removeOrderCoupon, { orderId });
    await s.cashier.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'TWENTY' });
    await s.cashier.mutation(api.pos.displays.takeDisplay, { clientId: 'cashier-browser', orderId });
    expect(await s.cashier.mutation(api.pos.displays.showOrder, { clientId: 'cashier-browser', orderId })).toEqual({ shown: true });
    expect(await s.pay(orderId)).toMatchObject({ receiptNumber: 1, replayed: false });
    expect(await s.pay(orderId)).toMatchObject({ receiptNumber: 1, replayed: true });
    expect((await s.view(orderId)).receiptCustomer).toMatchObject({ name: 'Buyer' });
    await s.cashier.query(api.pos.orderHistoryPages.audit, { orderId, paginationOpts: { numItems: 20, cursor: null } });
  });

  it('requires custom-price permission, and granting it never bypasses the manual discount limit', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await expect(s.cashier.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, { lineId, price: 90000, note: 'Discount' })).rejects.toMatchObject(needsApproval('customPrice'));
    await expect(s.cashier.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'extra', name: 'Custom', price: 100 } })).rejects.toMatchObject(needsApproval('customPrice'));
    await s.rules({ customPrice: 'cashier' });
    await s.cashier.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, { lineId, price: 95000, note: 'Partial reduction' });
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 5000 } });
    expect((await s.view(orderId)).totals.total).toBe(90000);
    await expect(s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 5001 } })).rejects.toMatchObject(needsApproval('discount'));
    await expect(s.cashier.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, { lineId, price: 90000, note: 'Retained discount' })).rejects.toMatchObject(needsApproval('discount'));
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: null });
    await expect(s.cashier.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, { lineId, price: 89999, note: 'Over limit' })).rejects.toMatchObject(needsApproval('discount'));
    await s.cashier.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'extra', name: 'Custom', price: 2000 } });
  });

  it.each(['owner', 'manager'] as const)('uses the %s booking override as baseline across refresh and reattachment', async role => {
    const s = await setup();
    const bookingId = await s.booking();
    const { orderId } = await s.cashier.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
    const lineId = (await s.view(orderId)).lines[0]._id;
    await s.t.run(ctx => ctx.db.patch(bookingId, { total: 80000, providerRefundWaived: 10000, priceOverride: { total: 80000, quotedTotal: 100000, reason: 'Recovery', by: `${role}@example.com`, at: now } }));
    await expect(s.cashier.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId })).rejects.toMatchObject(needsApproval('customPrice'));
    await s.rules({ customPrice: 'cashier' });
    await s.cashier.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId });
    expect(await s.t.run(ctx => ctx.db.get(lineId))).toMatchObject({ unitPrice: 70000, catalogUnitPrice: 70000 });
    await s.cashier.mutation(api.pos.commands.removeLine.removeLine, { lineId });
    await s.cashier.mutation(api.pos.commands.attach.attach, { orderId, bookingId });
    expect(await s.t.run(ctx => ctx.db.get(lineId))).toBeNull();
    expect((await s.view(orderId)).totals.total).toBe(70000);
    expect(await s.cashier.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId })).toEqual({ orderId });
  });
});

describe('atomic manager approvals', () => {
  it('records exact proposal without moving money, blocks payment, then executes once with actor audit', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const before = await s.view(orderId);
    const result = await s.discountRequest(orderId, lineId);
    expect(result).toMatchObject({ status: 'pending', totalBefore: 100000, totalAfter: 89999, amount: 10001, percent: 1000 });
    expect((await s.view(orderId)).order.revision).toBe(before.order.revision);
    expect((await s.view(orderId)).totals.total).toBe(100000);
    await expect(s.pay(orderId)).rejects.toMatchObject({ data: expect.objectContaining({ code: 'PENDING_APPROVAL' }) });
    expect(await s.manager.query(api.pos.staffApprovals.pending, {})).toMatchObject({ count: 1, list: [{ requesterEmail: 'cashier@example.com', reason: 'Guest recovery', amount: 10001 }] });
    expect((await s.cashier.query(api.pos.staffApprovals.forOrder, { orderId }))[0]).not.toHaveProperty('orderFingerprint');
    await expect(s.cashier.mutation(api.pos.staffApprovals.approve, { requestId: result.requestId })).rejects.toThrow('Not authorized');
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: result.requestId })).toEqual({ status: 'applied', replayed: false });
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: result.requestId })).toEqual({ status: 'applied', replayed: true });
    expect((await s.view(orderId)).totals.total).toBe(89999);
    expect((await s.view(orderId)).order.revision).toBe(before.order.revision + 1);
    expect((await s.cashier.query(api.pos.staffApprovals.forOrder, { orderId }))[0]).toMatchObject({ status: 'applied', approverEmail: 'manager@example.com' });
    const log = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'order').eq('entityId', orderId)).take(20));
    expect(log.find(row => row.kind === 'line_updated')?.actor).toBe('manager@example.com');
    await s.pay(orderId);
  });

  it.each(['cancel', 'reject'] as const)('%s leaves the order unchanged and releases payment', async action => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const { requestId } = await s.discountRequest(orderId, lineId);
    const response = action === 'cancel' ? await s.cashier.mutation(api.pos.staffApprovals.cancel, { requestId }) : await s.manager.mutation(api.pos.staffApprovals.reject, { requestId });
    expect(response.status).toBe(action === 'cancel' ? 'cancelled' : 'rejected');
    expect((await s.view(orderId)).totals.total).toBe(100000);
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId })).toMatchObject({ status: response.status, replayed: true });
    await s.pay(orderId);
  });

  it.each(['line', 'coupon', 'couponCatalog', 'couponRestored', 'rules', 'revoke', 'role', 'roleRestored', 'regrant'] as const)('stales after %s changes and never applies old money', async change => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const couponId = await s.coupon();
    if (change === 'couponCatalog' || change === 'couponRestored') await s.cashier.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'TWENTY' });
    const { requestId } = await s.discountRequest(orderId, lineId);
    if (change === 'line') await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 100 } });
    if (change === 'coupon') await s.cashier.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'TWENTY' });
    if (change === 'couponCatalog' || change === 'couponRestored') await s.owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'paused' });
    if (change === 'couponRestored') await s.owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    if (change === 'rules') await s.rules({ discountLimitPercent: 2000 });
    if (change === 'role' || change === 'roleRestored') await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'cashier@example.com', role: 'manager' });
    if (change === 'roleRestored') await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'cashier@example.com', role: 'cashier' });
    if (change === 'revoke' || change === 'regrant') await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'cashier@example.com', role: null });
    if (change === 'regrant') {
      await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'cashier@example.com', role: 'cashier' });
      await s.cashier.mutation(api.auth.staffAccess.claimInvite, {});
    }
    expect(await s.manager.query(api.pos.staffApprovals.pending, {})).toEqual({ count: 0, list: [] });
    const before = (await s.owner.query(api.pos.orders.getOrder, { orderId }))!.totals.total;
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId })).toMatchObject({ status: 'stale' });
    expect((await s.owner.query(api.pos.orders.getOrder, { orderId }))!.totals.total).toBe(before);
  });

  it('expires exactly at five minutes, with unchanged money and a scheduled terminal status', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const { requestId } = await s.discountRequest(orderId, lineId);
    vi.mocked(Date.now).mockReturnValue(now + APPROVAL_TTL_MS);
    expect((await s.cashier.query(api.pos.staffApprovals.forOrder, { orderId }))[0].status).toBe('expired');
    await s.t.mutation(internal.pos.staffApprovals.expire, { requestId });
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId })).toMatchObject({ status: 'expired' });
    expect((await s.view(orderId)).totals.total).toBe(100000);
    await s.pay(orderId);
  });

  it('accepts just before expiry and rolls failed execution back with the request still pending', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const first = await s.discountRequest(orderId, lineId);
    vi.mocked(Date.now).mockReturnValue(now + APPROVAL_TTL_MS - 1);
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: first.requestId })).toMatchObject({ status: 'applied' });
    await s.pay(orderId);
    const invalid = await s.request(orderId, { kind: 'paymentFix', action: 'amendOrderPayment', tenders: [{ method: 'card', amount: 100 }] });
    await expect(s.manager.mutation(api.pos.staffApprovals.approve, { requestId: invalid.requestId })).rejects.toThrow('Payments add up');
    const view = await s.view(orderId);
    expect(view.corrections).toEqual([]);
    expect(view.paymentRecord.tenders).toEqual([{ method: 'cash', amount: 89999 }]);
    expect((await s.cashier.query(api.pos.staffApprovals.forOrder, { orderId }))[0].status).toBe('pending');
  });

  it('stales a source repricing request when the booked price changes again', async () => {
    const s = await setup();
    const bookingId = await s.booking();
    const { orderId } = await s.cashier.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
    const lineId = (await s.view(orderId)).lines[0]._id;
    await s.t.run(ctx => ctx.db.patch(bookingId, { total: 80000, priceOverride: { total: 80000, quotedTotal: 100000, reason: 'Recovery', by: 'owner@example.com', at: now } }));
    const first = await s.request(orderId, { kind: 'customPrice', action: 'updateSourceLine', lineId });
    expect(first).toMatchObject({ totalBefore: 100000, totalAfter: 80000, amount: 0, percent: 0 });
    await s.t.run(ctx => ctx.db.patch(bookingId, { total: 70000 }));
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: first.requestId })).toMatchObject({ status: 'stale' });
    expect((await s.view(orderId)).totals.total).toBe(100000);
    const next = await s.request(orderId, { kind: 'customPrice', action: 'updateSourceLine', lineId });
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: next.requestId });
    expect((await s.view(orderId)).totals.total).toBe(70000);
  });

  it('rejects self approval after promotion and approvers who lost access', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const { requestId } = await s.discountRequest(orderId, lineId);
    await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'cashier@example.com', role: 'manager' });
    await expect(s.cashier.mutation(api.pos.staffApprovals.approve, { requestId })).rejects.toThrow('own request');
    await s.owner.mutation(api.auth.staffAccess.setGrant, { email: 'manager@example.com', role: null });
    await expect(s.manager.mutation(api.pos.staffApprovals.approve, { requestId })).rejects.toThrow('Not authorized');
    expect((await s.view(orderId)).totals.total).toBe(100000);
  });

  it('validates reasons, target order, cancellation ownership and one pending request per order', async () => {
    const s = await setup();
    const first = await s.sale();
    const second = await s.sale();
    for (const reason of ['', ' ', 'x'.repeat(501)]) await expect(s.cashier.mutation(api.pos.staffApprovals.create, { orderId: first.orderId, reason, payload: { kind: 'discount', lineId: first.lineId, discount: { type: 'percent', value: 2000 } } })).rejects.toThrow('1–500');
    await expect(s.discountRequest(first.orderId, second.lineId)).rejects.toThrow('Item not found');
    const { requestId } = await s.discountRequest(first.orderId, first.lineId);
    await expect(s.discountRequest(first.orderId, first.lineId)).rejects.toMatchObject({ data: expect.objectContaining({ code: 'PENDING_APPROVAL' }) });
    await expect(s.manager.mutation(api.pos.staffApprovals.cancel, { requestId })).rejects.toThrow('Not authorized');
  });

  it('shows coupon-adjusted before/after totals and applies the frozen exact discount', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.coupon();
    await s.cashier.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'TWENTY' });
    const { requestId, totalBefore, totalAfter } = await s.discountRequest(orderId, lineId);
    expect([totalBefore, totalAfter]).toEqual([80000, 71999]);
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId });
    expect((await s.view(orderId)).totals.total).toBe(71999);
  });

  it.each(['overrideLinePrice', 'addCustomItem'] as const)('executes custom action %s once through the normal audit path', async action => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const payload: ApprovalPayload = action === 'overrideLinePrice' ? { kind: 'customPrice', action, lineId, price: 70000, note: 'Recovery' } : { kind: 'customPrice', action, name: 'Custom item', price: 2500 };
    const { requestId } = await s.request(orderId, payload);
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId });
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId });
    expect((await s.view(orderId)).totals.total).toBe(action === 'overrideLinePrice' ? 70000 : 102500);
    if (action === 'overrideLinePrice') expect((await s.view(orderId)).audit).toMatchObject([{ kind: 'price_override', actor: 'manager@example.com', toPrice: 70000 }]);
  });

  it.each(['voidPaidSale', 'paymentFix'] as const)('requires approval for %s, executes once and honors the cashier rule', async kind => {
    const s = await setup();
    const { orderId } = await s.sale();
    await s.pay(orderId);
    const args = { orderId, reason: 'Recorded mistake', expectedCorrectionRevision: 0, idempotencyKey: 'paid-fix-attempt' };
    if (kind === 'voidPaidSale') await expect(s.cashier.mutation(api.pos.commands.voidOrder.voidOrder, { orderId, reason: args.reason })).rejects.toMatchObject(needsApproval(kind));
    else await expect(s.cashier.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { ...args, tenders: [{ method: 'card', amount: 100000 }] })).rejects.toMatchObject(needsApproval(kind));
    const payload: ApprovalPayload = kind === 'voidPaidSale' ? { kind } : { kind, action: 'amendOrderPayment', tenders: [{ method: 'card', amount: 100000 }] };
    const { requestId } = await s.request(orderId, payload);
    expect((await s.view(orderId)).order.status).toBe('paid');
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId });
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId });
    const view = await s.view(orderId);
    if (kind === 'voidPaidSale') expect(view.order.status).toBe('void');
    else expect(view.corrections).toMatchObject([{ kind: 'amended', actor: 'manager@example.com', sequence: 1 }]);
    await s.rules({ [kind]: 'cashier' });
    const next = await s.sale();
    await s.pay(next.orderId);
    if (kind === 'voidPaidSale') await s.cashier.mutation(api.pos.commands.voidOrder.voidOrder, { orderId: next.orderId, reason: 'Allowed' });
    else await s.cashier.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { ...args, orderId: next.orderId, tenders: [{ method: 'card', amount: 100000 }] });
  });

  it('executes paid linking, unlinking and unreceived reversals as payment fixes', async () => {
    const s = await setup();
    const bookingId = await s.booking();
    const { orderId, lineId } = await s.cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'room', propertyId: s.propertyId } });
    await s.pay(orderId);
    const direct = { orderId, lineId, bookingId, expectedTargetRevision: 0, expectedCorrectionRevision: 0, idempotencyKey: 'link-attempt', reason: 'Receipt for stay' };
    await expect(s.cashier.mutation(api.pos.commands.linkPaidLine.linkPaidLine, direct)).rejects.toMatchObject(needsApproval('paymentFix'));
    await s.manager.mutation(api.pos.commands.linkPaidLine.linkPaidLine, direct);
    const linkId = (await s.view(orderId)).links[0]._id;
    expect((await s.t.run(ctx => ctx.db.get(bookingId)))?.amountPaid).toBe(100000);
    await expect(s.cashier.mutation(api.pos.commands.unlinkPaidLine.unlinkPaidLine, { orderId, linkId, expectedCorrectionRevision: 1, idempotencyKey: 'unlink-attempt', reason: 'Wrong stay' })).rejects.toMatchObject(needsApproval('paymentFix'));
    await s.manager.mutation(api.pos.commands.unlinkPaidLine.unlinkPaidLine, { orderId, linkId, expectedCorrectionRevision: 1, idempotencyKey: 'manager-unlink', reason: 'Wrong stay' });
    expect((await s.t.run(ctx => ctx.db.get(bookingId)))?.amountPaid ?? 0).toBe(0);
    await expect(s.cashier.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 2, idempotencyKey: 'unreceived-attempt', reason: 'Nothing received' })).rejects.toMatchObject(needsApproval('paymentFix'));
    const voidRequest = await s.request(orderId, { kind: 'paymentFix', action: 'voidUnreceivedOrder' });
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: voidRequest.requestId });
    expect((await s.view(orderId)).order).toMatchObject({ status: 'void', voidUnreceived: true });
    const corrections = (await s.view(orderId)).corrections;
    expect(corrections).toHaveLength(3);
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: voidRequest.requestId });
    expect((await s.view(orderId)).corrections).toHaveLength(3);
  });
});


describe('staff-role audit regressions', () => {
  it.each([150000, 50000])('uses the agreed appointment price %s despite catalog drift', async price => {
    const s = await setup();
    const appointmentId = await s.appointment(price);
    const { orderId } = await s.cashier.mutation(api.pos.commands.openOrderFor.openOrderFor, { appointmentId });
    const lineId = (await s.view(orderId)).lines[0]._id;
    expect(await s.t.run(ctx => ctx.db.get(lineId))).toMatchObject({ unitPrice: price, catalogUnitPrice: price });
    await s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: price / 10 } });
    await expect(s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: price === 150000 ? 60000 : 5001 } })).rejects.toMatchObject(needsApproval('discount'));
  });

  it('never hides manual reduction behind a baseline below the line price', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    // Legacy/source snapshots can contain a baseline below their own pre-discount price.
    await s.t.run(ctx => ctx.db.patch(lineId, { unitPrice: 150000, catalogUnitPrice: 100000 }));
    await expect(s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 60000 } })).rejects.toMatchObject({ data: expect.objectContaining({ code: 'NEEDS_APPROVAL', amount: 60000, subtotalSatang: 150000 }) });
    const preview = await s.request(orderId, { kind: 'discount', lineId, discount: { type: 'amount', value: 60000 } });
    expect(preview).toMatchObject({ amount: 60000, percent: 4000 });
  });

  it.each(['openOrderFor', 'openOrderForLink'] as const)('%s preserves manager-approved discounts when reusing or extending an order', async endpoint => {
    const s = await setup();
    const bookingId = await s.booking();
    const { orderId } = await s.manager.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
    const { lineId } = await s.manager.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
    await s.manager.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 30000 } });
    const before = await s.view(orderId);
    expect(await s.cashier.mutation(({ openOrderFor: api.pos.commands.openOrderFor.openOrderFor, openOrderForLink: api.pos.commands.openOrderForLink.openOrderForLink })[endpoint], { bookingId })).toEqual({ orderId });
    expect((await s.view(orderId)).order.revision).toBe(before.order.revision);
    const appointmentId = await s.appointment(1000, bookingId);
    expect(await s.cashier.mutation(({ openOrderFor: api.pos.commands.openOrderFor.openOrderFor, openOrderForLink: api.pos.commands.openOrderForLink.openOrderForLink })[endpoint], { appointmentId })).toEqual({ orderId });
    const lines = (await s.view(orderId)).lines;
    expect(lines).toHaveLength(3);
    expect(lines.find(line => line._id === lineId)?.discount).toEqual({ type: 'amount', value: 30000 });
    const appointmentLine = lines.find(line => line.appointmentId === appointmentId)!;
    await s.manager.mutation(api.pos.commands.updateLine.updateLine, { lineId: appointmentLine._id, discount: { type: 'amount', value: 20000 } });
    expect(await s.cashier.mutation(({ openOrderFor: api.pos.commands.openOrderFor.openOrderFor, openOrderForLink: api.pos.commands.openOrderForLink.openOrderForLink })[endpoint], { appointmentId })).toEqual({ orderId });
    await expect(s.cashier.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 30100 } })).rejects.toMatchObject(needsApproval('discount'));
  });

  it('limits cashier receipt and history reads to unpaid or current business-date settlements', async () => {
    const s = await setup();
    const unpaid = await s.sale();
    const paid = await s.sale();
    await s.pay(paid.orderId);
    const number = (await s.view(paid.orderId)).order.orderNumber!;
    const missing = await s.t.run(async ctx => {
      const id = await insertFixture(ctx, 'orders', { status: 'draft', currency: 'THB', itemCount: 0, total: 0, hasItems: false, revision: 0, createdAt: now, updatedAt: now, createdBy: 'owner@example.com' });
      await ctx.db.delete(id);
      return id;
    });
    const historyQueries = [api.pos.orderHistoryPages.audit, api.pos.orderHistoryPages.corrections, api.pos.orderHistoryPages.bookingRefunds, api.pos.orderHistoryPages.appointmentRefunds, api.pos.orders.orderHistory];
    const paginationOpts = { numItems: 20, cursor: null };
    // 23:59 Bangkok yesterday is still the previous business day, unlike UTC date comparison.
    const beforeMidnight = Date.parse('2026-11-11T16:59:59.999Z');
    const midnight = beforeMidnight + 1;
    for (const at of [midnight, beforeMidnight, Date.parse('2026-11-12T17:00:00Z')]) {
      await s.t.run(ctx => ctx.db.patch(paid.orderId, { paymentEffectiveAt: at }));
      const visible = at === midnight;
      expect(Boolean(await s.cashier.query(api.pos.orders.getOrder, { orderId: paid.orderId }))).toBe(visible);
      expect(await s.cashier.query(api.pos.orders.findOrderByNumber, { orderNumber: number })).toBe(visible ? paid.orderId : null);
      for (const query of historyQueries) {
        const read = s.cashier.query(query, { orderId: paid.orderId, paginationOpts });
        if (visible) await expect(read).resolves.toHaveProperty('page');
        else await expect(read).rejects.toThrow('Order not found');
      }
      const approvalHistory = s.cashier.query(api.pos.staffApprovals.forOrder, { orderId: paid.orderId });
      if (visible) await expect(approvalHistory).resolves.toEqual([]);
      else {
        await expect(approvalHistory).rejects.toThrow('Order not found');
        await expect(s.request(paid.orderId, { kind: 'paymentFix', action: 'voidUnreceivedOrder' })).rejects.toThrow('Order not found');
      }
      expect(await s.cashier.query(api.pos.orders.getOrder, { orderId: unpaid.orderId })).toBeTruthy();
      for (const client of [s.manager, s.owner]) {
        expect(await client.query(api.pos.orders.getOrder, { orderId: paid.orderId })).toBeTruthy();
        expect(await client.query(api.pos.orders.findOrderByNumber, { orderNumber: number })).toBe(paid.orderId);
        for (const query of historyQueries) await expect(client.query(query, { orderId: paid.orderId, paginationOpts })).resolves.toHaveProperty('page');
      }
    }
    // Legacy receipts fall back to paidAt; voiding a sale does not reset its date.
    await s.t.run(ctx => ctx.db.patch(paid.orderId, { paymentEffectiveAt: undefined, paidAt: beforeMidnight, status: 'void', voidedAt: now }));
    expect(await s.cashier.query(api.pos.orders.getOrder, { orderId: paid.orderId })).toBeNull();
    await s.t.run(ctx => ctx.db.patch(paid.orderId, { paidAt: midnight }));
    expect(await s.cashier.query(api.pos.orders.getOrder, { orderId: paid.orderId })).toBeTruthy();
    expect(await s.cashier.query(api.pos.orders.getOrder, { orderId: missing })).toBeNull();
    expect(await s.cashier.query(api.pos.orders.findOrderByNumber, { orderNumber: 99999 })).toBeNull();
    for (const query of historyQueries) await expect(s.cashier.query(query, { orderId: missing, paginationOpts })).rejects.toThrow('Order not found');
  });

  it.each([
    Date.parse('2026-11-11T16:59:59.999Z'),
    Date.parse('2026-11-12T17:00:00Z'),
  ])('rejects cashier paid-receipt writes outside the current business date (%s)', async effectiveAt => {
    const s = await setup();
    await s.rules({ paymentFix: 'cashier', voidPaidSale: 'cashier' });
    const bookingId = await s.booking();
    const { orderId, lineId } = await s.cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'room', propertyId: s.propertyId } });
    await s.pay(orderId);
    const linked = await s.owner.mutation(api.pos.commands.linkPaidLine.linkPaidLine, {
      orderId, lineId, bookingId, expectedTargetRevision: 0, expectedCorrectionRevision: 0,
      idempotencyKey: 'owner-link-before-date-change', reason: 'Receipt for stay',
    });
    await s.t.run(ctx => ctx.db.patch(orderId, {
      paymentEffectiveAt: effectiveAt,
      customerSnapshot: { name: 'Historical private payer' },
    }));
    const before = await s.t.run(ctx => ctx.db.get(orderId));
    expect(await s.cashier.query(api.pos.orders.getOrder, { orderId })).toBeNull();
    const correction = { orderId, expectedCorrectionRevision: 1, reason: 'Cashier attempt' };
    const attempts = [
      () => s.cashier.mutation(api.pos.commands.voidOrder.voidOrder, { orderId, reason: correction.reason }),
      () => s.cashier.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { ...correction, idempotencyKey: 'hidden-amend', effectiveAt: now }),
      () => s.cashier.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { ...correction, idempotencyKey: 'hidden-unreceived' }),
      () => s.cashier.mutation(api.pos.commands.linkPaidLine.linkPaidLine, { ...correction, lineId, bookingId, expectedTargetRevision: 0, idempotencyKey: 'hidden-link' }),
      () => s.cashier.mutation(api.pos.commands.unlinkPaidLine.unlinkPaidLine, { ...correction, linkId: linked.linkId, idempotencyKey: 'hidden-unlink' }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow('Order not found');
    expect(await s.t.run(ctx => ctx.db.get(orderId))).toEqual(before);
    expect(await s.cashier.query(api.pos.orders.getOrder, { orderId })).toBeNull();
    // A manager can still correct the historical receipt and deliberately make it visible today.
    await s.manager.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { ...correction, idempotencyKey: 'manager-amend-hidden', effectiveAt: now });
    expect((await s.cashier.query(api.pos.orders.getOrder, { orderId }))?.receiptCustomer?.name).toBe('Historical private payer');
  });

  it('keeps paid-link discovery and link requests behind the paymentFix rule', async () => {
    const s = await setup();
    const bookingId = await s.booking();
    const { orderId, lineId } = await s.cashier.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'room', propertyId: s.propertyId } });
    await s.pay(orderId);
    const lookup = { orderId, lineId, query: 'Guest' };
    const payload = { kind: 'paymentFix', action: 'linkPaidLine', lineId, bookingId, expectedTargetRevision: 0 } as const;
    await expect(s.cashier.query(api.pos.sourceReads.linkCandidates, lookup)).rejects.toMatchObject(needsApproval('paymentFix'));
    await expect(s.request(orderId, payload)).rejects.toMatchObject(needsApproval('paymentFix'));
    expect(await s.t.run(ctx => ctx.db.query('staffApprovalRequests').take(10))).toEqual([]);
    for (const client of [s.manager, s.owner]) expect(await client.query(api.pos.sourceReads.linkCandidates, lookup)).toMatchObject([{ id: bookingId, guestName: 'Guest' }]);
    await s.manager.mutation(api.pos.commands.linkPaidLine.linkPaidLine, { orderId, lineId, bookingId, expectedTargetRevision: 0, expectedCorrectionRevision: 0, idempotencyKey: 'manager-link', reason: 'Correct stay' });
    const linkId = (await s.view(orderId)).links[0]._id;
    await expect(s.request(orderId, { kind: 'paymentFix', action: 'unlinkPaidLine', linkId })).rejects.toMatchObject(needsApproval('paymentFix'));
    await s.rules({ paymentFix: 'cashier' });
    await expect(s.cashier.query(api.pos.sourceReads.linkCandidates, lookup)).resolves.toBeInstanceOf(Array);
    const unlink = await s.request(orderId, { kind: 'paymentFix', action: 'unlinkPaidLine', linkId });
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: unlink.requestId });
    const target = await s.t.run(ctx => ctx.db.get(bookingId));
    const link = await s.request(orderId, { ...payload, expectedTargetRevision: target?.revision ?? 0 });
    await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: link.requestId });
    expect((await s.view(orderId)).links.filter(row => row.status === 'active')).toHaveLength(1);
  });

  it('defaults the additive refund rule to manager and preserves it for older callers', async () => {
    const s = await setup();
    expect(DEFAULT_CASHIER_RULES.refund).toBe('manager');
    const updated = await s.rules({ refund: 'cashier' });
    for (const client of [s.owner, s.manager, s.cashier]) expect((await client.query(api.auth.staffAccess.myAccess, {})).cashierRules).toEqual(updated);
    const { revision, refund, ...rules } = updated;
    expect(refund).toBe('cashier');
    expect((await s.owner.mutation(api.settings.cashierRules.updateCashierRules, { ...rules, expectedRevision: revision })).refund).toBe('cashier');
    await s.t.run(async ctx => {
      const row = (await ctx.db.query('cashierRules').unique())!;
      await ctx.db.patch(row._id, { refund: undefined });
    });
    expect((await s.owner.query(api.settings.cashierRules.getCashierRules, {})).refund).toBe('manager');
  });

  it('restores manager settings reads while keeping writes and Team history owner-only', async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.settings.update, { business: { businessName: 'Manager can read' } });
    expect(await s.manager.query(api.settings.settings.admins, {})).toEqual(['owner@example.com']);
    expect(await s.manager.query(api.settings.settings.get, {})).toHaveProperty('businessName', 'Manager can read');
    expect((await s.manager.query(api.settings.recordHistory.list, { entityType: 'settings', paginationOpts: { numItems: 20, cursor: null } })).page).toHaveLength(1);
    await expect(s.cashier.query(api.settings.settings.admins, {})).rejects.toThrow('Not authorized');
    await expect(s.cashier.query(api.settings.recordHistory.list, { entityType: 'settings', paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow('Not authorized');
    for (const entityType of ['staffGrant', 'cashierRules', 'marketingGrant']) await expect(s.manager.query(api.settings.recordHistory.list, { entityType, paginationOpts: { numItems: 20, cursor: null } })).rejects.toThrow('Not authorized');
    await expect(s.manager.query(api.settings.cashierRules.getCashierRules, {})).rejects.toThrow('Not authorized');
  });
});
