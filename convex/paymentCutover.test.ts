// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireStaff } from './auth/model';
import { readBudget } from './lib/readBudget';
import schema from './schema';
import { ensureDefaultBranch } from './commerce/ensureDefaultBranch';
import {
  assertAttemptPaymentAdmission, assertDirectPaymentAdmission, readCommerceSettings,
} from './commerce/model';
import { adjust, type AdjustmentCommand, type AdjustmentWriter } from './commerce/private/adjustments';

const modules = import.meta.glob('./**/*.ts');
const rollout = api.commerce.paymentCutover;
const settings = api.commerce.settings;
const refusal = (code: string) => ({ data: expect.objectContaining({ code }) });
const edit = (expectedRevision: number, clientKey: string, reason = 'Announced desk update') =>
  ({ expectedRevision, clientKey, reason });

afterEach(() => vi.unstubAllEnvs());

type Outcome = 'recorded' | 'nothing_taken' | 'collected_unrecorded';
/** What a manager reviewed on the panel's row: its current instruction, after confirming its till stopped. */
async function reviewed<A extends { tillId: Id<'tills'>; panelKey: string; outcome: Outcome; note?: string }>(t: Awaited<ReturnType<typeof fixture>>['t'], args: A) {
  const panel = await t.run(ctx => ctx.db.query('directPaymentPanels')
    .withIndex('by_tillId_and_panelKey', q => q.eq('tillId', args.tillId).eq('panelKey', args.panelKey)).first());
  return { ...args, expectedInstructionAt: panel?.instruction?.at ?? null, stoppedPreviousOperator: true };
}

async function fixture() {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const t = convexTest(schema, modules);
  const { managerId, orderId, otherOrderId } = await t.run(async ctx => {
    const grant = (tokenIdentifier: string, role: 'manager' | 'cashier') =>
      ctx.db.insert('staffGrants', {
        role, email: `${tokenIdentifier}@example.com`, tokenIdentifier,
        createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
      });
    const managerId = await grant('manager', 'manager');
    await grant('second', 'manager');
    await grant('cashier', 'cashier');
    const order = (orderNumber: number) => ctx.db.insert('orders', {
      status: 'draft', orderNumber, currency: 'THB', itemCount: 1, hasItems: true,
      total: 60000, due: 60000, revision: 1, createdBy: 'cashier', createdAt: 1, updatedAt: 1,
    });
    return { managerId, orderId: await order(1), otherOrderId: await order(2) };
  });
  const as = (tokenIdentifier: string) => t.withIdentity({
    email: `${tokenIdentifier}@example.com`, tokenIdentifier, emailVerified: true,
  });
  return { t, owner: as('owner'), manager: as('manager'), second: as('second'), cashier: as('cashier'), managerId, orderId, otherOrderId };
}

it('resolves dormant defaults without writing any rows', async () => {
  const { t, owner, cashier } = await fixture();
  expect(await owner.query(settings.getRules, {})).toMatchObject({
    revision: 0, paymentsMode: 'direct', canEdit: true,
    terms: { unusedFullRefundDays: 7, refundDueDays: { card: 45, cashOrTransfer: 15 }, allowSessionTransfer: true },
    switches: { products: 'off', vouchers: 'off', sessionPackages: 'off', mixedPackages: 'off' },
  });
  expect(await cashier.query(settings.getAccess, {})).toMatchObject({
    settingsRevision: 0, paymentsMode: 'direct', paused: false, tillReady: true, cutoverRevision: null,
    canSell: { products: false, vouchers: false, sessionPackages: false, mixedPackages: false },
  });
  expect(await owner.query(rollout.status, {})).toMatchObject({
    mode: 'direct', cutoverAt: null, acknowledged: [], pending: [],
  });
  expect(await t.run(ctx => ctx.db.query('commerceSettings').take(1))).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('branches').take(1))).toEqual([]);
});

it('applies one settings adjustment, replays matching payloads and preserves the audit and revision', async () => {
  const { t, owner } = await fixture();
  const command = { ...edit(0, 'terms', 'Updated refund terms'), terms: { unusedFullRefundDays: 10, allowSessionTransfer: false } };
  const result = await owner.mutation(settings.updateRules, command);
  expect(result).toMatchObject({ status: 'applied', revision: 1 });
  expect(await owner.mutation(settings.updateRules, {
    ...command, terms: { allowSessionTransfer: false, unusedFullRefundDays: 10 },
  })).toEqual(result);
  await expect(owner.mutation(settings.updateRules, { ...command, terms: { unusedFullRefundDays: 11 } }))
    .rejects.toMatchObject(refusal('ADJUSTMENT_KEY_CONFLICT'));
  await expect(owner.mutation(settings.updateRules, { ...command, clientKey: 'other-key' }))
    .rejects.toMatchObject(refusal('STALE_ADJUSTMENT_REVISION'));
  await expect(owner.mutation(settings.updateRules, { ...command, ...edit(1, 'empty-reason', ' ') }))
    .rejects.toMatchObject(refusal('INVALID_ADJUSTMENT_REASON'));
  expect(await owner.query(settings.getRules, {})).toMatchObject({
    revision: 1, terms: { unusedFullRefundDays: 10, allowSessionTransfer: false, packageValidityDays: 180 },
  });
  const { rows, audits } = await t.run(async ctx => ({
    rows: await ctx.db.query('commerceSettings').take(2),
    audits: await ctx.db.query('commerceAdjustments').take(2),
  }));
  expect(rows).toHaveLength(1);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    _id: result.adjustmentId, targetType: 'settings', targetId: rows[0]._id, kind: 'updateSettings',
    actor: 'owner', actorLabel: 'owner@example.com', reasonText: 'Updated refund terms',
    revisionBefore: 0, revisionAfter: 1, before: { unusedFullRefundDays: 7, allowSessionTransfer: true },
    after: { unusedFullRefundDays: 10, allowSessionTransfer: false },
  });
});

it('shows each settings change in the page History with its rules before and after, to owners and managers only', async () => {
  const { owner, manager, cashier } = await fixture();
  await owner.mutation(settings.updateRules, {
    ...edit(0, 'terms', 'Adviser said so'), terms: { refundDueDays: { cashOrTransfer: 15, card: 30 }, allowSessionTransfer: false },
  });
  await manager.mutation(rollout.setPaused, { ...edit(1, 'pause'), paused: true });
  const { settingsId } = await owner.query(settings.getRules, {});
  expect(settingsId).not.toBeNull();
  const target = { targetType: 'settings' as const, targetId: settingsId! };
  const page = await manager.query(api.commerce.history.staffPage, { target, paginationOpts: { numItems: 20, cursor: null } });
  expect(page.page.map(entry => entry.fact)).toEqual([{ key: 'checkoutPaused' }, { key: 'rulesChanged' }]);
  expect(page.page[0].changes).toEqual([]);
  expect(page.page[1]).toMatchObject({
    staff: { actorName: 'owner@example.com', reasonText: 'Adviser said so' },
    changes: [
      { field: 'refundDueDays.card', before: 45, after: 30 },
      { field: 'allowSessionTransfer', before: true, after: false },
    ],
  });
  expect((await cashier.query(api.commerce.history.staffPage, { target, paginationOpts: { numItems: 20, cursor: null } })).page).toEqual([]);
});

it('authorizes the rollout and field groups before reading or replaying an edit', async () => {
  const { t, owner, manager, cashier, managerId } = await fixture();
  const terms = { ...edit(0, 'terms'), terms: { pointsVatTreatment: 'payment' as const } };
  const switches = { ...edit(0, 'switch'), switches: { products: 'managers' as const } };
  // Managers read the rules and till status but can't change D20 rules or sale switches.
  for (const actor of [manager, cashier]) {
    await expect(actor.mutation(settings.updateRules, terms)).rejects.toThrow('Not authorized');
    await expect(actor.mutation(settings.updateRules, switches)).rejects.toThrow('Not authorized');
  }
  await expect(cashier.query(settings.getRules, {})).rejects.toThrow('Not authorized');
  await expect(cashier.query(rollout.status, {})).rejects.toThrow('Not authorized');
  expect(await manager.query(settings.getRules, {})).toMatchObject({ canEdit: false, settingsId: null, revision: 0 });
  expect(await manager.query(rollout.status, {})).toMatchObject({ mode: 'direct', acknowledged: [], pending: [] });
  expect(await owner.query(settings.getRules, {})).toMatchObject({ canEdit: true });
  await expect(owner.mutation(settings.updateRules, switches)).rejects.toMatchObject(refusal('PAYMENT_ROLLOUT_PENDING'));
  const pause = { ...edit(0, 'pause'), paused: true };
  const activate = edit(1, 'activate');
  await expect(cashier.mutation(rollout.setPaused, pause)).rejects.toThrow('Not authorized');
  await expect(cashier.mutation(rollout.activate, activate)).rejects.toThrow('Not authorized');
  await manager.mutation(rollout.setPaused, pause);
  await manager.mutation(rollout.activate, activate);
  await t.run(ctx => ctx.db.patch('staffGrants', managerId, { role: 'cashier' }));
  await expect(manager.mutation(rollout.setPaused, pause)).rejects.toThrow('Not authorized');
  await expect(manager.mutation(rollout.activate, activate)).rejects.toThrow('Not authorized');
  await owner.mutation(settings.updateRules, { ...terms, expectedRevision: 2 });
  vi.stubEnv('ADMIN_EMAILS', '');
  await expect(owner.mutation(settings.updateRules, { ...terms, expectedRevision: 2 })).rejects.toThrow('Not authorized');
});

it('keeps the D19 manager exception scoped to rollout fields and runs target scope before replay', async () => {
  const { t, manager, cashier } = await fixture();
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  const stored = await t.run(ctx => ctx.db.query('commerceSettings').withIndex('by_key', q => q.eq('key', 'default')).unique());
  if (!stored) throw new Error('Missing rollout settings');
  const command: AdjustmentCommand = {
    target: { targetType: 'settings', targetId: stored._id },
    kind: 'updateSettings', input: { paused: true }, expectedRevision: 0,
    clientKey: 'pause', reasonCode: 'other', reasonText: 'Announced desk update',
  };
  const writer: AdjustmentWriter = {
    assertScope: async () => { throw new Error('Scope denied'); },
    prepare: async () => { throw new Error('Replay should never prepare another edit'); },
  };
  await expect(manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), command, writer))).rejects.toThrow('Scope denied');
  await expect(cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), command, writer)))
    .rejects.toMatchObject(refusal('ADJUSTMENT_FORBIDDEN'));
  const mixedInputs: AdjustmentCommand['input'][] = [
    { paused: true, unusedFullRefundDays: 0 },
    { paymentsMode: 'attempts', saleSwitches: { products: 'everyone' } },
  ];
  for (const input of mixedInputs) {
    await expect(manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), { ...command, input }, writer)))
      .rejects.toMatchObject(refusal('ADJUSTMENT_FORBIDDEN'));
  }
});

it('serializes two managers switching and replays only the winning payload', async () => {
  const { t, manager, second, owner } = await fixture();
  await expect(manager.mutation(rollout.activate, edit(0, 'activate'))).rejects.toMatchObject(refusal('PAYMENT_PAUSE_REQUIRED'));
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  const command = edit(1, 'activate');
  const operators = [manager, second];
  const results = await Promise.allSettled(operators.map(actor => actor.mutation(rollout.activate, command)));
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const winnerIndex = results.findIndex(result => result.status === 'fulfilled');
  const winner = results[winnerIndex];
  if (winner.status !== 'fulfilled') throw new Error('Missing cutover');
  expect(await operators[winnerIndex].mutation(rollout.activate, command)).toEqual(winner.value);
  await expect(operators[winnerIndex].mutation(rollout.activate, { ...command, reason: 'Different reason' }))
    .rejects.toMatchObject(refusal('ADJUSTMENT_KEY_CONFLICT'));
  await expect(manager.mutation(rollout.setPaused, { ...edit(2, 'resume'), paused: false }))
    .rejects.toMatchObject(refusal('PAYMENTS_ALREADY_SWITCHED'));
  const stored = await t.run(async ctx => ({
    branches: await ctx.db.query('branches').take(2),
    audits: await ctx.db.query('commerceAdjustments').take(3),
    settings: await readCommerceSettings(ctx),
  }));
  expect(stored.branches).toEqual([expect.objectContaining({ key: 'default' })]);
  expect(await t.run(ensureDefaultBranch)).toEqual(stored.branches[0]._id);
  expect(stored.audits).toHaveLength(2);
  expect(stored.audits[1]).toMatchObject({
    kind: 'updateSettings', revisionBefore: 1, revisionAfter: 2, after: { paymentsMode: 'attempts' },
  });
  expect(stored.settings).toMatchObject({
    paymentsMode: 'attempts', revision: 2, cutover: {
      actor: winnerIndex === 0 ? 'manager' : 'second', activatedAt: expect.any(Number), revision: 2,
    },
  });
  expect(await owner.query(rollout.status, {})).toMatchObject({
    mode: 'attempts', paused: false, cutoverAt: stored.settings.cutover?.activatedAt, cutoverRevision: 2,
    acknowledged: [], pending: [],
  });
});

it('blocks activation for open panels and attempts, then refuses the old panel after cutover', async () => {
  const { t, manager, cashier, orderId, otherOrderId } = await fixture();
  const panel = { panelKey: 'open-before-pause', orderId };
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, panel);
  await expect(cashier.mutation(rollout.openDirectPanel, { ...panel, orderId: otherOrderId })).rejects.toMatchObject(refusal('KEY_CONFLICT'));
  const attemptId = await t.run(ctx => ctx.db.insert('paymentAttempts', {
    orderId, key: 'recovering', fingerprint: 'recovering', status: 'refused',
    legs: [], reviewedRequest: { revision: 1, due: 60000, customers: [], vouchers: [], businessDate: '2026-11-19', settingsRevision: 0 },
    owner: 'manager', tillId, ownerRevision: 1, createdAt: 1, updatedAt: 1,
  }));
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  const command = edit(1, 'activate');
  await expect(manager.mutation(rollout.activate, command)).rejects.toMatchObject({ data: {
    code: 'PAYMENTS_STILL_OPEN', panels: [expect.objectContaining(panel)],
    attempts: [expect.objectContaining({ attemptId, status: 'refused' })],
  } });
  expect(await t.run(ctx => ctx.db.query('branches').take(1))).toEqual([]);
  // A reopened panel continues the cashier's open registration; a new order's panel waits.
  await expect(cashier.mutation(rollout.openDirectPanel, { ...panel, panelKey: 'too-late' })).resolves.toMatchObject({
    tillId, previous: { tillId, panelKey: panel.panelKey, check: true },
  });
  await expect(cashier.mutation(rollout.openDirectPanel, { orderId: otherOrderId, panelKey: 'too-late' })).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  expect(await cashier.mutation(rollout.openDirectPanel, panel)).toEqual({ tillId });
  const direct = { ...panel, tillId, actor: 'cashier' };
  // Reopened during the pause: it records only exactly what it instructed (it instructed nothing known).
  await expect(t.run(ctx => assertDirectPaymentAdmission(ctx, direct))).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await expect(t.run(ctx => assertDirectPaymentAdmission(ctx, { orderId, actor: 'cashier' }))).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  await expect(manager.mutation(rollout.closeDirectPanel, { tillId, panelKey: panel.panelKey })).rejects.toMatchObject(refusal('NEEDS_MANAGER'));
  await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { tillId, panelKey: panel.panelKey, outcome: 'nothing_taken' }));
  await t.run(ctx => ctx.db.patch('paymentAttempts', attemptId, { status: 'resolved' }));
  await manager.mutation(rollout.activate, command);
  await expect(cashier.mutation(rollout.openDirectPanel, panel)).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  await expect(t.run(ctx => assertDirectPaymentAdmission(ctx, direct))).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
});

it('allows a manager to cancel a pause before cutover and audits both transitions', async () => {
  const { t, manager, cashier, orderId } = await fixture();
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  expect(await cashier.query(settings.getAccess, {})).toMatchObject({ paused: true, paymentsMode: 'direct' });
  await manager.mutation(rollout.setPaused, { ...edit(1, 'unpause'), paused: false });
  expect(await cashier.query(settings.getAccess, {})).toMatchObject({ paused: false, paymentsMode: 'direct' });
  await t.run(ctx => assertDirectPaymentAdmission(ctx, { orderId, actor: 'cashier' }));
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').take(3))).toMatchObject([
    { targetType: 'settings', kind: 'updateSettings', revisionAfter: 1, before: { cutover: null } },
    { targetType: 'settings', kind: 'updateSettings', revisionAfter: 2, after: { cutover: null } },
  ]);
});

it('requires the stored till acknowledgement and a current loaded mode and revision for admission', async () => {
  const { t, owner, manager, cashier } = await fixture();
  const devices = ['rollout-device-test-first', 'rollout-device-test-second'];
  const orders = await Promise.all(devices.map((_, i) => payable(manager, `Till ${i}`)));
  const tills = await Promise.all(orders.map(async ({ orderId }, i) => {
    const panelKey = `panel-${i}`;
    const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, deviceKey: devices[i], panelKey });
    await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { tillId, panelKey, outcome: 'nothing_taken' }));
    return tillId;
  }));
  expect(tills[0]).not.toBe(tills[1]);
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  await manager.mutation(rollout.activate, edit(1, 'activate'));
  const load = { tillId: tills[0], deviceKey: devices[0], loadedMode: 'attempts' as const, loadedRevision: 2 };
  const enable = { ...edit(2, 'enable'), switches: { products: 'managers' as const, vouchers: 'everyone' as const } };
  await expect(t.run(ctx => assertAttemptPaymentAdmission(ctx, load))).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  await expect(cashier.mutation(rollout.acknowledge, { ...load, loadedMode: 'direct' })).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  await expect(cashier.mutation(rollout.acknowledge, { ...load, loadedRevision: 1 })).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  const ack = await cashier.mutation(rollout.acknowledge, load);
  expect(await cashier.mutation(rollout.acknowledge, load)).toEqual(ack);
  expect(await owner.query(rollout.status, {})).toMatchObject({
    acknowledged: [{ tillId: tills[0], at: ack.acknowledgedAt }], pending: [{ tillId: tills[1] }],
  });
  await expect(owner.mutation(settings.updateRules, enable)).rejects.toMatchObject(refusal('PAYMENT_ROLLOUT_PENDING'));
  await expect(t.run(ctx => assertAttemptPaymentAdmission(ctx, { ...load, tillId: tills[1] }))).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  await expect(t.run(ctx => assertAttemptPaymentAdmission(ctx, { ...load, loadedMode: 'direct', loadedRevision: 0 })))
    .rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  const second = { ...load, tillId: tills[1], deviceKey: devices[1] };
  await expect(t.run(ctx => assertAttemptPaymentAdmission(ctx, second))).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  await expect(cashier.mutation(rollout.acknowledge, second)).resolves.toMatchObject({ tillId: tills[1] });
  await owner.mutation(settings.updateRules, enable);
  expect(await cashier.query(settings.getAccess, { tillId: load.tillId, loadedRevision: load.loadedRevision, deviceKey: load.deviceKey })).toMatchObject({
    settingsRevision: 3, cutoverRevision: 2, tillReady: true,
    canSell: { products: false, vouchers: true, sessionPackages: false, mixedPackages: false },
  });
  expect(await manager.query(settings.getAccess, { tillId: tills[0] })).toMatchObject({
    tillReady: false, canSell: { products: true, vouchers: true },
  });
  expect(await t.run(async ctx => {
    const till = await assertAttemptPaymentAdmission(ctx, load);
    const { documents, ranges } = readBudget(ctx);
    return { tillId: till._id, documents, ranges };
  })).toEqual({ tillId: tills[0], documents: 2, ranges: 2 });
});

const settle = api.pos.commands.settleOrder.settleOrder;

async function payable(staff: Awaited<ReturnType<typeof fixture>>['second'], name: string) {
  const { orderId } = await staff.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name, price: 50000 } });
  const view = await staff.query(api.pos.orders.getOrder, { orderId });
  const tenders = [{ method: 'card' as const, amount: 50000 }];
  return {
    orderId, instruction: { revision: view!.order.revision, due: 50000, tenders },
    pay: { orderId, idempotencyKey: `pay-${name}-0001`, expectedDue: 50000, expectedRevision: view!.order.revision, tenders },
  };
}

it('lets only a registered direct panel settle during the pause, after replay and before any effect', async () => {
  const { t, manager, second } = await fixture();
  const operator = second;
  const open = await payable(operator, 'Open');
  const late = await payable(operator, 'Late');
  const done = await payable(operator, 'Done');
  const { tillId } = await operator.mutation(rollout.openDirectPanel, { orderId: open.orderId, panelKey: 'ipad:open', instruction: open.instruction });
  await operator.mutation(settle, done.pay);
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  // A receipt paid before the pause still replays; a new payment without a registration is refused.
  expect(await operator.mutation(settle, done.pay)).toMatchObject({ replayed: true });
  await expect(operator.mutation(settle, late.pay)).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  await expect(operator.mutation(settle, { ...late.pay, tillId, panelKey: 'ipad:open' })).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  await expect(manager.mutation(settle, { ...open.pay, tillId, panelKey: 'ipad:open' })).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  expect(await t.run(ctx => ctx.db.query('orderPayments').collect())).toHaveLength(1);
  expect(await operator.mutation(settle, { ...open.pay, tillId, panelKey: 'ipad:open' })).toMatchObject({ replayed: false });
  // Its registration was released in the same transaction that recorded the payment.
  await manager.mutation(rollout.activate, edit(1, 'activate'));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').first())).toBeNull();
});

it('keeps the 13th admitted panel in the ledger and blocks cutover until it is reconciled', async () => {
  const { t, manager, cashier, second } = await fixture();
  const rows = [];
  for (let index = 0; index < 13; index++) {
    const { orderId } = await payable(manager, `Draft ${index}`);
    const panelKey = `direct-panel-${index}`;
    rows.push({ orderId, panelKey, ...await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey }) });
  }
  expect(await manager.query(rollout.directPanels, {})).toHaveLength(13);
  const last = rows[12];
  await expect(second.mutation(rollout.openDirectPanel, last)).rejects.toMatchObject(refusal('KEY_CONFLICT'));
  for (const { tillId, panelKey } of rows.slice(0, 12)) await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { tillId, panelKey, outcome: 'nothing_taken' }));
  await expect(cashier.mutation(rollout.openDirectPanel, last)).resolves.toEqual({ tillId: last.tillId });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
  expect(await manager.query(rollout.directPanels, {})).toMatchObject([{ ...last, stale: true, settled: false }]);
  vi.useRealTimers();
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  const activation = edit(1, 'activate');
  await expect(manager.mutation(rollout.activate, activation)).rejects.toMatchObject({
    data: expect.objectContaining({ code: 'PAYMENTS_STILL_OPEN', panels: [expect.objectContaining(last)] }),
  });
  const { orderId, ...panel } = last;
  await expect(second.mutation(rollout.closeDirectPanel, panel)).rejects.toMatchObject(refusal('NEEDS_MANAGER'));
  await expect(cashier.query(rollout.directPanels, {})).rejects.toThrow();
  await expect(cashier.mutation(rollout.reconcileDirectPanel, await reviewed(t, { ...panel, outcome: 'recorded' }))).rejects.toThrow();
  await expect(manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { ...panel, outcome: 'recorded' }))).rejects.toMatchObject(refusal('PAY_PANEL_NOT_PAID'));
  await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { ...panel, outcome: 'nothing_taken' }));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'till').eq('entityId', panel.tillId)).order('desc').take(1))).toMatchObject([{
    entityType: 'till', entityId: panel.tillId, kind: 'direct_panel_reconciled', actor: 'manager@example.com',
    after: { panelKey: panel.panelKey, orderId, panelActor: 'cashier', outcome: 'nothing_taken' },
  }]);
  await expect(manager.mutation(rollout.activate, activation)).resolves.toMatchObject({ status: 'applied' });
  await expect(cashier.mutation(rollout.openDirectPanel, last)).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
}, 30000);

it('keeps an unconfirmed direct instruction admitted after an older client closes the panel', async () => {
  const { t, manager, cashier, orderId } = await fixture();
  const panel = { panelKey: 'shown-card-instruction', orderId };
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, panel);
  const registration = { tillId, panelKey: panel.panelKey };
  await expect(cashier.mutation(rollout.closeDirectPanel, registration)).rejects.toMatchObject(refusal('PAY_PANEL_UNVERIFIED'));
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  await expect(manager.mutation(rollout.activate, edit(1, 'activate'))).rejects.toMatchObject(refusal('PAYMENTS_STILL_OPEN'));
  await expect(manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { ...registration, outcome: 'recorded' })))
    .rejects.toMatchObject(refusal('PAY_PANEL_NOT_PAID'));
  expect(await t.run(ctx => ctx.db.query('orderPayments').first())).toBeNull();
  await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { ...registration, outcome: 'nothing_taken' }));
  await expect(t.run(ctx => assertDirectPaymentAdmission(ctx, { ...registration, orderId, actor: 'cashier' })))
    .rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  await expect(manager.mutation(rollout.activate, edit(1, 'activate'))).resolves.toMatchObject({ status: 'applied' });
});

it('replays a backdated direct sale for its original cashier while receipt reads stay scoped', async () => {
  const { t, manager, cashier } = await fixture();
  const { orderId, pay: quote } = await payable(manager, 'Backdated');
  await t.run(ctx => ctx.db.insert('staffGrants', {
    role: 'cashier', email: 'other@example.com', tokenIdentifier: 'other', createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
  }));
  const other = t.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other', emailVerified: true });
  const pay = { ...quote, effectiveAt: Date.now() - 86400000 };
  const paid = await cashier.mutation(settle, pay);
  await expect(cashier.query(api.pos.orders.getOrder, { orderId })).resolves.toBeNull();
  const retry = { ...pay, expectedDue: 0, expectedRevision: 0, tenders: [] };
  await expect(cashier.mutation(settle, retry)).resolves.toEqual({ ...paid, replayed: true });
  await expect(cashier.mutation(settle, { ...retry, idempotencyKey: 'unknown-backdated-key' })).rejects.toMatchObject({ data: 'Order not found' });
  await expect(manager.mutation(settle, retry)).resolves.toEqual({ ...paid, replayed: true });
  await expect(other.mutation(settle, retry)).rejects.toMatchObject({ data: 'Order not found' });
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  await manager.mutation(rollout.activate, edit(1, 'activate'));
  await expect(cashier.mutation(settle, retry)).resolves.toEqual({ ...paid, replayed: true });
  expect(await t.run(ctx => ctx.db.query('orderPayments').take(2))).toHaveLength(1);
});

it('records an approved direct payment left behind before the pause under its original registration (r3 blocker)', async () => {
  const { t, manager, cashier, second } = await fixture();
  const { orderId, pay } = await payable(manager, 'Approved card');
  // Card instruction shown, the terminal approves, the cashier taps Order before Confirm.
  const first = { orderId, panelKey: 'card-before-confirm', instruction: { revision: pay.expectedRevision, due: 50000, tenders: [{ method: 'card' as const, amount: 50000 }] } };
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, first);
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  // Reopening during the pause continues the first registration instead of refusing.
  const reopened = await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'reopened-during-pause' });
  expect(reopened).toMatchObject({ tillId, previous: { tillId, panelKey: first.panelKey, openedAt: expect.any(Number), check: true, matches: true, instruction: first.instruction } });
  // Another staff member's panel can't settle it.
  await expect(second.mutation(settle, { ...pay, tillId, panelKey: first.panelKey })).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  expect(await cashier.mutation(settle, { ...pay, tillId, panelKey: reopened.previous!.panelKey })).toMatchObject({ replayed: false });
  expect(await t.run(ctx => ctx.db.query('orderPayments').collect())).toMatchObject([{ orderId, method: 'card', amount: 50000 }]);
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toEqual([]);
  await expect(manager.mutation(rollout.activate, edit(1, 'activate'))).resolves.toMatchObject({ status: 'applied' });
});

it('never registers a second instruction for the order after unpausing; another device or cashier sees it elsewhere (r3, r4 blockers)', async () => {
  const { t, manager, cashier, second } = await fixture();
  const { orderId, pay, instruction } = await payable(manager, 'Unpaused');
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'first-card' });
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  await manager.mutation(rollout.setPaused, { ...edit(1, 'unpause'), paused: false });
  for (const panelKey of ['second-card', 'third-card']) {
    await expect(cashier.mutation(rollout.openDirectPanel, { orderId, panelKey })).resolves.toMatchObject({ previous: { tillId, panelKey: 'first-card', check: true } });
  }
  // The registration belongs to its till: another device with the same login sees it elsewhere.
  await expect(cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'other-device', deviceKey: 'rollout-device-test-other' }))
    .rejects.toMatchObject(refusal('PAY_PANEL_ELSEWHERE'));
  // So does a different staff member, and neither can record a payment for the order meanwhile.
  await expect(second.mutation(rollout.openDirectPanel, { orderId, panelKey: 'manager-card' })).rejects.toMatchObject(refusal('PAY_PANEL_ELSEWHERE'));
  await expect(second.mutation(settle, pay)).rejects.toMatchObject(refusal('PAY_PANEL_ELSEWHERE'));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toMatchObject([{ orderId, actor: 'cashier', panelKey: 'first-card' }]);
  // Nothing known was instructed, so only Not taken (recorded) lets this panel take a fresh payment.
  await expect(cashier.mutation(settle, { ...pay, tillId, panelKey: 'first-card' })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await cashier.mutation(rollout.answerDirectPanel, { orderId, tillId, panelKey: 'first-card', outcome: 'notTaken' });
  // The fresh instruction is saved before it is shown, and only it is recorded (r5 astra major).
  await expect(cashier.mutation(settle, { ...pay, tillId, panelKey: 'first-card' })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await cashier.mutation(rollout.instructDirectPanel, { orderId, tillId, panelKey: 'first-card', instruction });
  await cashier.mutation(settle, { ...pay, tillId, panelKey: 'first-card' });
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('orderPayments').collect())).toHaveLength(1);
});

it('continues a reopened direct panel without a check before any pause, then checks from the first pause on', async () => {
  const { t, manager, cashier } = await fixture();
  const { orderId, pay, instruction } = await payable(manager, 'Dormant');
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'first-open' });
  // Today's checkout: the reopened panel is today's panel, under the same single registration.
  await expect(cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'reopened' }))
    .resolves.toEqual({ tillId, previous: { tillId, panelKey: 'first-open', openedAt: expect.any(Number), check: false, matches: false } });
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toHaveLength(1);
  // The first pause starts the cutover window, and an unpause keeps it.
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  await manager.mutation(rollout.setPaused, { ...edit(1, 'unpause'), paused: false });
  const stored = await t.run(ctx => ctx.db.query('commerceSettings').first());
  expect(stored).toMatchObject({ cutoverStartedAt: expect.any(Number) });
  expect(stored?.cutover).toBeUndefined();
  await expect(cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'after-unpause' }))
    .resolves.toMatchObject({ previous: { panelKey: 'first-open', check: true } });
  await cashier.mutation(rollout.answerDirectPanel, { orderId, tillId, panelKey: 'first-open', outcome: 'notTaken' });
  await cashier.mutation(rollout.instructDirectPanel, { orderId, tillId, panelKey: 'first-open', instruction });
  await cashier.mutation(settle, { ...pay, tillId, panelKey: 'first-open' });
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toEqual([]);
});

it('supports collected_unrecorded reconciliation with required note and returns rich directPanels metadata', async () => {
  const { t, manager, cashier } = await fixture();
  const { orderId, pay, instruction } = await payable(manager, 'Duplicate terminal');
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey: 'dup-panel', instruction });
  const listed = await manager.query(rollout.directPanels, {});
  expect(listed).toMatchObject([{
    tillId, panelKey: 'dup-panel', orderId, actor: 'cashier', actorEmail: 'cashier@example.com',
    receiptNumber: null, receiptUsed: false, settled: false,
    instruction: { revision: instruction.revision, due: 50000, tenders: [{ method: 'card', amount: 50000 }] },
  }]);
  await expect(manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, {
    tillId, panelKey: 'dup-panel', outcome: 'collected_unrecorded',
  }))).rejects.toMatchObject(refusal('RECONCILE_NOTE_REQUIRED'));
  await expect(manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, {
    tillId, panelKey: 'dup-panel', outcome: 'collected_unrecorded', note: '   ',
  }))).rejects.toMatchObject(refusal('RECONCILE_NOTE_REQUIRED'));
  await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, {
    tillId, panelKey: 'dup-panel', outcome: 'collected_unrecorded', note: 'Duplicate card slip voided at terminal',
  }));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toEqual([]);
  const order = await t.run(ctx => ctx.db.get('orders', orderId));
  expect(order?.directPanel).toBeUndefined();
  expect(await t.run(ctx => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'till').eq('entityId', tillId)).order('desc').take(1))).toMatchObject([{
    kind: 'direct_panel_reconciled', actor: 'manager@example.com',
    after: {
      panelKey: 'dup-panel', orderId, outcome: 'collected_unrecorded',
      note: 'Duplicate card slip voided at terminal',
    },
  }]);
  // Order itself can still settle normally afterward.
  await cashier.mutation(settle, pay);
  expect(await t.run(ctx => ctx.db.query('orderPayments').collect())).toHaveLength(1);
});

it('retires a replaced payment till after cutover, unblocks sale switches, and blocks retired till admission', async () => {
  const { t, owner, manager, cashier } = await fixture();
  const devices = ['retire-device-active-0001', 'retire-device-broken-0002'];
  const orders = await Promise.all(devices.map((_, i) => payable(manager, `Retire ${i}`)));
  const tills = await Promise.all(orders.map(async ({ orderId }, i) => {
    const panelKey = `retire-panel-${i}`;
    const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, deviceKey: devices[i], panelKey });
    await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { tillId, panelKey, outcome: 'nothing_taken' }));
    return tillId;
  }));
  // Cannot retire before cutover.
  await expect(manager.mutation(rollout.retireTill, { tillId: tills[1], reason: 'Broken iPad' }))
    .rejects.toMatchObject(refusal('PAYMENT_ATTEMPTS_DISABLED'));

  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  await manager.mutation(rollout.activate, edit(1, 'activate'));
  const loadActive = { tillId: tills[0], deviceKey: devices[0], loadedMode: 'attempts' as const, loadedRevision: 2 };
  await cashier.mutation(rollout.acknowledge, loadActive);

  // Sale switch is blocked while broken till is pending.
  const enable = { ...edit(2, 'enable'), switches: { products: 'managers' as const } };
  await expect(owner.mutation(settings.updateRules, enable)).rejects.toMatchObject(refusal('PAYMENT_ROLLOUT_PENDING'));

  // Refuses retiring with empty reason or when an active payment attempt exists on that till.
  await expect(manager.mutation(rollout.retireTill, { tillId: tills[1], reason: '  ' }))
    .rejects.toMatchObject(refusal('INVALID_ADJUSTMENT_REASON'));
  const blockingAttempt = await t.run(ctx => ctx.db.insert('paymentAttempts', {
    orderId: orders[1].orderId, key: 'blocking', fingerprint: 'blocking', status: 'collecting',
    legs: [], reviewedRequest: { revision: 1, due: 50000, customers: [], vouchers: [], businessDate: '2026-11-19', settingsRevision: 2 },
    owner: 'cashier', tillId: tills[1], ownerRevision: 1, createdAt: 1, updatedAt: 1,
  }));
  await expect(manager.mutation(rollout.retireTill, { tillId: tills[1], reason: 'Broken iPad' }))
    .rejects.toMatchObject(refusal('PAYMENTS_STILL_OPEN'));
  await t.run(ctx => ctx.db.patch('paymentAttempts', blockingAttempt, { status: 'resolved' }));

  // Retire the broken till.
  await manager.mutation(rollout.retireTill, { tillId: tills[1], reason: 'Broken iPad' });
  expect(await owner.query(rollout.status, {})).toMatchObject({
    acknowledged: [{ tillId: tills[0] }], pending: [],
  });
  // Sale switch now succeeds!
  await expect(owner.mutation(settings.updateRules, enable)).resolves.toMatchObject({ status: 'applied', revision: 3 });

  // Retired till cannot acknowledge, cannot pass getAccess tillReady, and cannot pass attempt admission.
  const loadBroken = { tillId: tills[1], deviceKey: devices[1], loadedMode: 'attempts' as const, loadedRevision: 2 };
  await expect(cashier.mutation(rollout.acknowledge, loadBroken)).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  await expect(t.run(ctx => assertAttemptPaymentAdmission(ctx, loadBroken))).rejects.toMatchObject(refusal('TILL_NEEDS_RELOAD'));
  expect(await cashier.query(settings.getAccess, { tillId: tills[1], loadedRevision: 2, deviceKey: devices[1] })).toMatchObject({
    tillReady: false,
  });
  expect(await t.run(ctx => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'till').eq('entityId', tills[1])).order('desc').take(1))).toMatchObject([{
    kind: 'till_retired', actor: 'manager@example.com', after: { reason: 'Broken iPad' },
  }]);
});

it('refuses a reconciliation reviewed on an instruction the till has since replaced, or before its operator stopped (audit Major 1)', async () => {
  const { t, manager, cashier } = await fixture();
  const { orderId, instruction } = await payable(manager, 'Switched tender');
  const panelKey = 'card-then-cash';
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey, instruction });
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  // The manager reviews the Card instruction…
  const [row] = await manager.query(rollout.directPanels, {});
  expect(row).toMatchObject({ panelKey, instruction: { tenders: [{ method: 'card' }] }, canRecord: false });
  const stale = { tillId, panelKey, expectedInstructionAt: row.instruction!.at, stoppedPreviousOperator: true };
  // …while the cashier switches the panel to Cash.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 60_000);
  await cashier.mutation(rollout.instructDirectPanel, { orderId, tillId, panelKey, instruction: { ...instruction, tenders: [{ method: 'cash', amount: 50000 }] } });
  vi.useRealTimers();
  for (const outcome of ['nothing_taken', 'recorded'] as const) {
    await expect(manager.mutation(rollout.reconcileDirectPanel, { ...stale, outcome })).rejects.toMatchObject(refusal('PAY_PANEL_CHANGED'));
  }
  await expect(manager.mutation(rollout.reconcileDirectPanel, { ...stale, outcome: 'collected_unrecorded', note: 'Card slip voided' }))
    .rejects.toMatchObject(refusal('PAY_PANEL_CHANGED'));
  await expect(manager.mutation(rollout.reconcileDirectPanel, { ...await reviewed(t, { tillId, panelKey, outcome: 'nothing_taken' }), stoppedPreviousOperator: false }))
    .rejects.toMatchObject(refusal('OPERATOR_NOT_STOPPED'));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toMatchObject([{ panelKey, instruction: { tenders: [{ method: 'cash' }] } }]);
  // Reviewing the current (Cash) instruction resolves it.
  await manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { tillId, panelKey, outcome: 'nothing_taken' }));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toEqual([]);
});

it("never links a receipt settled at a later order revision to a panel opened at an earlier one (audit Major 2)", async () => {
  const { t, manager, cashier } = await fixture();
  const { orderId, instruction } = await payable(manager, 'Revision N');
  const here = { deviceKey: 'revision-device-key-0001', tabKey: 'revision-device-tab-0001' };
  const panelKey = 'card-at-revision-n';
  const { tillId } = await cashier.mutation(rollout.openDirectPanel, { orderId, panelKey, ...here, instruction });
  // The order is edited to revision N+1 with the same due: an item added, then removed.
  const added = await manager.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'extra', name: 'Oil', price: 10000 } });
  await manager.mutation(api.pos.commands.removeLine.removeLine, { lineId: added.lineId! });
  const view = (await manager.query(api.pos.orders.getOrder, { orderId }))!;
  expect(view.order.revision).toBeGreaterThan(instruction.revision);
  expect(view.totals.due).toBe(instruction.due);
  // The same cashier settles the same Card amount from an unregistered tab, at N+1.
  await cashier.mutation(settle, {
    orderId, idempotencyKey: 'unregistered-tab-n-plus-1', expectedDue: 50000, expectedRevision: view.order.revision, tenders: instruction.tenders,
  });
  expect(await t.run(ctx => ctx.db.get('orders', orderId))).toMatchObject({ status: 'paid', settledRevision: view.order.revision });
  await manager.mutation(rollout.setPaused, { ...edit(0, 'pause'), paused: true });
  expect(await manager.query(rollout.directPanels, {})).toMatchObject([{ panelKey, settled: true, receiptUsed: false, canRecord: false }]);
  await expect(manager.mutation(rollout.reconcileDirectPanel, await reviewed(t, { tillId, panelKey, outcome: 'recorded' })))
    .rejects.toMatchObject(refusal('PAY_PANEL_OTHER_RECEIPT'));
  expect(await t.run(ctx => ctx.db.query('directPaymentPanels').collect())).toMatchObject([{ panelKey }]);
  expect((await t.run(ctx => ctx.db.get('orders', orderId)))?.directPanel).toBeUndefined();
});
