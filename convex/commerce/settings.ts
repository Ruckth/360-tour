import { partial } from 'convex-helpers/validators';
import { ConvexError, v } from 'convex/values';
import { staffMutation, staffQuery } from '../auth/model';
import { findDevicePaymentTill, paymentTillsAtRevision, validPaymentDeviceKey } from '../pos/model';
import { checkoutPaused, cutoverRevision, cutoverStarted, tillAcknowledged } from './private/paymentAdmission';
import { readCommerceSettings, settingsDocument, termsOf } from './private/readSettings';
import { editCommerceSettings, settingsEditArgs, settingsEditResult } from './private/settings';
import { commerceTerms, paymentsMode, resolveCommerceSettings, saleSwitches } from './validators';

const switchRank = { off: 0, managers: 1, everyone: 2 };
const kinds = ['products', 'vouchers', 'sessionPackages', 'mixedPackages'] as const;

/**
 * Settings › Checkout rules (D20). Owners and managers read it; only the owner (settings) changes
 * the rules and switches, which updateRules enforces. `settingsId` opens the page's History; null
 * until the first change creates the row.
 */
export const getRules = staffQuery({
  capability: 'operations',
  args: {},
  returns: v.object({
    revision: v.number(), terms: commerceTerms, switches: saleSwitches,
    paymentsMode, canEdit: v.boolean(), settingsId: v.union(v.id('commerceSettings'), v.null()),
  }),
  handler: async ctx => {
    const row = await settingsDocument(ctx);
    const settings = resolveCommerceSettings(row);
    return {
      revision: settings.revision, terms: termsOf(settings), switches: settings.saleSwitches,
      paymentsMode: settings.paymentsMode, canEdit: ctx.staff.capabilities.settings, settingsId: row?._id ?? null,
    };
  },
});

export const getAccess = staffQuery({
  capability: 'checkout',
  args: { tillId: v.optional(v.id('tills')), loadedRevision: v.optional(v.number()), deviceKey: v.optional(v.string()) },
  returns: v.object({
    settingsRevision: v.number(), switches: saleSwitches,
    canSell: v.object({ products: v.boolean(), vouchers: v.boolean(), sessionPackages: v.boolean(), mixedPackages: v.boolean() }),
    paymentsMode, paused: v.boolean(), tillReady: v.boolean(), cutoverRevision: v.union(v.number(), v.null()),
    /** From the cutover's first pause on: a reopened direct panel checks its earlier instruction. */
    cutoverStarted: v.boolean(),
  }),
  handler: async (ctx, { tillId, loadedRevision, deviceKey }) => {
    const settings = await readCommerceSettings(ctx);
    const revision = cutoverRevision(settings);
    const till = revision !== null && revision === loadedRevision && validPaymentDeviceKey(deviceKey)
      ? await findDevicePaymentTill(ctx, deviceKey) : undefined;
    const allowed = (kind: typeof kinds[number]) => {
      const sale = settings.saleSwitches[kind];
      return sale === 'everyone' || (sale === 'managers' && ctx.staff.capabilities.approve);
    };
    return {
      settingsRevision: settings.revision,
      switches: settings.saleSwitches,
      canSell: {
        products: allowed('products'), vouchers: allowed('vouchers'),
        sessionPackages: allowed('sessionPackages'), mixedPackages: allowed('mixedPackages'),
      },
      paymentsMode: settings.paymentsMode,
      paused: checkoutPaused(settings),
      cutoverStarted: cutoverStarted(settings),
      tillReady: revision === null || (till !== undefined && till._id === tillId && till.key === 'payment' && tillAcknowledged(till, revision)),
      cutoverRevision: revision,
    };
  },
});

export const updateRules = staffMutation({
  capability: 'settings',
  args: { ...settingsEditArgs, terms: v.optional(partial(commerceTerms)), switches: v.optional(partial(saleSwitches)) },
  returns: settingsEditResult,
  handler: async (ctx, { terms, switches, ...edit }) => editCommerceSettings(ctx, ctx.staff, {
    ...edit, kind: 'updateSettings', input: { ...(terms && { terms }), ...(switches && { switches }) },
  }, async current => {
    if (terms) {
      const refundPeriods = [terms.unusedFullRefundDays, terms.refundDueDays?.cashOrTransfer, terms.refundDueDays?.card];
      const validityPeriods = [terms.packageValidityDays, terms.voucherValidityDays, terms.pointsExpiryMonths];
      // null: no unused-refund window, or unlimited voucher validity (only those two terms allow it).
      const invalid = (periods: (number | null | undefined)[], minimum: number) =>
        periods.some(period => period !== undefined && period !== null && (!Number.isSafeInteger(period) || period < minimum));
      if (invalid(refundPeriods, 0) || invalid(validityPeriods, 1)) {
        throw new ConvexError({ code: 'INVALID_CHECKOUT_TERMS', message: 'Use whole numbers and set each validity period to at least one.' });
      }
    }
    const nextSwitches = { ...current.saleSwitches, ...switches };
    if (switchRank[nextSwitches.products] > switchRank[current.saleSwitches.products]) {
      const unindexed = await ctx.db.query('productVariants').withIndex('by_active_product', q =>
        q.eq('status', 'active').eq('productStatus', undefined)).first();
      if (unindexed) {
        throw new ConvexError({ code: 'PRODUCT_SEARCH_NOT_READY', message: 'Finish the Stock catalog search backfill before enabling product sales.' });
      }
    }
    if (kinds.some(kind => switchRank[nextSwitches[kind]] > switchRank[current.saleSwitches[kind]])) {
      const revision = cutoverRevision(current);
      const tills = revision === null ? null : await paymentTillsAtRevision(ctx, revision, 1);
      if (!tills?.acknowledged.length || tills.pending.length) {
        throw new ConvexError({ code: 'PAYMENT_ROLLOUT_PENDING', message: 'Switch to new payments and reload every till before enabling sales.' });
      }
    }
    return { ...terms, ...(switches && { saleSwitches: nextSwitches }) };
  }),
});
