import { normalizeGuestPhone } from '../../shared/phone';
import { readSupplierActivity, supplierOrderActivityReady } from './supplierActivity';
/** Shared supplier master. Organization owners steward changes to supplier availability; issued orders and receipts keep their own snapshots. */
import type { Doc, Id } from '../../_generated/dataModel';
import type { Infer } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { stockRead } from './stockLedger';
import { reserveWrites } from '../../lib/readBudget';
import { actorOf, expectRevision, fail, purchasingAccess, reason, recordEvent, runOnce, text } from './purchasingCore';

import type { supplierTerms } from '../purchasingTables';

type SupplierTerms = { [K in keyof typeof supplierTerms]?: Infer<(typeof supplierTerms)[K]> };
export type SupplierInput = SupplierTerms & { name: string; contactName?: string; phone?: string; email?: string; note?: string };

export const supplierNameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function clean(input: SupplierInput) {
  const name = text(input.name, 'Supplier name', 'name', true)!;
  if (input.leadTimeDays !== undefined && (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 3650)) {
    fail('INVALID_LEAD_TIME', 'Lead time must be a whole number from 0 to 3650 days.');
  }
  return {
    address: text(input.address, 'Address', 'note'),
    taxId: text(input.taxId, 'Tax ID', 'contact'),
    paymentTerms: text(input.paymentTerms, 'Payment terms', 'note'),
    deliveryDays: text(input.deliveryDays, 'Delivery days', 'contact'),
    minimumOrder: text(input.minimumOrder, 'Minimum order', 'contact'),
    leadTimeDays: input.leadTimeDays,
    name, nameKey: supplierNameKey(name),
    ...supplierContactKeys(input),
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

const FIELDS = ['name', 'contactName', 'phone', 'email', 'note', 'status', 'address', 'taxId', 'paymentTerms', 'deliveryDays', 'minimumOrder', 'leadTimeDays'] as const;

function changes(before: Doc<'suppliers'>, after: Partial<Doc<'suppliers'>>) {
  return FIELDS.filter(field => field in after && before[field] !== after[field])
    .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

/** `branchId` names the branch whose buyer grant authorizes the shared-master edit. */
export async function createSupplier(ctx: MutationCtx, staff: StaffActor, args: SupplierInput & { branchId: Id<'branches'>; operationKey: string; confirmSimilar?: boolean }) {
  await purchasingAccess(ctx, staff, args.branchId, 'buyer');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'supplier.create', operationKey, payload, async () => {
    const fields = clean(args);
    await assertUniqueName(ctx, fields.nameKey);
    if (!args.confirmSimilar && (await similarSuppliers(ctx, fields)).length) {
      fail('SIMILAR_SUPPLIER', 'Review similar suppliers and confirm before creating another.');
    }
    const now = Date.now();
    reserveWrites(ctx, 1);
    const id = await ctx.db.insert('suppliers', { ...fields, status: 'active', revision: 1, createdAt: now, updatedAt: now });
    await recordEvent(ctx, actor, { entity: 'supplier', entityId: id, action: 'created' });
    return { id, revision: 1 };
  });
}

export async function updateSupplier(ctx: MutationCtx, staff: StaffActor, args: SupplierInput & {
  branchId: Id<'branches'>; supplierId: Id<'suppliers'>; expectedRevision: number; status?: 'active' | 'inactive'; statusReason?: string; requestDeactivation?: boolean; replaceTerms?: boolean; operationKey: string;
}) {
  await purchasingAccess(ctx, staff, args.branchId, 'buyer');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'supplier.update', operationKey, payload, async () => {
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier) fail('SUPPLIER_NOT_FOUND', 'This supplier no longer exists.');
    expectRevision(supplier.revision, args.expectedRevision, 'supplier');
    if (args.requestDeactivation) {
      if (supplier.status !== 'active') fail('SUPPLIER_INACTIVE', 'This supplier is already inactive.');
      await recordEvent(ctx, actor, {
        entity: 'supplier', entityId: supplier._id, action: 'deactivation_requested', branchId: args.branchId,
        reason: reason(args.statusReason),
      });
      return { id: supplier._id, revision: supplier.revision };
    }
    const fields = {
      ...clean({
        ...args,
        address: args.replaceTerms ? args.address : args.address ?? supplier.address,
        taxId: args.replaceTerms ? args.taxId : args.taxId ?? supplier.taxId,
        paymentTerms: args.replaceTerms ? args.paymentTerms : args.paymentTerms ?? supplier.paymentTerms,
        leadTimeDays: args.replaceTerms ? args.leadTimeDays : args.leadTimeDays ?? supplier.leadTimeDays,
        deliveryDays: args.replaceTerms ? args.deliveryDays : args.deliveryDays ?? supplier.deliveryDays,
        minimumOrder: args.replaceTerms ? args.minimumOrder : args.minimumOrder ?? supplier.minimumOrder,
      }),
      status: args.status ?? supplier.status,
    };
    const statusChanged = fields.status !== supplier.status;
    if (statusChanged && staff.role !== 'owner') fail('STOCK_FORBIDDEN', 'Only an organization owner can change supplier status.');
    const statusReason = statusChanged ? reason(args.statusReason) : undefined;
    if (statusChanged && !(await supplierOrderActivityReady(ctx))) {
      fail('SUPPLIER_IMPACT_UPDATING', 'Open order totals are updating. Review the totals once they are ready.');
    }
    if (fields.nameKey !== supplier.nameKey) await assertUniqueName(ctx, fields.nameKey, supplier._id);
    const revision = supplier.revision + 1;
    reserveWrites(ctx, 1);
    await ctx.db.patch(supplier._id, { ...fields, revision, updatedAt: Date.now() });
    const diff = changes(supplier, fields);
    await recordEvent(ctx, actor, {
      entity: 'supplier', entityId: supplier._id, changes: diff, reason: statusReason,
      action: fields.status !== supplier.status ? (fields.status === 'active' ? 'reactivated' : 'deactivated') : 'edited',
    });
    return { id: supplier._id, revision };
  });
}

/** Keep display values intact. Recognizable numbers use E.164, short/local extensions use compact digits. */
export function supplierContactKeys(args: Pick<SupplierInput, 'email' | 'phone'>) {
  const phone = args.phone?.normalize('NFKC').trim() ?? '';
  const compact = phone.replace(/[\s().-]/g, '');
  return {
    contactKeysApplied: true,
    emailKey: args.email?.normalize('NFKC').trim().toLowerCase() || undefined,
    phoneKey: normalizeGuestPhone(phone) ?? (/^\+?\d+$/.test(compact) ? compact : undefined),
  };
}

export async function similarSuppliers(ctx: QueryCtx, args: Pick<SupplierInput, 'name' | 'email' | 'phone'>) {
  // Name matches use normalized text search tokens and prefixes, without arbitrary edit-distance matching.
  const name = supplierNameKey(args.name.normalize('NFKC')).slice(0, 120);
  const email = args.email?.trim();
  const phone = args.phone?.trim();
  const { emailKey, phoneKey } = supplierContactKeys({ email, phone });
  const groups = await Promise.all([
    name.length >= 2 ? stockRead(ctx, () => ctx.db.query('suppliers').withSearchIndex('search_name', q => q.search('name', name)).take(8)) : [],
    emailKey ? stockRead(ctx, () => ctx.db.query('suppliers').withIndex('by_email_key', q => q.eq('emailKey', emailKey)).take(5)) : [],
    phoneKey ? stockRead(ctx, () => ctx.db.query('suppliers').withIndex('by_phone_key', q => q.eq('phoneKey', phoneKey)).take(5)) : [],
    email ? stockRead(ctx, () => ctx.db.query('suppliers').withIndex('by_email', q => q.eq('email', email)).take(5)) : [],
    phone ? stockRead(ctx, () => ctx.db.query('suppliers').withIndex('by_phone', q => q.eq('phone', phone)).take(5)) : [],
  ]);
  return [...new Map(groups.flat().map(supplier => [supplier._id, supplier])).values()];
}

export async function supplierStatusImpact(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>, supplierId: Id<'suppliers'>) {
  await purchasingAccess(ctx, staff, branchId, 'buyer');
  const organizationWide = staff.role === 'owner';
  const scope = organizationWide ? undefined : branchId;
  const ready = await supplierOrderActivityReady(ctx, scope);
  const activity = ready ? await readSupplierActivity(ctx, supplierId, scope) : null;
  return { organizationWide, openOrders: ready ? activity?.openOrders ?? 0 : undefined };
}
