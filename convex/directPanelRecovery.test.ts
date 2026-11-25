// @vitest-environment edge-runtime
import { seedTestBranch } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { assertDirectPaymentAdmission } from './commerce/model';

/*
 * PR 92 round 4: a direct panel left open before the checkout pause records exactly what it
 * instructed, only from its own till and tab; anything else goes to a manager. Before any pause
 * today's direct checkout is unchanged, whatever happens to its registration.
 */

const modules = import.meta.glob('./**/*.ts');
const rollout = api.commerce.paymentCutover;
const settle = api.pos.commands.settleOrder.settleOrder;
const refusal = (code: string) => ({ data: expect.objectContaining({ code }) });
const edit = (expectedRevision: number, clientKey: string) => ({ expectedRevision, clientKey, reason: 'Announced desk update' });
const DEVICE = 'front-desk-ipad-device-0001';
const TAB = 'front-desk-ipad-tab-key-0001';
type Method = 'cash' | 'promptpay' | 'card' | 'transfer';

afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    for (const [tokenIdentifier, role] of [['manager', 'manager'], ['ploy', 'cashier'], ['nok', 'cashier']] as const) {
      await ctx.db.insert('staffGrants', { branchIds: [await seedTestBranch(ctx)], role, email: `${tokenIdentifier}@example.com`, tokenIdentifier, createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com' });
    }
  });
  const as = (tokenIdentifier: string) => t.withIdentity({ email: `${tokenIdentifier}@example.com`, tokenIdentifier, emailVerified: true });
  const manager = as('manager');
  let revision = 0;
  return {
    t, manager, ploy: as('ploy'), nok: as('nok'),
    pause: () => manager.mutation(rollout.setPaused, { ...edit(revision++, `pause-${revision}`), paused: true }),
    unpause: () => manager.mutation(rollout.setPaused, { ...edit(revision++, `unpause-${revision}`), paused: false }),
    activate: () => manager.mutation(rollout.activate, edit(revision, 'activate')),
    payments: () => t.run(ctx => ctx.db.query('orderPayments').take(10)),
    panels: () => t.run(ctx => ctx.db.query('directPaymentPanels').take(10)),
  };
}
type Fx = Awaited<ReturnType<typeof fixture>>;

type Outcome = 'recorded' | 'nothing_taken' | 'collected_unrecorded';
/** What a manager reviewed on the panel's row: which registration and its current revision, after confirming its till stopped. */
async function reviewed<A extends { tillId: Id<'tills'>; panelKey: string; outcome: Outcome; note?: string }>(t: Fx['t'], args: A) {
  const panel = await t.run(ctx => ctx.db.query('directPaymentPanels')
    .withIndex('by_tillId_and_panelKey', q => q.eq('tillId', args.tillId).eq('panelKey', args.panelKey)).first());
  return { ...args, expectedInstanceId: String(panel?._id), expectedRevision: panel?.revision ?? 0, stoppedPreviousOperator: true };
}

/** An open order of `price`, and what a panel reviewing it now would send. */
async function bill(fx: Fx, price: number) {
  const { orderId } = await fx.manager.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Massage', price } });
  return { orderId, ...await quote(fx, orderId) };
}
async function quote(fx: Fx, orderId: Id<'orders'>) {
  const view = (await fx.manager.query(api.pos.orders.getOrder, { orderId }))!;
  return { revision: view.order.revision, due: view.totals.due };
}
const instruct = (q: { revision: number; due: number }, tenders: { method: Method; amount: number }[]) => ({ revision: q.revision, due: q.due, tenders });
const pay = (orderId: Id<'orders'>, q: { revision: number; due: number }, tenders: { method: Method; amount: number; received?: number }[], key = 'settle-key-0001') =>
  ({ orderId, idempotencyKey: key, expectedDue: q.due, expectedRevision: q.revision, tenders });
const here = { deviceKey: DEVICE, tabKey: TAB };

/** Ploy shows `tenders` on this till and tab, the terminal approves, and she leaves before Confirm; then checkout pauses. */
async function leftBeforePause(fx: Fx, price: number, tenders: { method: Method; amount: number }[]) {
  const order = await bill(fx, price);
  const instruction = instruct(order, tenders);
  const { tillId } = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'shown-before-pause', ...here, instruction });
  await fx.pause();
  return { ...order, tillId, instruction, registration: { tillId, panelKey: 'shown-before-pause', ...here } };
}

it('records a paused Card approval exactly as instructed; another tender or amount goes to a manager (r4 sol blocker 1)', async () => {
  const fx = await fixture();
  const left = await leftBeforePause(fx, 120000, [{ method: 'card', amount: 120000 }]);
  const reopened = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'reopened-in-pause', ...here });
  expect(reopened.previous).toMatchObject({ panelKey: 'shown-before-pause', check: true, matches: true, instruction: { tenders: [{ method: 'card', amount: 120000 }] } });
  for (const tenders of [[{ method: 'transfer' as const, amount: 120000 }], [{ method: 'card' as const, amount: 60000 }, { method: 'cash' as const, amount: 60000 }]]) {
    await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, left, tenders), ...left.registration })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  }
  // The panel can't swap the instruction under the check either.
  await expect(fx.ploy.mutation(rollout.instructDirectPanel, { orderId: left.orderId, ...left.registration, instruction: instruct(left, [{ method: 'transfer', amount: 120000 }]) }))
    .rejects.toMatchObject(refusal('PAY_PANEL_CHECK_FIRST'));
  expect(await fx.payments()).toEqual([]);
  await fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method: 'card', amount: 120000 }]), ...left.registration });
  expect(await fx.payments()).toMatchObject([{ method: 'card', amount: 120000 }]);
  expect(await fx.panels()).toEqual([]);
  await expect(fx.activate()).resolves.toMatchObject({ status: 'applied' });
});

it('never records a verified PromptPay or Transfer as Card on an unchanged bill (r4 astra blocker b, sol reverse case)', async () => {
  for (const method of ['promptpay', 'transfer'] as const) {
    const fx = await fixture();
    const left = await leftBeforePause(fx, 500000, [{ method, amount: 500000 }]);
    await fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'reopened-in-pause', ...here });
    await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method: 'card', amount: 500000 }]), ...left.registration }))
      .rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
    await fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method, amount: 500000 }]), ...left.registration });
    expect(await fx.payments()).toMatchObject([{ method, amount: 500000 }]);
  }
});

it('sends an order edited across the pause to a manager instead of recording the new total (r4 astra blocker a, sol ฿300 probe)', async () => {
  const fx = await fixture();
  const left = await leftBeforePause(fx, 500000, [{ method: 'card', amount: 500000 }]);
  // A manager adds a ฿500 item after the ฿5,000 Card approval.
  await fx.manager.mutation(api.pos.commands.addItem.addItem, { orderId: left.orderId, item: { kind: 'extra', name: 'Oil', price: 50000 } });
  const now = await quote(fx, left.orderId);
  expect(now.due).toBe(550000);
  const reopened = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'reopened-in-pause', ...here });
  expect(reopened.previous).toMatchObject({ check: true, matches: false, instruction: { due: 500000 } });
  // Neither the current ฿5,500 quote nor the approved ฿5,000 on the changed order is recorded.
  await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, now, [{ method: 'card', amount: 550000 }]), ...left.registration })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method: 'card', amount: 500000 }]), ...left.registration })).rejects.toThrow();
  expect(await fx.payments()).toEqual([]);
  // The manager reconciles it; Recorded needs a receipt for it, which there isn't.
  await expect(fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: left.tillId, panelKey: 'shown-before-pause', outcome: 'recorded' }))).rejects.toMatchObject(refusal('PAY_PANEL_NOT_PAID'));
  await fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: left.tillId, panelKey: 'shown-before-pause', outcome: 'nothing_taken' }));
  expect(await fx.panels()).toEqual([]);
});

it('records Cash and Split exactly as instructed, with the drawer\'s cash received', async () => {
  const fx = await fixture();
  const cash = await leftBeforePause(fx, 500000, [{ method: 'cash', amount: 500000 }]);
  const split = await bill(fx, 300000);
  // A second panel on another order, opened before the pause too.
  await fx.unpause();
  const splitTenders = [{ method: 'card' as const, amount: 100000 }, { method: 'cash' as const, amount: 200000 }];
  const splitReg = { tillId: cash.tillId, panelKey: 'split-before-pause', ...here };
  await fx.ploy.mutation(rollout.openDirectPanel, { orderId: split.orderId, ...splitReg, instruction: instruct(split, [{ method: 'card', amount: 300000 }]) });
  await fx.ploy.mutation(rollout.instructDirectPanel, { orderId: split.orderId, ...splitReg, instruction: instruct(split, splitTenders) });
  await fx.pause();
  for (const { orderId, panelKey } of [{ orderId: cash.orderId, panelKey: 'reopen-cash' }, { orderId: split.orderId, panelKey: 'reopen-split' }]) {
    await fx.ploy.mutation(rollout.openDirectPanel, { orderId, panelKey, ...here });
  }
  await expect(fx.ploy.mutation(settle, { ...pay(cash.orderId, cash, [{ method: 'cash', amount: 450000, received: 500000 }, { method: 'card', amount: 50000 }]), ...cash.registration }))
    .rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await fx.ploy.mutation(settle, { ...pay(cash.orderId, cash, [{ method: 'cash', amount: 500000, received: 560000 }]), ...cash.registration });
  await expect(fx.ploy.mutation(settle, { ...pay(split.orderId, split, [{ method: 'card', amount: 300000 }], 'settle-split-01'), ...splitReg }))
    .rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await fx.ploy.mutation(settle, { ...pay(split.orderId, split, [...splitTenders].reverse(), 'settle-split-01'), ...splitReg });
  expect(await fx.payments()).toMatchObject([
    { method: 'cash', amount: 500000, received: 560000 },
    { method: 'cash', amount: 200000 }, { method: 'card', amount: 100000 },
  ]);
});

it('keeps a continued registration on its own till and tab; another tab or device with the same login sees it elsewhere (r4 sol blocker 2)', async () => {
  const fx = await fixture();
  const left = await leftBeforePause(fx, 120000, [{ method: 'card', amount: 120000 }]);
  const elsewhere = [{ deviceKey: DEVICE, tabKey: 'front-desk-ipad-tab-key-0002' }, { deviceKey: 'second-device-key-00001', tabKey: TAB }, {}];
  for (const where of elsewhere) {
    await expect(fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'second-place', ...where })).rejects.toMatchObject({
      data: expect.objectContaining({ code: 'PAY_PANEL_ELSEWHERE', openedAt: expect.any(Number), tillKey: expect.stringMatching(/^Till /) }),
    });
    // Its original till and key are not enough to record the payment from there.
    await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method: 'transfer', amount: 120000 }]), panelKey: 'shown-before-pause', tillId: left.tillId, ...where }))
      .rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  }
  // A cashier isn't told the registration; Take over is a manager's.
  const cashierRefusal = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'second-place', deviceKey: 'second-device-key-00001', tabKey: TAB }).catch(error => error.data);
  expect(cashierRefusal).not.toHaveProperty('panelKey');
  // The same tab after a reload continues it.
  await expect(fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'after-reload', ...here })).resolves.toMatchObject({ previous: { panelKey: 'shown-before-pause' } });
  await fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method: 'card', amount: 120000 }]), ...left.registration });
  expect(await fx.payments()).toHaveLength(1);
});

it('moves an open registration to a manager\'s till only after the first operator stopped, then records its own instruction', async () => {
  const fx = await fixture();
  const left = await leftBeforePause(fx, 120000, [{ method: 'card', amount: 120000 }]);
  const managerTill = { deviceKey: 'manager-device-key-0001', tabKey: 'manager-device-tab-0001' };
  const refused = await fx.manager.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'manager-panel', ...managerTill }).catch(error => error.data);
  expect(refused).toMatchObject({ code: 'PAY_PANEL_ELSEWHERE', tillId: left.tillId, panelKey: 'shown-before-pause' });
  const takeOver = { orderId: left.orderId, tillId: refused.tillId, panelKey: refused.panelKey, ...managerTill };
  await expect(fx.ploy.mutation(rollout.takeOverDirectPanel, { ...takeOver, stoppedPreviousOperator: true })).rejects.toThrow('Not authorized');
  await expect(fx.manager.mutation(rollout.takeOverDirectPanel, { ...takeOver, stoppedPreviousOperator: false })).rejects.toMatchObject(refusal('OPERATOR_NOT_STOPPED'));
  await fx.manager.mutation(rollout.takeOverDirectPanel, { ...takeOver, stoppedPreviousOperator: true });
  const moved = await fx.manager.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'manager-panel', ...managerTill });
  expect(moved.previous).toMatchObject({ panelKey: 'shown-before-pause', check: true, matches: true });
  // The first till's next step is refused: the registration is no longer its own.
  await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, left, [{ method: 'card', amount: 120000 }]), ...left.registration })).rejects.toMatchObject(refusal('CHECKOUT_PAUSED'));
  await expect(fx.manager.mutation(settle, { ...pay(left.orderId, left, [{ method: 'transfer', amount: 120000 }]), ...managerTill, panelKey: 'shown-before-pause' }))
    .rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await fx.manager.mutation(settle, { ...pay(left.orderId, left, [{ method: 'card', amount: 120000 }]), ...managerTill, panelKey: 'shown-before-pause' });
  expect(await fx.panels()).toEqual([]);
  const history = await fx.t.run(ctx => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'till').eq('entityId', left.tillId)).take(5));
  expect(history).toMatchObject([{ kind: 'direct_panel_taken_over', actor: 'manager@example.com', before: { panelActor: 'ploy' }, after: { panelActor: 'manager' } }]);
});

it("refuses Recorded for one cashier's panel on another cashier's receipt; accepts the receipt that records it", async () => {
  const fx = await fixture();
  const order = await bill(fx, 120000);
  // Before any pause both cashiers open the order, as today: Ploy shows Card, Nok shows Transfer and records it.
  const ploy = { tillId: undefined as Id<'tills'> | undefined, panelKey: 'ploy-card', ...here };
  ploy.tillId = (await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, ...ploy, instruction: instruct(order, [{ method: 'card', amount: 120000 }]) })).tillId;
  const nokTill = { deviceKey: 'nok-device-key-000001', tabKey: 'nok-device-tab-000001' };
  await fx.nok.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'nok-transfer', ...nokTill, instruction: instruct(order, [{ method: 'transfer', amount: 120000 }]) });
  await fx.nok.mutation(settle, { ...pay(order.orderId, order, [{ method: 'transfer', amount: 120000 }]), panelKey: 'nok-transfer', ...nokTill });
  expect(await fx.panels()).toMatchObject([{ panelKey: 'ploy-card' }]);
  await fx.pause();
  // Another cashier's receipt (and another tender): Recorded is shown disabled.
  expect(await fx.manager.query(rollout.directPanels, {})).toMatchObject([{ panelKey: 'ploy-card', settled: true, canRecord: false }]);
  await expect(fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: ploy.tillId!, panelKey: 'ploy-card', outcome: 'recorded' })))
    .rejects.toMatchObject(refusal('PAY_PANEL_OTHER_RECEIPT'));
  await fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: ploy.tillId!, panelKey: 'ploy-card', outcome: 'nothing_taken' }));

  // Ploy's own receipt for exactly her instruction, recorded without the registration (an older tab), resolves it.
  const second = await bill(fx, 80000);
  await fx.unpause();
  await fx.ploy.mutation(rollout.openDirectPanel, { orderId: second.orderId, panelKey: 'ploy-card-2', ...here, instruction: instruct(second, [{ method: 'card', amount: 80000 }]) });
  await fx.t.run(async ctx => {
    await ctx.db.patch('orders', second.orderId, { status: 'paid', receiptNumber: 9, settleKey: 'ploy-old-tab', settledRevision: second.revision, paidBy: 'ploy@example.com', due: 0 });
    await ctx.db.insert('orderPayments', { orderId: second.orderId, method: 'card', amount: 80000, idempotencyKey: 'ploy-old-tab', createdBy: 'ploy@example.com', createdAt: 1, effectiveAt: 1 });
  });
  const tillId = (await fx.panels())[0].tillId;
  expect(await fx.manager.query(rollout.directPanels, {})).toMatchObject([{ panelKey: 'ploy-card-2', canRecord: true }]);
  await fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId, panelKey: 'ploy-card-2', outcome: 'recorded' }));
  expect(await fx.panels()).toEqual([]);
});

it('before any pause, never refuses today\'s direct checkout whatever happens to its registration (r4 dormant regression)', async () => {
  const fx = await fixture();
  // Registration failed or never arrived: the panel settles with its own key, unregistered.
  const lost = await bill(fx, 50000);
  await expect(fx.ploy.mutation(settle, { ...pay(lost.orderId, lost, [{ method: 'card', amount: 50000 }], 'settle-lost-01'), panelKey: 'never-registered', ...here }))
    .resolves.toMatchObject({ replayed: false });
  // A different tab, device or cashier opens the same order as today, each with its own registration.
  const shared = await bill(fx, 70000);
  await fx.ploy.mutation(rollout.openDirectPanel, { orderId: shared.orderId, panelKey: 'tab-one', ...here, instruction: instruct(shared, [{ method: 'card', amount: 70000 }]) });
  await expect(fx.ploy.mutation(rollout.openDirectPanel, { orderId: shared.orderId, panelKey: 'tab-two', deviceKey: DEVICE, tabKey: 'front-desk-ipad-tab-key-0002' })).resolves.not.toHaveProperty('previous');
  await expect(fx.nok.mutation(rollout.openDirectPanel, { orderId: shared.orderId, panelKey: 'nok-panel', deviceKey: 'nok-device-key-000001' })).resolves.not.toHaveProperty('previous');
  // The same tab reopens as today's panel: no check, any tender, even another amount after an edit.
  await expect(fx.ploy.mutation(rollout.openDirectPanel, { orderId: shared.orderId, panelKey: 'tab-one-again', ...here })).resolves.toMatchObject({ previous: { panelKey: 'tab-one', check: false } });
  await fx.ploy.mutation(rollout.instructDirectPanel, { orderId: shared.orderId, panelKey: 'tab-one', ...here, instruction: instruct(shared, [{ method: 'transfer', amount: 70000 }]) });
  await expect(fx.ploy.mutation(rollout.instructDirectPanel, { orderId: shared.orderId, panelKey: 'unknown-key', ...here, instruction: instruct(shared, [{ method: 'cash', amount: 70000 }]) })).resolves.toBeNull();
  await fx.nok.mutation(settle, { ...pay(shared.orderId, shared, [{ method: 'cash', amount: 70000, received: 100000 }], 'settle-shared-1') });
  // Settlement released only the settling operator's own registrations; the others wait for a manager.
  expect((await fx.panels()).map(panel => panel.panelKey).sort()).toEqual(['nok-panel', 'tab-one', 'tab-two']);
  expect(await fx.payments()).toMatchObject([{ method: 'card', amount: 50000 }, { method: 'cash', amount: 70000, received: 100000 }]);
  expect(await fx.t.run(ctx => ctx.db.query('commerceSettings').first())).toBeNull();
});

it('keeps the booking email choice on the registration and settles with it when the request leaves it out (PR 93 lane)', async () => {
  const fx = await fixture();
  const left = await leftBeforePause(fx, 120000, [{ method: 'card', amount: 120000 }]);
  const admission = async () => ({ result: await fx.t.run(ctx => assertDirectPaymentAdmission(ctx, {
    orderId: left.orderId, actor: 'ploy', ...left.registration, payment: { ...left.instruction },
  })) });
  expect((await admission()).result.notifyGuest).toBeUndefined();
  const reopened = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'reopened', ...here });
  expect(reopened.previous).not.toHaveProperty('notifyGuest');
  // Being checked, the panel can't change its instruction, but its email choice can.
  await fx.ploy.mutation(rollout.instructDirectPanel, { orderId: left.orderId, ...left.registration, notifyGuest: true });
  await expect(fx.ploy.mutation(rollout.openDirectPanel, { orderId: left.orderId, panelKey: 'reloaded', ...here })).resolves.toMatchObject({ previous: { notifyGuest: true } });
  expect((await admission()).result.notifyGuest).toBe(true);
  // Before any pause the registration never supplies it.
  const dormant = await fixture();
  const order = await bill(dormant, 50000);
  await dormant.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'dormant-panel', ...here, instruction: instruct(order, [{ method: 'card', amount: 50000 }]) });
  await dormant.ploy.mutation(rollout.instructDirectPanel, { orderId: order.orderId, panelKey: 'dormant-panel', ...here, notifyGuest: true });
  const { tillId } = (await dormant.panels())[0];
  expect((await dormant.t.run(ctx => assertDirectPaymentAdmission(ctx, { orderId: order.orderId, actor: 'ploy', tillId, panelKey: 'dormant-panel', ...here }))).notifyGuest)
    .toBeUndefined();
});

// ─── Round 5 (PR #92): the saved instruction is what the panel shows, and one receipt clears one registration ──

it('records a PromptPay shown on a reopened panel as PromptPay, never as the Card it first showed (r5 sol blocker 1, astra blocker 1)', async () => {
  const fx = await fixture();
  const order = await bill(fx, 120000);
  const card = instruct(order, [{ method: 'card', amount: 120000 }]);
  const promptpay = instruct(order, [{ method: 'promptpay', amount: 120000 }]);
  const { tillId } = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'card-first', ...here, instruction: card });
  // Back to Order, then the same order and tab reopened on PromptPay before the first pause.
  const reopened = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'promptpay-next', ...here, instruction: promptpay });
  expect(reopened.previous).toMatchObject({ panelKey: 'card-first', check: false });
  expect(await fx.panels()).toMatchObject([{ panelKey: 'card-first', instruction: { tenders: [{ method: 'promptpay', amount: 120000 }] } }]);
  // A split reopened on no complete parts shows no instruction, and keeps none.
  await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'split-next', ...here });
  expect((await fx.panels())[0].instruction).toBeUndefined();
  await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'promptpay-again', ...here, instruction: promptpay });
  await fx.pause();
  const check = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'paused-check', ...here });
  expect(check.previous).toMatchObject({ check: true, matches: true, instruction: { tenders: [{ method: 'promptpay', amount: 120000 }] } });
  const registration = { tillId, panelKey: 'card-first', ...here };
  await expect(fx.ploy.mutation(settle, { ...pay(order.orderId, order, card.tenders), ...registration })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  await fx.ploy.mutation(settle, { ...pay(order.orderId, order, promptpay.tenders), ...registration });
  expect(await fx.payments()).toMatchObject([{ method: 'promptpay', amount: 120000 }]);
});

it('refuses a payment other than the saved instruction from a panel left open across the pause (r5 sol server probe)', async () => {
  const fx = await fixture();
  const left = await leftBeforePause(fx, 120000, [{ method: 'card', amount: 120000 }]);
  // Still open, never reopened (so never marked checking): it can't record Transfer while its registration says Card.
  const transfer = [{ method: 'transfer' as const, amount: 120000 }];
  await expect(fx.ploy.mutation(settle, { ...pay(left.orderId, left, transfer), ...left.registration })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
  expect(await fx.payments()).toEqual([]);
  // Once the panel saved Transfer (before showing it), Transfer is what it records.
  await fx.ploy.mutation(rollout.instructDirectPanel, { orderId: left.orderId, ...left.registration, instruction: instruct(left, transfer) });
  await fx.ploy.mutation(settle, { ...pay(left.orderId, left, transfer), ...left.registration });
  expect(await fx.payments()).toMatchObject([{ method: 'transfer', amount: 120000 }]);
});

it('refuses to save an instruction for a registration it cannot find once the cutover started, and clears one a split no longer shows', async () => {
  const fx = await fixture();
  const order = await bill(fx, 120000);
  const card = instruct(order, [{ method: 'card', amount: 120000 }]);
  await fx.pause();
  await fx.unpause();
  await expect(fx.ploy.mutation(rollout.instructDirectPanel, { orderId: order.orderId, panelKey: 'never-registered', ...here, instruction: card }))
    .rejects.toMatchObject(refusal('PAY_PANEL_UNREGISTERED'));
  const { tillId } = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'after-unpause', ...here, instruction: card });
  const registration = { tillId, panelKey: 'after-unpause', ...here };
  await fx.ploy.mutation(rollout.instructDirectPanel, { orderId: order.orderId, ...registration, instruction: null });
  expect((await fx.panels())[0].instruction).toBeUndefined();
  await expect(fx.ploy.mutation(settle, { ...pay(order.orderId, order, card.tenders), ...registration })).rejects.toMatchObject(refusal('PAY_PANEL_CHECK_MISMATCH'));
});

it("never lets one cashier's receipt clear two of her registrations, and keeps the cutover closed until each is accounted for (r5 sol blocker 2)", async () => {
  const fx = await fixture();
  const order = await bill(fx, 120000);
  const card = instruct(order, [{ method: 'card', amount: 120000 }]);
  // Before the pause the same login opens Card for ฿1,200 on two tills; both terminals approve.
  const tillA = { deviceKey: 'till-a-device-key-00001', tabKey: 'till-a-device-tab-00001' };
  const tillB = { deviceKey: 'till-b-device-key-00001', tabKey: 'till-b-device-tab-00001' };
  const a = await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'till-a-card', ...tillA, instruction: card });
  await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: 'till-b-card', ...tillB, instruction: card });
  await fx.pause();
  // Till B records its own payment during the pause; its receipt names till B's registration.
  await fx.ploy.mutation(settle, { ...pay(order.orderId, order, card.tenders), panelKey: 'till-b-card', ...tillB });
  expect(await fx.t.run(ctx => ctx.db.get('orders', order.orderId))).toMatchObject({ directPanel: { panelKey: 'till-b-card', by: 'settlement' } });
  expect(await fx.panels()).toMatchObject([{ panelKey: 'till-a-card' }]);
  // B's receipt can't also clear till A, so activation stays closed.
  await expect(fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: a.tillId, panelKey: 'till-a-card', outcome: 'recorded' })))
    .rejects.toMatchObject(refusal('PAY_PANEL_RECEIPT_USED'));
  await expect(fx.activate()).rejects.toMatchObject(refusal('PAYMENTS_STILL_OPEN'));
  expect(await fx.panels()).toHaveLength(1);
  expect(await fx.payments()).toHaveLength(1);
});

it('lets a receipt with no registration of its own clear exactly one matching registration as Recorded', async () => {
  const fx = await fixture();
  const order = await bill(fx, 80000);
  const card = instruct(order, [{ method: 'card', amount: 80000 }]);
  const tills = ['till-c-device-key-00001', 'till-d-device-key-00001'].map(deviceKey => ({ deviceKey, tabKey: `${deviceKey.slice(0, 7)}-device-tab-00001` }));
  const opened = [];
  for (const [index, where] of tills.entries()) {
    opened.push({ ...where, panelKey: `panel-${index}`, ...await fx.ploy.mutation(rollout.openDirectPanel, { orderId: order.orderId, panelKey: `panel-${index}`, ...where, instruction: card }) });
  }
  // An older tab with no registration settles it before the pause.
  await fx.ploy.mutation(settle, { ...pay(order.orderId, order, card.tenders) });
  await fx.pause();
  await fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: opened[0].tillId, panelKey: 'panel-0', outcome: 'recorded' }));
  expect(await fx.t.run(ctx => ctx.db.get('orders', order.orderId))).toMatchObject({ directPanel: { panelKey: 'panel-0', by: 'manager' } });
  await expect(fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: opened[1].tillId, panelKey: 'panel-1', outcome: 'recorded' })))
    .rejects.toMatchObject(refusal('PAY_PANEL_RECEIPT_USED'));
  await expect(fx.activate()).rejects.toMatchObject(refusal('PAYMENTS_STILL_OPEN'));
  // Only an explicit, audited Nothing taken clears the other one.
  await fx.manager.mutation(rollout.reconcileDirectPanel, await reviewed(fx.t, { tillId: opened[1].tillId, panelKey: 'panel-1', outcome: 'nothing_taken' }));
  await expect(fx.activate()).resolves.toMatchObject({ status: 'applied' });
});
