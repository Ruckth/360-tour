import { validate } from 'convex-helpers/validators';
import { ConvexError, v } from 'convex/values';
import { staffMutation, canReadCheckoutOrder } from '../../auth/model';
import { preparePropertyPriceEdit } from '../../catalog/model';
import { adjust as dispatchAdjustment, adjustmentEffect, adjustmentKind, adjustmentTarget, executeApprovedAdjustment, type AdjustmentWriter } from '../../commerce/model';
import { prepareServicePriceEdit } from '../../services/model';
import { editReasons } from '../../shared/commerce/reasons';
import { amendedCustomerValidator } from '../../shared/staffTypes';
import { correctedTender } from '../../shared/financeValidators';
import { prepareRecollectionTakeBack } from '../private/handoverCustody';
import { readOrderProjection } from '../private/orderLifecycle';
import { checkoutPaymentSettings } from '../private/paymentAttempt';
import { prepareAmendOrderPayment } from '../private/paymentCorrections';
import { assertNoOpenReturn } from '../private/returnGuards';

const paymentInput = v.object({
  tenders: v.optional(v.array(correctedTender)),
  effectiveAt: v.optional(v.number()),
  customer: v.optional(amendedCustomerValidator),
});
const takeBackInput = v.object({
  contentKey: v.string(), quantity: v.number(), disposition: v.union(v.literal('sellable'), v.literal('damaged')),
});
const serviceInput = v.object({ price: v.number() });
const propertyInput = v.object({ pricePerNight: v.number() });

const applied = v.object({
  status: v.literal('applied'), adjustmentId: v.id('commerceAdjustments'), revision: v.number(), effects: v.array(adjustmentEffect),
});

function refuse(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

const writer: AdjustmentWriter = {
  assertScope: async (ctx, actor, { target, kind, reasonCode }) => {
    if (reasonCode && !editReasons.some(reason => reason === reasonCode)) {
      refuse('INVALID_ADJUSTMENT_REASON', 'Choose an edit reason from the list.');
    }
    switch (target.targetType) {
      case 'order': {
        if (kind !== 'amendPayment') break;
        const order = await readOrderProjection(ctx, () => ctx.db.get(target.targetId));
        if (!order || !canReadCheckoutOrder(actor, order)) refuse('ADJUSTMENT_TARGET_MISSING', 'Order not found.');
        if (actor.role === 'cashier') {
          const { paymentsMode, cutover } = await checkoutPaymentSettings(ctx);
          if (cutover && !cutover.activatedAt) refuse('CHECKOUT_PAUSED', 'Checkout is paused for update.');
          if (paymentsMode !== 'attempts') refuse('SALE_SWITCH_OFF', 'Receipt adjustments are unavailable before checkout cutover.');
        }
        return;
      }
      case 'handover': {
        if (kind !== 'takeBack') break;
        const handover = await readOrderProjection(ctx, () => ctx.db.get(target.targetId));
        if (!handover || handover.kind !== 'recollect') refuse('ADJUSTMENT_TARGET_MISSING', 'Recollection charge not found.');
        return;
      }
      case 'service':
      case 'property': {
        if (kind !== 'editCatalogue') break;
        if (!await readOrderProjection(ctx, () => ctx.db.get(target.targetId))) {
          refuse('ADJUSTMENT_TARGET_MISSING', 'The catalogue item no longer exists.');
        }
        return;
      }
    }
    refuse('ADJUSTMENT_UNSUPPORTED', 'This edit is unavailable for the selected target.');
  },
  prepare: async (ctx, actor, { target, kind, input, reasonCode, reasonText }) => {
    if (target.targetType === 'order' && validate(paymentInput, input)) {
      const order = await readOrderProjection(ctx, () => ctx.db.get(target.targetId));
      if (!order || order.status !== 'paid' || order.voidUnreceived) refuse('ADJUSTMENT_ORDER_NOT_PAID', 'Only a paid order can be corrected.');
      if (order.activeAttemptId) refuse('PAYMENT_IN_PROGRESS', 'Resolve the payment in progress before editing this receipt.');
      await assertNoOpenReturn(ctx, order);
      const { correction, apply } = await prepareAmendOrderPayment(ctx, order, input, { preserveVoucherTenders: true }).catch(error => {
        if (error instanceof ConvexError && typeof error.data === 'string') refuse('ADJUSTMENT_INVALID_PAYMENT', error.data);
        throw error;
      });
      const { tendersBefore, tendersAfter, customerBefore, customerAfter, customerIdBefore, customerIdAfter, effectiveAtBefore, effectiveAtAfter } = correction;
      return {
        before: {
          ...(tendersBefore ? { tenders: tendersBefore } : {}),
          ...(customerBefore !== undefined ? { customer: customerBefore, customerId: customerIdBefore ?? null } : {}),
          ...(effectiveAtBefore !== undefined ? { effectiveAt: effectiveAtBefore } : {}),
        },
        after: {
          ...(tendersAfter ? { tenders: tendersAfter } : {}),
          ...(customerAfter !== undefined ? { customer: customerAfter, customerId: customerIdAfter ?? null } : {}),
          ...(effectiveAtAfter !== undefined ? { effectiveAt: effectiveAtAfter } : {}),
        },
        apply: async ({ sourceKey }) => {
          const result = await apply(sourceKey, reasonText ?? reasonCode!, actor);
          return [{ kind: 'orderCorrection', id: result.correctionId }];
        },
      };
    }
    if (target.targetType === 'handover' && kind === 'takeBack' && validate(takeBackInput, input)) {
      const handover = await readOrderProjection(ctx, () => ctx.db.get(target.targetId));
      if (!handover) refuse('ADJUSTMENT_TARGET_MISSING', 'Recollection charge not found.');
      return await prepareRecollectionTakeBack(ctx, actor, handover, input);
    }
    if (target.targetType === 'service' && validate(serviceInput, input)) {
      const service = await readOrderProjection(ctx, () => ctx.db.get(target.targetId));
      if (!service) refuse('ADJUSTMENT_TARGET_MISSING', 'Service not found.');
      if (input.price === service.price) refuse('ADJUSTMENT_NO_CHANGE', 'The service price is unchanged.');
      if (!Number.isSafeInteger(input.price) || input.price < 0) refuse('ADJUSTMENT_INVALID_INPUT', 'Price must be nonnegative satang.');
      return await prepareServicePriceEdit(ctx, service, input.price, actor.email);
    }
    if (target.targetType === 'property' && validate(propertyInput, input)) {
      const property = await readOrderProjection(ctx, () => ctx.db.get(target.targetId));
      if (!property) refuse('ADJUSTMENT_TARGET_MISSING', 'Property not found.');
      if (input.pricePerNight === property.pricePerNight) refuse('ADJUSTMENT_NO_CHANGE', 'The nightly price is unchanged.');
      if (!Number.isSafeInteger(input.pricePerNight) || input.pricePerNight < 0) refuse('ADJUSTMENT_INVALID_INPUT', 'Price must be nonnegative satang.');
      return await preparePropertyPriceEdit(ctx, property, input.pricePerNight, actor.email);
    }
    refuse('ADJUSTMENT_INVALID_INPUT', 'The edit fields do not match the selected target.');
  },
};

export const adjust = staffMutation({
  capability: 'checkout',
  args: {
    target: adjustmentTarget, kind: adjustmentKind, input: v.union(paymentInput, takeBackInput, serviceInput, propertyInput),
    expectedRevision: v.number(), clientKey: v.string(), reasonCode: v.optional(v.string()), reasonText: v.optional(v.string()),
  },
  returns: v.union(applied, v.object({
    status: v.literal('approvalRequired'), requestId: v.id('staffApprovalRequests'), expiresAt: v.number(),
  })),
  handler: (ctx, args) => dispatchAdjustment(ctx, ctx.staff, args, writer),
});

export const approve = staffMutation({
  capability: 'approve',
  args: { requestId: v.id('staffApprovalRequests') },
  returns: v.union(applied, v.object({
    status: v.union(v.literal('cancelled'), v.literal('rejected'), v.literal('expired'), v.literal('stale')),
  })),
  handler: (ctx, { requestId }) => executeApprovedAdjustment(ctx, ctx.staff, requestId, writer),
});
