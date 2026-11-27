/** Shared supplier master. Buyers at any branch edit it; issued orders and receipts keep their own snapshots. */
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { actorOf, expectRevision, fail, purchasingAccess, recordEvent, runOnce, text } from './purchasingCore';

export type SupplierInput = { name: string; contactName?: string; phone?: string; email?: string; note?: string };

export const supplierNameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function clean(input: SupplierInput) {
  const name = text(input.name, 'Supplier name', 'name', true)!;
  return {
    name, nameKey: supplierNameKey(name),
    contactName: text(input.contactName, 'Contact name', 'contact'),
    phone: text(input.phone, 'Phone', 'contact'),
    email: text(input.email, 'Email', 'contact'),
    note: text(input.note, 'Note', 'note'),
  };
}

async function assertUniqueName(ctx: MutationCtx, nameKey: string, except?: Id<'suppliers'>) {
  const existing = await ctx.db.query('suppliers').withIndex('by_nameKey', q => q.eq('nameKey', nameKey)).first();
  if (existing && existing._id !== except) fail('SUPPLIER_EXISTS', 'A supplier with this name already exists.', { supplierId: existing._id });
}

const FIELDS = ['name', 'contactName', 'phone', 'email', 'note', 'status'] as const;

function changes(before: Doc<'suppliers'>, after: Partial<Doc<'suppliers'>>) {
  return FIELDS.filter(field => field in after && before[field] !== after[field])
    .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

/** `branchId` names the branch whose buyer grant authorizes the shared-master edit. */
export async function createSupplier(ctx: MutationCtx, staff: StaffActor, args: SupplierInput & { branchId: Id<'branches'>; operationKey: string }) {
  await purchasingAccess(ctx, staff, args.branchId, 'buyer');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'supplier.create', operationKey, payload, async () => {
    const fields = clean(args);
    await assertUniqueName(ctx, fields.nameKey);
    const now = Date.now();
    reserveWrites(ctx, 1);
    const id = await ctx.db.insert('suppliers', { ...fields, status: 'active', revision: 1, createdAt: now, updatedAt: now });
    await recordEvent(ctx, actor, { entity: 'supplier', entityId: id, action: 'created' });
    return { id, revision: 1 };
  });
}

export async function updateSupplier(ctx: MutationCtx, staff: StaffActor, args: SupplierInput & {
  branchId: Id<'branches'>; supplierId: Id<'suppliers'>; expectedRevision: number; status?: 'active' | 'inactive'; operationKey: string;
}) {
  await purchasingAccess(ctx, staff, args.branchId, 'buyer');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'supplier.update', operationKey, payload, async () => {
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier) fail('SUPPLIER_NOT_FOUND', 'This supplier no longer exists.');
    expectRevision(supplier.revision, args.expectedRevision, 'supplier');
    const fields = { ...clean(args), status: args.status ?? supplier.status };
    if (fields.nameKey !== supplier.nameKey) await assertUniqueName(ctx, fields.nameKey, supplier._id);
    const revision = supplier.revision + 1;
    reserveWrites(ctx, 1);
    await ctx.db.patch(supplier._id, { ...fields, revision, updatedAt: Date.now() });
    const diff = changes(supplier, fields);
    await recordEvent(ctx, actor, {
      entity: 'supplier', entityId: supplier._id, changes: diff,
      action: fields.status !== supplier.status ? (fields.status === 'active' ? 'reactivated' : 'deactivated') : 'edited',
    });
    return { id: supplier._id, revision };
  });
}
