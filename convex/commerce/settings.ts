import { partial } from 'convex-helpers/validators';
import { ConvexError, v } from 'convex/values';
import { staffMutation, staffQuery } from '../auth/model';
import { findDevicePaymentTill, paymentTillsAtRevision, validPaymentDeviceKey } from '../pos/model';
import { checkoutPaused, cutoverRevision, cutoverStarted, tillAcknowledged } from './private/paymentAdmission';
import { readCommerceSettings, termsOf } from './private/readSettings';
import { editCommerceSettings, settingsEditArgs, settingsEditResult } from './private/settings';
import { commerceTerms, paymentsMode, saleSwitches } from './validators';

const switchRank = { off: 0, managers: 1, everyone: 2 };
const kinds = ['products', 'vouchers', 'sessionPackages', 'mixedPackages'] as const;

export const getRules = staffQuery({
  capability: 'settings',
  args: {},
  returns: v.object({
    revision: v.number(), terms: commerceTerms, switches: saleSwitches,
    paymentsMode, canEdit: v.literal(true),
  }),
  handler: async ctx => {
    const settings = await readCommerceSettings(ctx);
    return {
      revision: settings.revision, terms: termsOf(settings), switches: settings.saleSwitches,
      paymentsMode: settings.paymentsMode, canEdit: true as const,
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
      tillReady: revision === null || (till?._id === tillId && tillAcknowledged(till, revision)),
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
      // null is "no expiry" (a voucher validity period may be unlimited).
      const invalid = (periods: (number | null | undefined)[], minimum: number) =>
        periods.some(period => period !== undefined && period !== null && (!Number.isSafeInteger(period) || period < minimum));
      if (invalid(refundPeriods, 0) || invalid(validityPeriods, 1)) {
        throw new ConvexError({ code: 'INVALID_CHECKOUT_TERMS', message: 'Use whole numbers and set each validity period to at least one.' });
      }
    }
    const nextSwitches = { ...current.saleSwitches, ...switches };
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
