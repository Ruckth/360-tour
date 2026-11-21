import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { reserveWrites } from '../../lib/readBudget';
import { sha256 } from '../../shared/displayTokens';
import { MAX_TENDERS } from '../../shared/orderMath';
import { findDevicePaymentTill, findPaymentTill, patchPaymentTill, readPaymentRows, validPaymentDeviceKey } from './tillPayments';

/*
 * The direct panel's registry during the payments rollout (v27 Rollout gate). A registration
 * belongs to one cashier on one till and tab, like an attempt, and keeps the instruction its panel
 * last showed. From the cutover's first pause on, a reopened panel can only record exactly that
 * instruction; anything else is a manager's reconciliation.
 */

export const DIRECT_PANEL_PAGE_SIZE = 100;
/** A direct panel open longer than a shift is shown to managers as stale; it is never released by age. */
export const DIRECT_PANEL_STALE_MS = 12 * 60 * 60 * 1000;
/** Open registrations read for one order: this cashier's tabs and any other cashier's. */
const ORDER_PANEL_LIMIT = 16;

/** What the panel shows staff to collect: each tender's method and amount, against the order it reviewed. */
export const directInstructionArgs = v.object({
  revision: v.number(),
  due: v.number(),
  tenders: v.array(v.object({
    method: v.union(v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer')), amount: v.number(),
  })),
});
export const directInstruction = v.object({ ...directInstructionArgs.fields, at: v.number() });
export type DirectInstruction = Infer<typeof directInstruction>;
type InstructionArgs = Infer<typeof directInstructionArgs>;

export const directPanelFields = {
  tillId: v.id('tills'), panelKey: v.string(), orderId: v.id('orders'),
  actor: v.string(), openedAt: v.number(),
  /** SHA-256 of the tab key: another tab of the same browser is another operator. */
  ownerTab: v.optional(v.string()),
  /** The cashier's email, which the receipt names (orders.paidBy). */
  actorEmail: v.optional(v.string()),
  instruction: v.optional(directInstruction),
  /** Reopened after the cutover started: its instruction may have been paid, so it is checked first. */
  checking: v.optional(v.boolean()),
  /** The booking payment confirmation email choice the panel last showed, kept for a reopened panel. */
  notifyGuest: v.optional(v.boolean()),
  /**
   * Bumped by every change to the instruction, the checked state or the owner, so a manager's
   * review of this registration is refused once the till changes it (absent: 0).
   */
  revision: v.optional(v.number()),
};

type ListedPanel = NonNullable<NonNullable<Doc<'tills'>['paymentRollout']>['panels']>[number];
export type DirectPanel = Doc<'directPaymentPanels'> | (ListedPanel & { tillId: Id<'tills'>; listed: true });
export type PanelOwner = { actor: string; tillId?: Id<'tills'>; tab?: string };

export function assertInstruction(instruction: InstructionArgs) {
  const { tenders, due, revision } = instruction;
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const sum = tenders.reduce((total, tender) => total + tender.amount, 0);
  if (!integer(due) || !Number.isSafeInteger(revision) || tenders.length > MAX_TENDERS || !tenders.every(tender => integer(tender.amount)) || sum !== due) {
    throw new Error('Invalid payment instruction');
  }
}

/**
 * The till a direct panel request names. A device's own till needs its device key; without one,
 * only the shared default till.
 */
export async function directPanelTill(ctx: QueryCtx, { deviceKey, tillId }: { deviceKey?: string; tillId?: Id<'tills'> }) {
  if (deviceKey !== undefined) return validPaymentDeviceKey(deviceKey) ? await findDevicePaymentTill(ctx, deviceKey) : undefined;
  const till = await findPaymentTill(ctx, tillId);
  return till?.key === 'payment' ? undefined : till;
}

export async function panelOwner(actor: string, till: Doc<'tills'> | undefined, tabKey: string | undefined): Promise<PanelOwner> {
  return { actor, tillId: till?._id, ...(validPaymentDeviceKey(tabKey) ? { tab: await sha256(tabKey) } : {}) };
}

/** The registration's review revision: a pre-ledger or older row is 0. */
export const panelRevision = (panel: DirectPanel) => ('revision' in panel ? panel.revision : undefined) ?? 0;

export function ownsPanel(panel: DirectPanel, owner: PanelOwner) {
  return panel.actor === owner.actor && panel.tillId === owner.tillId &&
    ('ownerTab' in panel ? panel.ownerTab : undefined) === owner.tab;
}

/** The registration under `panelKey` on this till, including the till's pre-ledger list. */
export async function findDirectPanel(ctx: QueryCtx, till: Doc<'tills'>, panelKey: string): Promise<DirectPanel | undefined> {
  const [panel] = await readPaymentRows(ctx, () => ctx.db.query('directPaymentPanels')
    .withIndex('by_tillId_and_panelKey', q => q.eq('tillId', till._id).eq('panelKey', panelKey)).take(1));
  if (panel) return panel;
  const listed = till.paymentRollout?.panels?.find(open => open.panelKey === panelKey);
  return listed ? { ...listed, tillId: till._id, listed: true } : undefined;
}

/** The order's open registrations (bounded), and the requesting till's pre-ledger entries for it. */
export async function orderDirectPanels(ctx: QueryCtx, orderId: Id<'orders'>, till?: Doc<'tills'>): Promise<DirectPanel[]> {
  const rows: DirectPanel[] = [...await readPaymentRows(ctx, () => ctx.db.query('directPaymentPanels')
    .withIndex('by_orderId_and_actor', q => q.eq('orderId', orderId)).take(ORDER_PANEL_LIMIT))];
  for (const listed of till?.paymentRollout?.panels ?? []) {
    if (listed.orderId === orderId) rows.push({ ...listed, tillId: till!._id, listed: true });
  }
  return rows;
}

const tenderKey = (tenders: readonly { method: string; amount: number }[]) =>
  tenders.map(({ method, amount }) => `${method}:${amount}`).sort().join(',');

/** Whether a payment is exactly the instruction: the same order revision and due, the same tenders (cash received aside). */
export function matchesInstruction(instruction: DirectInstruction | undefined, payment: InstructionArgs) {
  return instruction !== undefined && instruction.revision === payment.revision && instruction.due === payment.due &&
    tenderKey(instruction.tenders) === tenderKey(payment.tenders);
}

export async function registerDirectPanel(ctx: MutationCtx, panel: Omit<Doc<'directPaymentPanels'>, '_id' | '_creationTime'>) {
  reserveWrites(ctx, 1);
  await ctx.db.insert('directPaymentPanels', panel);
}

export async function patchDirectPanel(ctx: MutationCtx, id: Id<'directPaymentPanels'>, patch: Partial<Doc<'directPaymentPanels'>>) {
  reserveWrites(ctx, 1);
  await ctx.db.patch('directPaymentPanels', id, patch);
}

/** Removes one registration, from the ledger or from its till's pre-ledger list. */
export async function deleteDirectPanel(ctx: MutationCtx, panel: DirectPanel) {
  if (!('listed' in panel)) {
    reserveWrites(ctx, 1);
    await ctx.db.delete(panel._id);
    return;
  }
  const till = await findPaymentTill(ctx, panel.tillId);
  const panels = till?.paymentRollout?.panels;
  if (till && panels) await patchPaymentTill(ctx, till, { panels: panels.filter(open => open.panelKey !== panel.panelKey) });
}

/**
 * The registration a direct payment settles under: the one it names, else one being checked, else
 * this operator's only other one for the order (same till and tab).
 */
export function settlingPanel(mine: readonly DirectPanel[], panelKey: string | undefined) {
  return mine.find(panel => panel.panelKey === panelKey) ?? mine.find(panel => 'checking' in panel && panel.checking) ?? mine[0];
}

/**
 * A successful direct settlement releases the one registration it settled under and records it
 * on the receipt, so that receipt can never also account for another registration.
 */
export async function closeSettledDirectPanel(
  ctx: MutationCtx, orderId: Id<'orders'>, owner: PanelOwner, till: Doc<'tills'> | undefined, panelKey: string | undefined,
) {
  if (!owner.tillId) return;
  const panel = settlingPanel((await orderDirectPanels(ctx, orderId, till)).filter(open => ownsPanel(open, owner)), panelKey);
  if (!panel) return;
  await deleteDirectPanel(ctx, panel);
  await linkReceipt(ctx, orderId, panel, 'settlement');
}

/** Records on the receipt the one registration it accounts for. */
export async function linkReceipt(ctx: MutationCtx, orderId: Id<'orders'>, panel: DirectPanel, by: 'settlement' | 'manager') {
  reserveWrites(ctx, 1);
  await ctx.db.patch('orders', orderId, { directPanel: { tillId: panel.tillId, panelKey: panel.panelKey, by } });
}

/** A manager can reconcile as recorded only if the order has a receipt. */
export function directPanelSettled(order: Doc<'orders'> | undefined) {
  return order?.receiptNumber !== undefined && (order.status === 'paid' || order.status === 'void');
}

/**
 * Evidence that the order's receipt records this registration's instruction: its cashier issued
 * it, at the order revision the instruction reviewed, for exactly the instructed tenders (so the
 * same due). Another panel's receipt never resolves this one, and neither does one that already
 * accounts for a registration (receiptUsed). Cheap checks come first: only a candidate receipt
 * reads its payments.
 */
export async function receiptRecordsPanel(ctx: QueryCtx, panel: DirectPanel, order: Doc<'orders'> | undefined) {
  if (!order || !directPanelSettled(order) || !('instruction' in panel) || !panel.instruction || !panel.actorEmail) return false;
  if (order.paidBy !== panel.actorEmail || order.settleKey === undefined) return false;
  if (order.settledRevision === undefined || order.settledRevision !== panel.instruction.revision) return false;
  const payments = await readPaymentRows(ctx, () => ctx.db.query('orderPayments')
    .withIndex('by_orderId', q => q.eq('orderId', order._id)).take(MAX_TENDERS + 1));
  const recorded = payments.filter(payment => payment.idempotencyKey === order.settleKey && payment.method !== 'voucher')
    .map(payment => ({ method: payment.method, amount: payment.amount }));
  return tenderKey(recorded) === tenderKey(panel.instruction.tenders);
}

/** The receipt already accounts for a registration (the one that settled it, or an earlier Recorded). */
export const receiptUsed = (order: Doc<'orders'>) => order.directPanel !== undefined;

export async function directPanelPage(ctx: QueryCtx) {
  return await readPaymentRows(ctx, () => ctx.db.query('directPaymentPanels').take(DIRECT_PANEL_PAGE_SIZE));
}

/** Each pre-ledger panel with its order (at most 12 entries). */
export async function readDirectPanels(ctx: QueryCtx, till: Doc<'tills'>) {
  return await Promise.all((till.paymentRollout?.panels ?? []).map(async panel => {
    const [order] = await readPaymentRows(ctx, async () => {
      const found = await ctx.db.get('orders', panel.orderId);
      return found ? [found] : [];
    });
    return { panel, order };
  }));
}
