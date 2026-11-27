import { v } from 'convex/values';

export const stockGrantRoles = v.object({
  requester: v.boolean(),
  approver: v.boolean(),
  buyer: v.boolean(),
  receiver: v.boolean(),
  lead: v.boolean(),
});

export const stockOperationInputKind = v.union(v.literal('opening'), v.literal('adjust'), v.literal('count'));
export const stockOperationKind = v.union(stockOperationInputKind, v.literal('correction'));
export const stockOperationLine = {
  variantId: v.id('productVariants'),
  quantity: v.number(),
};
export const stockOperationPreviewLine = {
  ...stockOperationLine,
  before: v.number(),
  after: v.number(),
  delta: v.number(),
  revision: v.number(),
  needsRecount: v.boolean(),
};
export const stockReportedStatus = v.union(v.literal('open'), v.literal('resolved'));
