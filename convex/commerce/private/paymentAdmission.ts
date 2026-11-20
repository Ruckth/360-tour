import { ConvexError, v, type Infer } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { directPanelTill, findDevicePaymentTill, matchesInstruction, orderDirectPanels, ownsPanel, panelOwner, settlingPanel, validPaymentDeviceKey } from '../../pos/model';
import { paymentsMode, type CommerceSettings } from '../validators';
import { readCommerceSettings } from './readSettings';

export const paymentTillLoad = v.object({
  tillId: v.id('tills'),
  deviceKey: v.optional(v.string()),
  loadedMode: paymentsMode,
  loadedRevision: v.number(),
});

export function checkoutPaused(settings: CommerceSettings) {
  return settings.paymentsMode === 'direct' && settings.cutover !== undefined;
}

/**
 * From the first pause on (and after activation), a reopened direct panel checks the earlier one
 * before any instruction. Before it, today's direct checkout is unchanged.
 */
export function cutoverStarted(settings: CommerceSettings) {
  return settings.paymentsMode === 'attempts' || settings.cutover !== undefined || settings.cutoverStartedAt !== undefined;
}

export function cutoverRevision(settings: CommerceSettings) {
  return settings.paymentsMode === 'attempts' ? settings.cutover?.revision ?? settings.revision : null;
}

export function tillAcknowledged(till: Doc<'tills'> | undefined, revision: number | null) {
  const ack = till?.paymentRollout?.acknowledged;
  return revision !== null && ack?.mode === 'attempts' && ack.revision === revision;
}

export function refuseReload(): never {
  throw new ConvexError({ code: 'TILL_NEEDS_RELOAD', message: 'Reload this till before taking payment.' });
}

export function refusePaused(): never {
  throw new ConvexError({ code: 'CHECKOUT_PAUSED', message: 'Checkout paused for update.' });
}

/** `detail`: the open panel's till and time; its registration only for a manager, who can take it over. */
export function refuseElsewhere(detail: Record<string, unknown> = {}): never {
  throw new ConvexError({
    code: 'PAY_PANEL_ELSEWHERE',
    message: 'This order has a payment open on another till or tab. Finish it there, or ask a manager to take it over.',
    ...detail,
  });
}

export function refuseCheckMismatch(): never {
  throw new ConvexError({
    code: 'PAY_PANEL_CHECK_MISMATCH',
    message: "This isn't the payment the earlier panel asked for. Ask a manager to reconcile it.",
  });
}

type DirectRegistration = { tillId?: Id<'tills'>; panelKey?: string; deviceKey?: string; tabKey?: string };

/**
 * Called inside direct settlement after an authorized pre-cutover receipt replay is handled.
 * Returns the operator's registration (if any) so settlement can release it. While paused only a
 * registration this cashier holds on this till and tab can settle. A registration being checked
 * (reopened after the cutover started) settles only exactly what it instructed, and from then on
 * every registration settles only the instruction it saved. Before any pause a missing or unknown
 * registration settles as today.
 */
export async function assertDirectPaymentAdmission(
  ctx: QueryCtx,
  { orderId, actor, payment, ...registration }: DirectRegistration & {
    orderId: Id<'orders'>; actor: string;
    /** What staff confirmed: the order revision and due they reviewed and the tenders. */
    payment?: { revision: number; due: number; tenders: { method: 'cash' | 'promptpay' | 'card' | 'transfer'; amount: number }[] };
  },
  settings?: CommerceSettings,
) {
  const current = settings ?? await readCommerceSettings(ctx);
  if (current.paymentsMode === 'attempts') refuseReload();
  const paused = checkoutPaused(current);
  const till = registration.panelKey ? await directPanelTill(ctx, registration) : undefined;
  const owner = await panelOwner(actor, till, registration.tabKey);
  // Before the cutover starts nothing here can refuse or change the payment: today's direct checkout.
  if (!cutoverStarted(current)) return { owner, till, notifyGuest: undefined };
  const panels = await orderDirectPanels(ctx, orderId, till);
  const mine = panels.filter(panel => ownsPanel(panel, owner));
  if (!mine.length) {
    if (paused) refusePaused();
    // An instruction left open for this order (on any till) is reconciled before anyone else records a payment for it.
    if (panels.length) refuseElsewhere();
    return { owner, till, notifyGuest: undefined };
  }
  // From the first pause on, a registration records only the instruction it saved, which is what
  // its panel shows: a checked one's earlier instruction, or the one the panel saved before showing it.
  const recorded = (open: (typeof mine)[number]) => payment !== undefined && matchesInstruction('instruction' in open ? open.instruction : undefined, payment);
  const checked = mine.find(open => 'checking' in open && open.checking);
  if (checked && !recorded(checked)) refuseCheckMismatch();
  const panel = settlingPanel(mine, registration.panelKey)!;
  if (!('listed' in panel) && !recorded(panel)) refuseCheckMismatch();
  // The email choice the registration kept, for a request that doesn't state one.
  return { owner, till, notifyGuest: 'notifyGuest' in panel ? panel.notifyGuest : undefined };
}

/** The caller pins loadedMode/loadedRevision to the initial page load. Never refresh them in place. */
export async function assertAttemptPaymentAdmission(
  ctx: QueryCtx, load: Infer<typeof paymentTillLoad> | undefined, settings?: CommerceSettings,
) {
  const current = settings ?? await readCommerceSettings(ctx);
  if (checkoutPaused(current)) refusePaused();
  if (current.paymentsMode !== 'attempts') {
    throw new ConvexError({ code: 'PAYMENT_ATTEMPTS_DISABLED', message: 'New payments have not been switched on.' });
  }
  const revision = cutoverRevision(current);
  if (!validPaymentDeviceKey(load?.deviceKey) || load?.loadedMode !== 'attempts' || load.loadedRevision !== revision) refuseReload();
  const till = await findDevicePaymentTill(ctx, load.deviceKey);
  if (!till || till._id !== load.tillId || !tillAcknowledged(till, revision)) refuseReload();
  return till;
}
