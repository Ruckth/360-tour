import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { reserveWrites } from '../../lib/readBudget';
import { resortTodayIso } from '../../shared/time';
import { stockRead } from './stockLedger';

type Activity = Doc<'supplierActivity'>;
type Metrics = Pick<Activity, 'openOrders' | 'datedDeliveries' | 'onTimeDeliveries' | 'rejectedUnits' | 'lastDeliveryAt'>;

export function readSupplierActivity(ctx: QueryCtx, supplierId: Id<'suppliers'>, branchId?: Id<'branches'>) {
  return stockRead(ctx, () => ctx.db.query('supplierActivity').withIndex('by_supplier_branch', q =>
    q.eq('supplierId', supplierId).eq('branchId', branchId)).unique());
}

async function apply(ctx: MutationCtx, supplierId: Id<'suppliers'>, branchId: Id<'branches'> | undefined, delta: Partial<Metrics>) {
  const prior = await readSupplierActivity(ctx, supplierId, branchId);
  const metrics: Metrics = {
    openOrders: (prior?.openOrders ?? 0) + (delta.openOrders ?? 0),
    datedDeliveries: (prior?.datedDeliveries ?? 0) + (delta.datedDeliveries ?? 0),
    onTimeDeliveries: (prior?.onTimeDeliveries ?? 0) + (delta.onTimeDeliveries ?? 0),
    rejectedUnits: (prior?.rejectedUnits ?? 0) + (delta.rejectedUnits ?? 0),
    lastDeliveryAt: Math.max(prior?.lastDeliveryAt ?? 0, delta.lastDeliveryAt ?? 0) || undefined,
  };
  reserveWrites(ctx, 1);
  if (prior) await ctx.db.patch(prior._id, metrics);
  else await ctx.db.insert('supplierActivity', { supplierId, branchId, ...metrics });
}

export async function projectSupplierOrder(ctx: MutationCtx, order: Doc<'purchaseOrders'>, phase: Doc<'purchaseOrders'>['phase']) {
  const openOrders = Number(phase === 'open') - Number(order.supplierActivityApplied === true && order.phase === 'open');
  if (openOrders) {
    await apply(ctx, order.supplierId, order.branchId, { openOrders });
    await apply(ctx, order.supplierId, undefined, { openOrders });
  }
  return { supplierActivityApplied: true };
}

type Delivery = Pick<Doc<'supplierReceipts'>, 'supplierId' | 'branchId' | 'createdAt' | 'rejectedUnits' | 'undercountOf'>;

export async function projectSupplierDelivery(ctx: MutationCtx, receipt: Delivery, issuedExpectedDate?: string) {
  if (!receipt.supplierId) return;
  // A supplement accounts for the original delivery and does not constitute a second arrival.
  const dated = !receipt.undercountOf && issuedExpectedDate !== undefined;
  await apply(ctx, receipt.supplierId, receipt.branchId, {
    lastDeliveryAt: receipt.undercountOf ? undefined : receipt.createdAt,
    rejectedUnits: receipt.rejectedUnits,
    datedDeliveries: Number(dated),
    onTimeDeliveries: Number(dated && resortTodayIso(receipt.createdAt) <= issuedExpectedDate),
  });
}

export async function supplierOrderActivityReady(ctx: QueryCtx, branchId?: Id<'branches'>) {
  const orders = ctx.db.query('purchaseOrders');
  return !(await stockRead(ctx, () => branchId
    ? orders.withIndex('by_branch_phase_activity', q => q.eq('branchId', branchId).eq('phase', 'open').eq('supplierActivityApplied', undefined)).first()
    : orders.withIndex('by_phase_activity', q => q.eq('phase', 'open').eq('supplierActivityApplied', undefined)).first()));
}

export async function supplierDeliveryActivityReady(ctx: QueryCtx, branchId: Id<'branches'>) {
  return !(await stockRead(ctx, () => ctx.db.query('supplierReceipts').withIndex('by_branch_activity', q =>
    q.eq('branchId', branchId).eq('supplierActivityApplied', undefined)).first()));
}
