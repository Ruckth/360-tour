import { ConvexError, v, type Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { canReadCheckoutOrder, staffMutation, staffQuery } from '../auth/model';
import { reserveWrites } from '../lib/readBudget';
import {
  DIRECT_PANEL_STALE_MS, assertInstruction, deleteDirectPanel, directInstructionArgs, directPanelPage, directPanelSettled,
  directPanelTill, ensurePaymentTill, findDevicePaymentTill, findDirectPanel, findPaymentTill, isOpenOrder, matchesInstruction,
  openPaymentAttempts, orderDirectPanels, ownsPanel, panelOwner, patchDirectPanel, patchPaymentTill, paymentTillLabel,
  paymentTillsAtRevision, readDirectPanels, readPaymentOrder, receiptRecordsPanel, receiptUsed, registerDirectPanel, linkReceipt,
  validPaymentDeviceKey, type DirectPanel, type DirectInstruction as DirectPanelInstruction,
} from '../pos/model';
import { sha256 } from '../shared/displayTokens';
import { appendRecordHistory } from '../settings/model';
import { ensureDefaultBranch } from './ensureDefaultBranch';
import { checkoutPaused, cutoverRevision, cutoverStarted, refuseElsewhere, refusePaused, refuseReload } from './private/paymentAdmission';
import { readCommerceSettings } from './private/readSettings';
import { editCommerceSettings, settingsEditArgs, settingsEditResult } from './private/settings';
import { paymentsMode } from './validators';

const panelArgs = { tillId: v.optional(v.id('tills')), panelKey: v.string() };
type DirectInstructionArgs = Infer<typeof directInstructionArgs>;

function refuseAlreadySwitched(): never {
  throw new ConvexError({
    code: 'PAYMENTS_ALREADY_SWITCHED',
    message: 'New payments are already on. Resolve payment issues in the new checkout.',
  });
}

export const setPaused = staffMutation({
  capability: 'approve',
  args: { ...settingsEditArgs, paused: v.boolean() },
  returns: settingsEditResult,
  handler: async (ctx, { paused, ...edit }) => editCommerceSettings(ctx, ctx.staff, {
    ...edit, kind: 'updateSettings', input: { paused },
  }, async current => {
    if (current.paymentsMode === 'attempts') refuseAlreadySwitched();
    const cutover = paused
      ? current.cutover ?? { pausedAt: Date.now(), actor: ctx.staff.tokenIdentifier }
      : undefined;
    return paused ? { cutover, cutoverStartedAt: current.cutoverStartedAt ?? cutover!.pausedAt } : { cutover };
  }),
});

export const activate = staffMutation({
  capability: 'approve',
  args: settingsEditArgs,
  returns: settingsEditResult,
  handler: async (ctx, edit) => {
    return await editCommerceSettings(ctx, ctx.staff, {
      ...edit, kind: 'updateSettings', input: { paymentsMode: 'attempts' },
    }, async current => {
      if (current.paymentsMode === 'attempts') refuseAlreadySwitched();
      if (!current.cutover) throw new ConvexError({ code: 'PAYMENT_PAUSE_REQUIRED', message: 'Pause checkout before switching to new payments.' });
      const [registered, displayTill, { attempts, moreAttempts }] = await Promise.all([
        directPanelPage(ctx), findPaymentTill(ctx), openPaymentAttempts(ctx),
      ]);
      const panels = registered.map(({ tillId, panelKey, orderId, actor, openedAt }) =>
        ({ tillId, tillKey: paymentTillLabel({ _id: tillId }), panelKey, orderId, actor, openedAt }));
      if (displayTill) {
        panels.push(...(displayTill.paymentRollout?.panels ?? []).map(panel =>
          ({ ...panel, tillId: displayTill._id, tillKey: paymentTillLabel(displayTill) })));
      }
      if (panels.length || attempts.length) {
        throw new ConvexError({
          code: 'PAYMENTS_STILL_OPEN', message: 'Finish or reconcile open payments before switching.',
          panels, attempts, moreAttempts,
        });
      }
      return {
        paymentsMode: 'attempts',
        cutover: {
          pausedAt: current.cutover.pausedAt, activatedAt: Date.now(),
          actor: ctx.staff.tokenIdentifier, revision: current.revision + 1,
        },
      };
    }, async () => { await ensureDefaultBranch(ctx); });
  },
});

const instruction = v.object({ ...directInstructionArgs.fields, at: v.number() });
/**
 * `check`: from the cutover's first pause on, the desk checks the earlier panel before any
 * instruction. `instruction`: what it last asked staff to collect; `matches`: the order is still
 * the one it was shown for, so Taken can record exactly that.
 */
const previousPanel = v.object({
  tillId: v.id('tills'), panelKey: v.string(), openedAt: v.number(), check: v.boolean(),
  instruction: v.optional(instruction), matches: v.boolean(), notifyGuest: v.optional(v.boolean()),
});
const deviceArgs = { deviceKey: v.optional(v.string()), tabKey: v.optional(v.string()) };

/**
 * Register each direct panel before it can show a payment instruction, with that instruction. A
 * registration belongs to its cashier's till and tab: reopening the order there (a reload too)
 * continues it (`previous`). Once the cutover has started its instruction may already have been
 * paid, so the desk checks it first (`check`) and records only exactly that; another till or tab
 * sees it in progress elsewhere until a manager takes it over or reconciles it. Before the cutover
 * starts the panel is today's and nothing here refuses it. Only a brand-new registration is
 * refused while paused.
 */
export const openDirectPanel = staffMutation({
  capability: 'checkout',
  args: { ...panelArgs, ...deviceArgs, orderId: v.id('orders'), instruction: v.optional(directInstructionArgs) },
  returns: v.object({ tillId: v.id('tills'), previous: v.optional(previousPanel) }),
  handler: async (ctx, { tillId, orderId, panelKey, deviceKey, tabKey, instruction }) => {
    if (!panelKey.trim() || panelKey.length > 128) throw new ConvexError({ code: 'INVALID_PAY_PANEL', message: 'Reopen the pay panel.' });
    if ((deviceKey !== undefined && !validPaymentDeviceKey(deviceKey)) || (tabKey !== undefined && !validPaymentDeviceKey(tabKey))) refuseReload();
    if (instruction) assertInstruction(instruction);
    const order = await readPaymentOrder(ctx, orderId);
    if (!order || !isOpenOrder(order) || !canReadCheckoutOrder(ctx.staff, order)) {
      throw new ConvexError({ code: 'PAY_PANEL_ORDER_UNAVAILABLE', message: 'This order is unavailable for payment.' });
    }
    const settings = await readCommerceSettings(ctx);
    if (settings.paymentsMode !== 'direct') refuseReload();
    const till = deviceKey ? await findDevicePaymentTill(ctx, deviceKey) : await findPaymentTill(ctx, tillId);
    if (!deviceKey && till?.key === 'payment') refuseReload();
    const owner = await panelOwner(ctx.staff.tokenIdentifier, till, tabKey);
    const existing = till && await findDirectPanel(ctx, till, panelKey);
    if (existing) {
      if (existing.orderId !== orderId || !ownsPanel(existing, owner)) {
        throw new ConvexError({ code: 'KEY_CONFLICT', message: 'This pay panel key is already in use.' });
      }
      return { tillId: existing.tillId };
    }
    const started = cutoverStarted(settings);
    const panels = await orderDirectPanels(ctx, orderId, till);
    const mine = panels.find(panel => ownsPanel(panel, owner));
    if (mine) {
      // Reopened after the cutover started: only exactly its instruction, or a recorded Not taken, follows.
      if (started && !('listed' in mine) && !mine.checking) await patchDirectPanel(ctx, mine._id, { checking: true });
      // Before it, the reopened panel shows this opening instruction instead: the registration keeps that.
      if (!started && !('listed' in mine) && !sameInstruction(mine.instruction, instruction)) {
        await patchDirectPanel(ctx, mine._id, { instruction: instruction ? { ...instruction, at: Date.now() } : undefined });
        return { tillId: mine.tillId, previous: { tillId: mine.tillId, panelKey: mine.panelKey, openedAt: mine.openedAt, check: false, matches: false } };
      }
      const shown = 'instruction' in mine ? mine.instruction : undefined;
      return {
        tillId: mine.tillId,
        previous: {
          tillId: mine.tillId, panelKey: mine.panelKey, openedAt: mine.openedAt, check: started,
          ...(shown ? { instruction: shown } : {}),
          ...('notifyGuest' in mine && mine.notifyGuest !== undefined ? { notifyGuest: mine.notifyGuest } : {}),
          matches: shown !== undefined && shown.revision === order.revision && shown.due === order.due,
        },
      };
    }
    if (started && panels.length) await refusePanelElsewhere(ctx, panels[0], ctx.staff.capabilities.approve);
    if (checkoutPaused(settings)) refusePaused();
    const registeredTill = till?._id ?? await ensurePaymentTill(ctx, deviceKey);
    const now = Date.now();
    await registerDirectPanel(ctx, {
      tillId: registeredTill, panelKey, orderId, actor: ctx.staff.tokenIdentifier, actorEmail: ctx.staff.email, openedAt: now,
      ...(owner.tab ? { ownerTab: owner.tab } : {}), ...(instruction ? { instruction: { ...instruction, at: now } } : {}),
    });
    return { tillId: registeredTill };
  },
});

/** Another till or tab holds the order's open instruction. A manager is given what Take over names. */
async function refusePanelElsewhere(ctx: QueryCtx, panel: DirectPanel, manager: boolean): Promise<never> {
  const till = await findPaymentTill(ctx, panel.tillId);
  refuseElsewhere({
    tillKey: till ? paymentTillLabel(till) : 'Till', openedAt: panel.openedAt,
    ...(manager ? { tillId: panel.tillId, panelKey: panel.panelKey } : {}),
  });
}

/** This operator's registration for the order, by its key, on this device and tab. */
async function ownRegistration(
  ctx: QueryCtx, actor: string, { orderId, panelKey, tillId, deviceKey, tabKey }: { orderId: Id<'orders'>; panelKey: string; tillId?: Id<'tills'>; deviceKey?: string; tabKey?: string },
) {
  const till = await directPanelTill(ctx, { deviceKey, tillId });
  const panel = till && await findDirectPanel(ctx, till, panelKey);
  if (!panel || 'listed' in panel || panel.orderId !== orderId || !ownsPanel(panel, await panelOwner(actor, till, tabKey))) return undefined;
  return panel;
}

const registrationArgs = { ...panelArgs, ...deviceArgs, orderId: v.id('orders') };

/** The saved instruction is `instruction` (both none, or the same order revision, due and tenders). */
const sameInstruction = (saved: DirectPanelInstruction | undefined, instruction: DirectInstructionArgs | null | undefined) =>
  instruction ? matchesInstruction(saved, instruction) : saved === undefined;

/**
 * The instruction the panel shows now (another tender, a split's parts; `null` while it shows none,
 * such as a split whose parts don't cover the bill yet) and its booking email choice. Best effort
 * before the cutover starts. From then on the panel shows an instruction only once this saved it,
 * and a panel this can't find is refused. A registration being checked keeps its earlier
 * instruction until staff record Not taken (answerDirectPanel), so a reopened panel never replaces
 * what may have been paid; its email choice can still change.
 */
export const instructDirectPanel = staffMutation({
  capability: 'checkout',
  args: { ...registrationArgs, instruction: v.optional(v.union(directInstructionArgs, v.null())), notifyGuest: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { instruction, notifyGuest, ...registration }) => {
    if (instruction) assertInstruction(instruction);
    const panel = await ownRegistration(ctx, ctx.staff.tokenIdentifier, registration);
    if (!panel) {
      if (cutoverStarted(await readCommerceSettings(ctx))) {
        throw new ConvexError({ code: 'PAY_PANEL_UNREGISTERED', message: "This payment wasn't saved. Go back to the order and open it again." });
      }
      return null;
    }
    const changed = instruction !== undefined && !sameInstruction(panel.instruction, instruction);
    if (changed && panel.checking) throw new ConvexError({ code: 'PAY_PANEL_CHECK_FIRST', message: 'Check the previous payment first.' });
    const patch = {
      ...(changed ? { instruction: instruction ? { ...instruction, at: Date.now() } : undefined } : {}),
      ...(notifyGuest !== undefined && notifyGuest !== panel.notifyGuest ? { notifyGuest } : {}),
    };
    if (Object.keys(patch).length) await patchDirectPanel(ctx, panel._id, patch);
    return null;
  },
});

/**
 * Check previous payment → Not taken, outside the pause: the earlier instruction took nothing, so
 * the panel can show a new one. During the pause a manager reconciles instead.
 */
export const answerDirectPanel = staffMutation({
  capability: 'checkout',
  args: { ...registrationArgs, outcome: v.literal('notTaken') },
  returns: v.null(),
  handler: async (ctx, { outcome, ...registration }) => {
    const settings = await readCommerceSettings(ctx);
    if (settings.paymentsMode !== 'direct') refuseReload();
    const panel = await ownRegistration(ctx, ctx.staff.tokenIdentifier, registration);
    if (!panel?.checking) return null;
    if (checkoutPaused(settings)) refusePaused();
    await patchDirectPanel(ctx, panel._id, { checking: false, instruction: undefined });
    reserveWrites(ctx, 1);
    await appendRecordHistory(ctx, {
      entityType: 'till', entityId: panel.tillId, actor: ctx.staff.email, kind: 'direct_panel_checked',
      after: { panelKey: panel.panelKey, orderId: panel.orderId, outcome, instruction: panel.instruction ?? null },
    });
    return null;
  },
});

/**
 * A manager moves an open direct registration to this till and tab after checking the terminal and
 * drawer and confirming its operator has stopped. Its instruction stays, so this till checks it
 * before anything else.
 */
export const takeOverDirectPanel = staffMutation({
  capability: 'approve',
  args: { orderId: v.id('orders'), tillId: v.id('tills'), panelKey: v.string(), deviceKey: v.string(), tabKey: v.string(), stoppedPreviousOperator: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { orderId, tillId, panelKey, deviceKey, tabKey, stoppedPreviousOperator }) => {
    if (!validPaymentDeviceKey(deviceKey) || !validPaymentDeviceKey(tabKey)) refuseReload();
    if (!stoppedPreviousOperator) throw new ConvexError({ code: 'OPERATOR_NOT_STOPPED', message: 'Confirm the other till has stopped first.' });
    const settings = await readCommerceSettings(ctx);
    if (settings.paymentsMode !== 'direct') refuseReload();
    const order = await readPaymentOrder(ctx, orderId);
    if (!order || !canReadCheckoutOrder(ctx.staff, order)) throw new ConvexError({ code: 'PAY_PANEL_ORDER_UNAVAILABLE', message: 'This order is unavailable for payment.' });
    const from = await findPaymentTill(ctx, tillId);
    const panel = from && await findDirectPanel(ctx, from, panelKey);
    if (!panel || panel.orderId !== orderId) return null;
    const to = await ensurePaymentTill(ctx, deviceKey);
    const owner = { actor: ctx.staff.tokenIdentifier, tillId: to, tab: await sha256(tabKey) };
    if (ownsPanel(panel, owner)) return null;
    const moved = { tillId: to, actor: owner.actor, actorEmail: ctx.staff.email, ownerTab: owner.tab, checking: true };
    if ('listed' in panel) {
      await deleteDirectPanel(ctx, panel);
      await registerDirectPanel(ctx, { ...moved, openedAt: panel.openedAt, panelKey, orderId });
    } else {
      await patchDirectPanel(ctx, panel._id, moved);
    }
    reserveWrites(ctx, 1);
    await appendRecordHistory(ctx, {
      entityType: 'till', entityId: panel.tillId, actor: ctx.staff.email, kind: 'direct_panel_taken_over',
      before: { tillId: panel.tillId, panelActor: panel.actor }, after: { tillId: to, panelKey, orderId, panelActor: owner.actor },
    });
    return null;
  },
});

/** Older clients may still call this on navigation. Only settlement or reconciliation releases an admission. */
export const closeDirectPanel = staffMutation({
  capability: 'checkout',
  args: panelArgs,
  returns: v.null(),
  handler: async (ctx, { tillId, panelKey }) => {
    const till = await findPaymentTill(ctx, tillId);
    const panel = till && await findDirectPanel(ctx, till, panelKey);
    if (!panel) return null;
    if (panel.actor !== ctx.staff.tokenIdentifier) {
      throw new ConvexError({ code: 'NEEDS_MANAGER', message: 'Ask a manager to reconcile this pay panel.' });
    }
    throw new ConvexError({ code: 'PAY_PANEL_UNVERIFIED', message: 'Record the sale or ask a manager to verify what was taken.' });
  },
});

const panelRow = v.object({
  tillId: v.id('tills'), tillKey: v.string(), panelKey: v.string(), orderId: v.id('orders'),
  orderNumber: v.union(v.number(), v.null()), orderStatus: v.union(v.literal('draft'), v.literal('paid'), v.literal('void'), v.literal('discarded'), v.null()),
  actor: v.string(), openedAt: v.number(), settled: v.boolean(), stale: v.boolean(),
});

/** First page of open admissions. Reconciliation removes rows and makes the next ones visible. */
export const directPanels = staffQuery({
  capability: 'approve',
  args: {},
  returns: v.array(panelRow),
  handler: async ctx => {
    const now = Date.now();
    const [panels, displayTill] = await Promise.all([directPanelPage(ctx), findPaymentTill(ctx)]);
    const rows = await Promise.all(panels.map(async panel => {
      const [order, till] = await Promise.all([readPaymentOrder(ctx, panel.orderId), findPaymentTill(ctx, panel.tillId)]);
      return projectPanel(panel, order, panel.tillId, till ? paymentTillLabel(till) : 'Till', now);
    }));
    if (displayTill) {
      for (const { panel, order } of await readDirectPanels(ctx, displayTill)) {
        rows.push(projectPanel(panel, order, displayTill._id, paymentTillLabel(displayTill), now));
      }
    }
    return rows;
  },
});

function projectPanel(
  { panelKey, orderId, actor, openedAt }: { panelKey: string; orderId: Id<'orders'>; actor: string; openedAt: number },
  order: Awaited<ReturnType<typeof readPaymentOrder>>, tillId: Id<'tills'>, tillKey: string, now: number,
) {
  return {
    tillId, tillKey, panelKey, orderId,
    orderNumber: order?.orderNumber ?? null, orderStatus: order?.status ?? null, actor,
    openedAt, settled: directPanelSettled(order), stale: now - openedAt > DIRECT_PANEL_STALE_MS,
  };
}

/**
 * A manager resolves an open registration after checking the terminal and drawer. Recorded needs
 * the receipt that records exactly this registration's instruction, issued by its cashier; a
 * receipt from another panel never resolves it.
 */
export const reconcileDirectPanel = staffMutation({
  capability: 'approve',
  args: { tillId: v.id('tills'), panelKey: v.string(), outcome: v.union(v.literal('recorded'), v.literal('nothing_taken')) },
  returns: v.null(),
  handler: async (ctx, { tillId, panelKey, outcome }) => {
    const till = await findPaymentTill(ctx, tillId);
    const panel = till && await findDirectPanel(ctx, till, panelKey);
    if (!panel) return null;
    const order = outcome === 'recorded' ? await readPaymentOrder(ctx, panel.orderId) : undefined;
    if (outcome === 'recorded') {
      if (!directPanelSettled(order)) throw new ConvexError({ code: 'PAY_PANEL_NOT_PAID', message: 'Record the payment before reconciling this panel.' });
      if (!await receiptRecordsPanel(ctx, panel, order)) {
        throw new ConvexError({ code: 'PAY_PANEL_OTHER_RECEIPT', message: "This receipt doesn't record this panel's payment. Check the terminal and drawer for it." });
      }
      if (receiptUsed(order!)) {
        throw new ConvexError({
          code: 'PAY_PANEL_RECEIPT_USED',
          message: "This receipt already records another pay panel's payment. Check the terminal and drawer for this one.",
        });
      }
    }
    await deleteDirectPanel(ctx, panel);
    // The receipt accounts for this registration only: it can't clear another one.
    if (order) await linkReceipt(ctx, order._id, panel, 'manager');
    reserveWrites(ctx, 1);
    await appendRecordHistory(ctx, {
      entityType: 'till', entityId: till._id, actor: ctx.staff.email, kind: 'direct_panel_reconciled',
      after: {
        panelKey, orderId: panel.orderId, panelActor: panel.actor, openedAt: panel.openedAt, outcome,
        instruction: ('instruction' in panel ? panel.instruction : undefined) ?? null,
        ...(order ? { receiptNumber: order.receiptNumber, settleKey: order.settleKey } : {}),
      },
    });
    return null;
  },
});

export const acknowledge = staffMutation({
  capability: 'checkout',
  args: { tillId: v.optional(v.id('tills')), deviceKey: v.optional(v.string()), loadedMode: paymentsMode, loadedRevision: v.number() },
  returns: v.object({ tillId: v.id('tills'), revision: v.number(), acknowledgedAt: v.number() }),
  handler: async (ctx, { deviceKey, loadedMode, loadedRevision }) => {
    const settings = await readCommerceSettings(ctx);
    const revision = cutoverRevision(settings);
    if (revision === null || loadedMode !== 'attempts' || loadedRevision !== revision || !validPaymentDeviceKey(deviceKey)) refuseReload();
    const till = await findPaymentTill(ctx, await ensurePaymentTill(ctx, deviceKey));
    if (!till) refuseReload();
    const existing = till.paymentRollout?.acknowledged;
    if (existing?.mode === 'attempts' && existing.revision === revision) {
      return { tillId: till._id, revision, acknowledgedAt: existing.at };
    }
    const acknowledgedAt = Date.now();
    await patchPaymentTill(ctx, till, { acknowledged: { mode: 'attempts', revision, at: acknowledgedAt } });
    return { tillId: till._id, revision, acknowledgedAt };
  },
});

const tillStatus = { tillId: v.id('tills'), key: v.string() };
export const status = staffQuery({
  capability: 'settings',
  args: {},
  returns: v.object({
    mode: paymentsMode, settingsRevision: v.number(), paused: v.boolean(),
    cutoverAt: v.union(v.number(), v.null()), cutoverRevision: v.union(v.number(), v.null()),
    acknowledged: v.array(v.object({ ...tillStatus, at: v.number() })),
    pending: v.array(v.object(tillStatus)), moreTills: v.boolean(),
  }),
  handler: async ctx => {
    const settings = await readCommerceSettings(ctx);
    const revision = cutoverRevision(settings);
    const tills = revision === null ? { acknowledged: [], pending: [], moreTills: false } : await paymentTillsAtRevision(ctx, revision);
    const summarize = (till: (typeof tills.pending)[number]) => ({ tillId: till._id, key: paymentTillLabel(till) });
    return {
      mode: settings.paymentsMode, settingsRevision: settings.revision, paused: checkoutPaused(settings),
      cutoverAt: settings.cutover?.activatedAt ?? null, cutoverRevision: revision, moreTills: tills.moreTills,
      acknowledged: tills.acknowledged.map(till => ({ ...summarize(till), at: till.paymentRollout!.acknowledged!.at })),
      pending: tills.pending.map(summarize),
    };
  },
});
