import { v } from 'convex/values';
import { staffMutation, staffQuery } from '../../auth/model';
import { tenderMethod } from '../../shared/financeValidators';
import {
  armReturn, askReturnApproval, authorizeReturn, cancelReturn, claimReturn, decideReturnApproval, readReturn, readReturnLots,
  previewReturn, recordReturnPayout, releaseReturn, retryReturn,
} from '../private/returnModel';
import { returnLotOption, returnPart } from '../validators';

const selection = {
  orderId: v.id('orders'), expectedRevision: v.number(), expectedCorrectionRevision: v.number(),
  clientKey: v.string(), tillId: v.string(), reason: v.string(), parts: v.array(returnPart),
  mistakenSale: v.optional(v.boolean()),
};
const control = { returnId: v.id('orderReturns'), tillId: v.string(), operatorRevision: v.number() };
const destination = { ...control, destinationKey: v.string() };

export const lots = staffQuery({
  capability: 'checkout',
  args: {
    orderId: v.id('orders'),
    parts: v.array(v.object({ lineId: v.id('orderLines'), contentKey: v.optional(v.string()) })),
  },
  returns: v.array(v.object({
    lineId: v.id('orderLines'), contentKey: v.optional(v.string()), tracked: v.boolean(),
    lots: v.array(returnLotOption), unavailable: v.optional(v.literal(true)),
  })),
  handler: (ctx, { orderId, parts }) => readReturnLots(ctx, ctx.staff, orderId, parts),
});

export const preview = staffQuery({
  capability: 'checkout', args: selection,
  handler: (ctx, args) => previewReturn(ctx, ctx.staff, args),
});

export const authorize = staffMutation({
  capability: 'checkout',
  args: { ...selection, destinations: v.optional(v.array(v.object({ method: tenderMethod, amount: v.number() }))) },
  handler: (ctx, args) => authorizeReturn(ctx, ctx.staff, args),
});

export const askManager = staffMutation({
  capability: 'checkout', args: selection,
  handler: (ctx, args) => askReturnApproval(ctx, ctx.staff, args),
});

export const decideApproval = staffMutation({
  capability: 'checkout',
  args: { requestId: v.id('staffApprovalRequests'), decision: v.union(v.literal('approve'), v.literal('reject'), v.literal('cancel')) },
  handler: (ctx, args) => decideReturnApproval(ctx, ctx.staff, args.requestId, args.decision),
});

export const get = staffQuery({
  capability: 'checkout',
  args: { orderId: v.optional(v.id('orders')), returnId: v.optional(v.id('orderReturns')), tillId: v.optional(v.string()), completed: v.optional(v.boolean()) },
  handler: (ctx, args) => readReturn(ctx, ctx.staff, args),
});

export const claim = staffMutation({
  capability: 'checkout',
  args: { ...control, previousOperatorStopped: v.optional(v.boolean()), reason: v.optional(v.string()) },
  handler: (ctx, args) => claimReturn(ctx, ctx.staff, args),
});

export const arm = staffMutation({
  capability: 'checkout', args: destination,
  handler: (ctx, args) => armReturn(ctx, ctx.staff, args),
});

export const recordPayout = staffMutation({
  capability: 'checkout',
  args: {
    ...destination, outcome: v.union(v.literal('given'), v.literal('failed'), v.literal('unknown')),
    reference: v.optional(v.string()), givenAt: v.optional(v.number()),
  },
  handler: (ctx, args) => recordReturnPayout(ctx, ctx.staff, args),
});

export const retry = staffMutation({
  capability: 'checkout',
  args: { ...destination, method: v.optional(tenderMethod), reason: v.string() },
  handler: (ctx, args) => retryReturn(ctx, ctx.staff, args),
});

export const cancel = staffMutation({
  capability: 'checkout', args: control,
  handler: (ctx, args) => cancelReturn(ctx, ctx.staff, args),
});

export const release = staffMutation({
  capability: 'checkout', args: control,
  handler: (ctx, args) => releaseReturn(ctx, ctx.staff, args),
});
