/**
 * Isolated local-only Stock load/acceptance fixture.
 * Bundled ONLY into a disposable temporary backend copy by scripts/bench/stock-load.mjs.
 * Never deployed to cloud or committed into convex/.
 */
import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server';
import { resolveCommerceSettings } from '../commerce/model';
import { stockSearchFields } from '../commerce/private/stockCatalog';
import { readBudget } from '../lib/readBudget';
import * as stockEndpoints from '../commerce/stock';
import * as purchasingEndpoints from '../commerce/purchasing';
import * as retailEndpoints from '../pos/retail';

const BENCH_ISSUER = 'https://stock-bench.local';

function makeIssuer(code: string) {
  return {
    legalName: `Stock Bench Resort ${code} Co., Ltd.`,
    taxId: '0105559999999',
    branchCode: code,
    address: '123 Localhost Beach Rd, Thailand',
  };
}

function makeSku(index: number) {
  if (index === 0) return 'HOT-SKU-0001';
  if (index === 1) return 'NEW-NOBAL-0002';
  return `STK-${String(index).padStart(5, '0')}`;
}

function makeProductName(productIndex: number) {
  if (productIndex === 0) return 'Apex Hot Sunscreen';
  if (productIndex === 1) return 'New Unstocked Serum';
  return `Resort Supply Item ${String(productIndex).padStart(4, '0')}`;
}

function makeVariantLabel(index: number) {
  if (index === 0) return 'Hot 50ml';
  if (index === 1) return 'Fresh 30ml';
  return index % 2 === 0 ? 'Standard 100ml' : 'Travel 50ml';
}

export const bootstrap = internalMutation({
  args: { extraBranches: v.number() },
  handler: async (ctx, { extraBranches }) => {
    const now = Date.now();
    const branchIds: Id<'branches'>[] = [];
    const insertBranch = async (key: string, name: string, code: string) => {
      const id = await ctx.db.insert('branches', {
        key,
        name,
        slug: key,
        issuer: makeIssuer(code),
        state: 'active',
        stateChangedAt: now,
        stateChangedByEmail: 'owner@stock-bench.local',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      branchIds.push(id);
      return id;
    };

    const hotBranchId = await insertBranch('bench-hot', 'Hot Main Branch', '00001');
    const coldBranchId = await insertBranch('bench-cold', 'Cold Unrelated Branch', '00002');
    for (let i = 0; i < extraBranches; i++) {
      const n = i + 3;
      await insertBranch(`bench-extra-${n}`, `Branch ${n}`, String(n).padStart(5, '0'));
    }

    for (const branchId of [hotBranchId, coldBranchId]) {
      await ctx.db.insert('stockBranchPolicies', {
        branchId,
        directOrder: true,
        directReceipt: true,
        revision: 1,
        changedBy: `${BENCH_ISSUER}|owner`,
        changedAt: now,
      });
    }

    const defaults = resolveCommerceSettings(null);
    await ctx.db.insert('commerceSettings', {
      key: 'default',
      ...defaults,
      paymentsMode: 'attempts',
      saleSwitches: { ...defaults.saleSwitches, products: 'everyone' },
    });

    const fullRoles = { requester: true, approver: true, buyer: true, receiver: true, lead: true };
    const staffIdentities: {
      subject: string;
      email: string;
      tokenIdentifier: string;
      role: 'owner' | 'manager' | 'cashier';
      branchCount: number;
    }[] = [];

    const addStaff = async (
      subject: string,
      role: 'owner' | 'manager' | 'cashier',
      assignedBranches: Id<'branches'>[],
      grantBranches: Id<'branches'>[],
      roles = fullRoles,
    ) => {
      const email = `${subject}@stock-bench.local`;
      const tokenIdentifier = `${BENCH_ISSUER}|${subject}`;
      const staffGrantId = await ctx.db.insert('staffGrants', {
        email,
        role,
        branchIds: assignedBranches,
        tokenIdentifier,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        updatedByEmail: 'owner@stock-bench.local',
      });
      for (const branchId of grantBranches) {
        await ctx.db.insert('stockGrants', {
          branchId,
          staffGrantId,
          roles,
          revision: 1,
          changedBy: `${BENCH_ISSUER}|owner`,
          changedAt: now,
        });
      }
      staffIdentities.push({ subject, email, tokenIdentifier, role, branchCount: assignedBranches.length });
    };

    // 10 concurrent staff sessions (staff-0..staff-9); staff-8 is the multi-branch buyer assigned to ALL branches.
    for (let i = 0; i < 10; i++) {
      if (i === 8) {
        await addStaff(`staff-${i}`, 'manager', branchIds, [hotBranchId, coldBranchId], fullRoles);
      } else if (i === 9) {
        await addStaff(`staff-${i}`, 'owner', [hotBranchId, coldBranchId], [hotBranchId, coldBranchId], fullRoles);
      } else {
        await addStaff(`staff-${i}`, 'manager', [hotBranchId], [hotBranchId], fullRoles);
      }
    }
    await addStaff('staff-cold', 'manager', [coldBranchId], [coldBranchId], fullRoles);

    const supplierIds: Id<'suppliers'>[] = [];
    for (let i = 0; i < 10; i++) {
      const name = `Supplier ${String(i + 1).padStart(2, '0')} Co`;
      const id = await ctx.db.insert('suppliers', {
        name,
        nameKey: name.toLowerCase(),
        contactName: `Rep ${i + 1}`,
        phone: `08000000${String(i).padStart(2, '0')}`,
        email: `supplier${i + 1}@stock-bench.local`,
        status: 'active',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      supplierIds.push(id);
    }

    const categoryId = await ctx.db.insert('productCategories', { name: 'Bench Retail', sort: 0 });

    return {
      issuer: BENCH_ISSUER,
      hotBranchId,
      coldBranchId,
      branchIds,
      supplierIds,
      categoryId,
      staffIdentities,
    };
  },
});

export const seedCatalogBatch = internalMutation({
  args: {
    categoryId: v.id('productCategories'),
    startIndex: v.number(),
    count: v.number(),
  },
  handler: async (ctx, { categoryId, startIndex, count }) => {
    const variantIds: Id<'productVariants'>[] = [];
    for (let offset = 0; offset < count; offset += 2) {
      const idx0 = startIndex + offset;
      const hasSecond = offset + 1 < count;
      const productIndex = Math.floor(idx0 / 2);
      const productName = makeProductName(productIndex);
      const price0 = 25000 + (idx0 % 20) * 1000;
      const price1 = 25000 + ((idx0 + 1) % 20) * 1000;
      const productId = await ctx.db.insert('products', {
        categoryId,
        name: productName,
        status: 'active',
        vatProfile: 'standard',
        options: [],
        minPrice: hasSecond ? Math.min(price0, price1) : price0,
        maxPrice: hasSecond ? Math.max(price0, price1) : price0,
        variantCount: hasSecond ? 2 : 1,
        sort: productIndex,
        revision: 1,
      });
      for (const local of hasSecond ? [0, 1] : [0]) {
        const idx = idx0 + local;
        const label = makeVariantLabel(idx);
        const sku = makeSku(idx);
        const search = stockSearchFields({ name: productName, status: 'active' }, { label, sku, barcode: undefined });
        const variantId = await ctx.db.insert('productVariants', {
          productId,
          optionValueIds: [],
          label,
          sku,
          price: local === 0 ? price0 : price1,
          status: 'active',
          revision: 1,
          ...search,
        });
        variantIds.push(variantId);
      }
    }
    return variantIds;
  },
});

export const seedHistoricalMovementsBatch = internalMutation({
  args: {
    branchId: v.id('branches'),
    variantIds: v.array(v.id('productVariants')),
    hotVariantId: v.id('productVariants'),
    hotVariantCount: v.number(),
    rareKindCount: v.number(),
    totalCount: v.number(),
    batchSeed: v.number(),
    baseTimestamp: v.number(),
    actorToken: v.string(),
    actorLabel: v.string(),
    markRecountVariantIds: v.optional(v.array(v.id('productVariants'))),
  },
  handler: async (ctx, args) => {
    const {
      branchId, variantIds, hotVariantId, hotVariantCount, rareKindCount,
      totalCount, batchSeed, baseTimestamp, actorToken, actorLabel,
    } = args;

    const planned: { variantId: Id<'productVariants'>; delta: number; kind: Doc<'stockMovements'>['kind']; reasonCode?: string }[] = [];
    const windowStart = (batchSeed * 25) % variantIds.length;
    for (let i = 0; i < totalCount; i++) {
      const isHot = i < hotVariantCount;
      const variantId = isHot ? hotVariantId : variantIds[(windowStart + (i % 25)) % variantIds.length];
      let kind: Doc<'stockMovements'>['kind'] = i % 3 === 0 ? 'purchase_receipt' : i % 3 === 1 ? 'sale' : 'adjust';
      let delta = kind === 'sale' ? -1 : 3;
      let reasonCode: string | undefined = kind === 'adjust' ? 'cycle_check' : undefined;
      if (i >= hotVariantCount && i < hotVariantCount + rareKindCount) {
        kind = 'write_off';
        delta = -1;
        reasonCode = 'damaged';
      }
      planned.push({ variantId, delta, kind, reasonCode });
    }

    // Ensure every variant in this batch has its stockLevel and variant metadata loaded once.
    const uniqueVariants = [...new Set(planned.map(p => p.variantId))];
    const levelMap = new Map<Id<'productVariants'>, { doc: Doc<'stockLevels'> | null; onHand: number; productId: Id<'products'>; itemLabel: string; sku?: string }>();
    for (const variantId of uniqueVariants) {
      const [level, variant] = await Promise.all([
        ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', branchId)).unique(),
        ctx.db.get(variantId),
      ]);
      if (!variant) throw new Error(`Missing variant ${variantId}`);
      levelMap.set(variantId, {
        doc: level,
        onHand: level?.onHand ?? 0,
        productId: variant.productId,
        itemLabel: variant.productName ? `${variant.productName} · ${variant.label}` : variant.label,
        sku: variant.sku,
      });
    }

    for (let i = 0; i < planned.length; i++) {
      const item = planned[i];
      const state = levelMap.get(item.variantId)!;
      const before = state.onHand;
      // Keep running balance positive so historical ledger is realistic.
      const delta = before + item.delta < 50 ? Math.abs(item.delta) + 5 : item.delta;
      const after = before + delta;
      state.onHand = after;
      await ctx.db.insert('stockMovements', {
        branchId,
        variantId: item.variantId,
        delta,
        before,
        after,
        kind: item.kind,
        sourceKey: `bench-seed:${branchId}:${batchSeed}:${i}`,
        actor: actorToken,
        actorLabel,
        reason: item.reasonCode ? 'Seeded benchmark movement' : undefined,
        reasonCode: item.reasonCode,
        itemLabel: state.itemLabel,
        sku: state.sku,
        sourceRef: `SEED-${batchSeed}`,
        sourceId: `seed-${batchSeed}`,
        createdAt: baseTimestamp + i,
      });
    }

    const recountSet = new Set(args.markRecountVariantIds ?? []);
    // Ensure all requested recount variants are loaded into levelMap so Needs recount always has a full page.
    for (const variantId of recountSet) {
      if (levelMap.has(variantId)) continue;
      const [level, variant] = await Promise.all([
        ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', branchId)).unique(),
        ctx.db.get(variantId),
      ]);
      if (variant) {
        levelMap.set(variantId, {
          doc: level,
          onHand: level?.onHand ?? 0,
          productId: variant.productId,
          itemLabel: variant.productName ? `${variant.productName} · ${variant.label}` : variant.label,
          sku: variant.sku,
        });
      }
    }
    for (const [variantId, state] of levelMap.entries()) {
      const needsRecount = recountSet.has(variantId) ? true : state.doc?.needsRecount;
      if (state.doc) {
        await ctx.db.patch(state.doc._id, {
          onHand: state.onHand,
          revision: state.doc.revision + 1,
          ...(needsRecount !== undefined ? { needsRecount } : {}),
        });
      } else {
        await ctx.db.insert('stockLevels', {
          branchId,
          productId: state.productId,
          variantId,
          onHand: state.onHand,
          revision: 1,
          ...(needsRecount !== undefined ? { needsRecount } : {}),
        });
      }
    }
    return { inserted: planned.length, variantsTouched: levelMap.size };
  },
});

export const seedHistoricalOrdersBatch = internalMutation({
  args: {
    branchId: v.id('branches'),
    supplierId: v.id('suppliers'),
    variantIds: v.array(v.id('productVariants')),
    hotVariantId: v.id('productVariants'),
    ordersCount: v.number(),
    linesPerOrder: v.number(),
    hotVariantLinesInBatch: v.number(),
    openOrdersInBatch: v.number(),
    batchSeed: v.number(),
    baseTimestamp: v.number(),
    actorToken: v.string(),
    actorLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const {
      branchId, supplierId, variantIds, hotVariantId, ordersCount, linesPerOrder,
      hotVariantLinesInBatch, openOrdersInBatch, batchSeed, baseTimestamp, actorToken, actorLabel,
    } = args;
    const supplier = await ctx.db.get(supplierId);
    if (!supplier) throw new Error('Missing supplier');
    const supplierSnap = {
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
    };

    const incomingDelta = new Map<Id<'productVariants'>, number>();
    let hotAssigned = 0;
    let linesInserted = 0;

    for (let o = 0; o < ordersCount; o++) {
      const isOpen = o < openOrdersInBatch;
      const status = isOpen ? 'ordered' : 'received';
      const phase = isOpen ? 'open' : 'closed';
      const orderedPerLine = 10;
      const acceptedPerLine = isOpen ? 0 : 10;
      const duePerLine = orderedPerLine - acceptedPerLine;
      const orderedUnits = orderedPerLine * linesPerOrder;
      const acceptedUnits = acceptedPerLine * linesPerOrder;
      const dueUnits = duePerLine * linesPerOrder;
      const ts = baseTimestamp + o * 10;
      const reference = `PO-B${String(batchSeed).padStart(4, '0')}-${String(o).padStart(4, '0')}`;

      const orderId = await ctx.db.insert('purchaseOrders', {
        branchId,
        reference,
        status,
        phase,
        supplierId,
        supplier: supplierSnap,
        issuedRevision: 1,
        revision: isOpen ? 2 : 3,
        lineCount: linesPerOrder,
        openLineCount: isOpen ? linesPerOrder : 0,
        orderedUnits,
        acceptedUnits,
        dueUnits,
        totalCost: orderedUnits * 5000,
        createdByKey: actorToken,
        createdByLabel: actorLabel,
        issuedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      });

      const includeHot = hotAssigned < hotVariantLinesInBatch;
      if (includeHot) hotAssigned++;
      for (let l = 0; l < linesPerOrder; l++) {
        const variantId = (l === 0 && includeHot)
          ? hotVariantId
          : variantIds[(batchSeed * 97 + o * 7 + l) % variantIds.length];
        await ctx.db.insert('purchaseOrderLines', {
          orderId,
          branchId,
          variantId,
          item: {
            productName: variantId === hotVariantId ? 'Apex Hot Sunscreen' : 'Resort Supply Item',
            variantLabel: variantId === hotVariantId ? 'Hot 50ml' : 'Standard 100ml',
            sku: variantId === hotVariantId ? 'HOT-SKU-0001' : undefined,
          },
          ordered: orderedPerLine,
          cancelled: 0,
          accepted: acceptedPerLine,
          corrected: 0,
          returned: 0,
          unitCost: 5000,
          open: isOpen,
          sort: l,
        });
        linesInserted++;
        if (isOpen && duePerLine > 0) {
          incomingDelta.set(variantId, (incomingDelta.get(variantId) ?? 0) + duePerLine);
        }
      }
    }

    for (const [variantId, delta] of incomingDelta.entries()) {
      const existing = await ctx.db.query('stockIncoming')
        .withIndex('by_branch_variant', q => q.eq('branchId', branchId).eq('variantId', variantId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { quantity: existing.quantity + delta });
      } else {
        await ctx.db.insert('stockIncoming', { branchId, variantId, quantity: delta });
      }
    }
    return { ordersInserted: ordersCount, linesInserted, hotLinesInserted: hotAssigned };
  },
});

export const seedHistoricalRequestsBatch = internalMutation({
  args: {
    branchId: v.id('branches'),
    variantIds: v.array(v.id('productVariants')),
    hotVariantId: v.id('productVariants'),
    requestsCount: v.number(),
    batchSeed: v.number(),
    baseTimestamp: v.number(),
    requesterToken: v.string(),
    requesterLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const { branchId, variantIds, hotVariantId, requestsCount, batchSeed, baseTimestamp, requesterToken, requesterLabel } = args;
    for (let r = 0; r < requestsCount; r++) {
      const ts = baseTimestamp + r * 10;
      const status = r % 3 === 0 ? 'approved' : r % 3 === 1 ? 'awaiting_approval' : 'closed';
      const requestId = await ctx.db.insert('purchaseRequests', {
        branchId,
        reference: `PR-B${String(batchSeed).padStart(4, '0')}-${String(r).padStart(4, '0')}`,
        status,
        requesterKey: requesterToken,
        requesterLabel,
        lineCount: 2,
        revision: 2,
        createdAt: ts,
        updatedAt: ts,
      });
      const v0 = r % 2 === 0 ? hotVariantId : variantIds[(batchSeed * 53 + r) % variantIds.length];
      const v1 = variantIds[(batchSeed * 53 + r + 1) % variantIds.length];
      for (const [sort, variantId] of [v0, v1].entries()) {
        await ctx.db.insert('purchaseRequestLines', {
          requestId,
          branchId,
          requesterKey: requesterToken,
          variantId,
          item: {
            productName: variantId === hotVariantId ? 'Apex Hot Sunscreen' : 'Resort Supply Item',
            variantLabel: variantId === hotVariantId ? 'Hot 50ml' : 'Standard 100ml',
            sku: variantId === hotVariantId ? 'HOT-SKU-0001' : undefined,
          },
          quantity: 10,
          approvedQuantity: status === 'approved' ? 10 : 0,
          committedQuantity: 0,
          requestStatus: status,
          sort,
        });
      }
    }
    return { requestsInserted: requestsCount };
  },
});

export const seedReceivableOrders = internalMutation({
  args: {
    branchId: v.id('branches'),
    supplierId: v.id('suppliers'),
    variantIds: v.array(v.id('productVariants')),
    ordersCount: v.number(),
    qtyPerLine: v.number(),
    prefix: v.string(),
    actorToken: v.string(),
    actorLabel: v.string(),
  },
  handler: async (ctx, { branchId, supplierId, variantIds, ordersCount, qtyPerLine, prefix, actorToken, actorLabel }) => {
    const supplier = await ctx.db.get(supplierId);
    if (!supplier) throw new Error('Missing supplier');
    const supplierSnap = {
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
    };
    const variants = await Promise.all(variantIds.map(id => ctx.db.get(id)));
    const created: { orderId: Id<'purchaseOrders'>; issuedRevision: number; lines: { orderLineId: Id<'purchaseOrderLines'>; variantId: Id<'productVariants'> }[] }[] = [];
    const incomingDelta = new Map<Id<'productVariants'>, number>();
    const now = Date.now();

    for (let o = 0; o < ordersCount; o++) {
      const orderId = await ctx.db.insert('purchaseOrders', {
        branchId,
        reference: `PO-${prefix}-${String(o).padStart(4, '0')}`,
        status: 'ordered',
        phase: 'open',
        supplierId,
        supplier: supplierSnap,
        issuedRevision: 1,
        revision: 2,
        lineCount: variantIds.length,
        openLineCount: variantIds.length,
        orderedUnits: variantIds.length * qtyPerLine,
        acceptedUnits: 0,
        dueUnits: variantIds.length * qtyPerLine,
        totalCost: variantIds.length * qtyPerLine * 5000,
        createdByKey: actorToken,
        createdByLabel: actorLabel,
        issuedAt: now + o,
        createdAt: now + o,
        updatedAt: now + o,
      });
      const lines: { orderLineId: Id<'purchaseOrderLines'>; variantId: Id<'productVariants'> }[] = [];
      for (let i = 0; i < variantIds.length; i++) {
        const variant = variants[i];
        if (!variant) throw new Error('Missing variant');
        const orderLineId = await ctx.db.insert('purchaseOrderLines', {
          orderId,
          branchId,
          variantId: variant._id,
          item: {
            productName: variant.productName ?? 'Item',
            variantLabel: variant.label,
            sku: variant.sku,
          },
          ordered: qtyPerLine,
          cancelled: 0,
          accepted: 0,
          corrected: 0,
          returned: 0,
          unitCost: 5000,
          open: true,
          sort: i,
        });
        lines.push({ orderLineId, variantId: variant._id });
        incomingDelta.set(variant._id, (incomingDelta.get(variant._id) ?? 0) + qtyPerLine);
      }
      created.push({ orderId, issuedRevision: 1, lines });
    }

    for (const [variantId, delta] of incomingDelta.entries()) {
      const existing = await ctx.db.query('stockIncoming')
        .withIndex('by_branch_variant', q => q.eq('branchId', branchId).eq('variantId', variantId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { quantity: existing.quantity + delta });
      } else {
        await ctx.db.insert('stockIncoming', { branchId, variantId, quantity: delta });
      }
    }
    return created;
  },
});

/** Paged movement sum for exact stockLevel reconciliation without hitting Convex read limits. */
export const sumMovementsPage = internalQuery({
  args: {
    branchId: v.id('branches'),
    variantId: v.id('productVariants'),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { branchId, variantId, cursor }) => {
    const page = await ctx.db.query('stockMovements')
      .withIndex('by_variantId_and_branchId_and_createdAt', q => q.eq('variantId', variantId).eq('branchId', branchId))
      .paginate({ cursor, numItems: 2000 });
    let deltaSum = 0;
    for (const row of page.page) deltaSum += row.delta;
    return {
      deltaSum,
      rowCount: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const readStockLevelExact = internalQuery({
  args: { branchId: v.id('branches'), variantId: v.id('productVariants') },
  handler: async (ctx, { branchId, variantId }) => {
    const level = await ctx.db.query('stockLevels')
      .withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId).eq('branchId', branchId))
      .unique();
    return level ? { exists: true, onHand: level.onHand, revision: level.revision, needsRecount: Boolean(level.needsRecount) } : { exists: false, onHand: 0, revision: 0, needsRecount: false };
  },
});

/** Paged open PO line due sum for exact stockIncoming reconciliation. */
export const sumOpenDuePage = internalQuery({
  args: {
    branchId: v.id('branches'),
    variantId: v.id('productVariants'),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { branchId, variantId, cursor }) => {
    const page = await ctx.db.query('purchaseOrderLines')
      .withIndex('by_branchId_and_variantId_and_open', q => q.eq('branchId', branchId).eq('variantId', variantId).eq('open', true))
      .paginate({ cursor, numItems: 2000 });
    let dueSum = 0;
    for (const row of page.page) dueSum += row.ordered - row.cancelled - row.accepted;
    return {
      dueSum,
      rowCount: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const readIncomingExact = internalQuery({
  args: { branchId: v.id('branches'), variantId: v.id('productVariants') },
  handler: async (ctx, { branchId, variantId }) => {
    const row = await ctx.db.query('stockIncoming')
      .withIndex('by_branch_variant', q => q.eq('branchId', branchId).eq('variantId', variantId))
      .unique();
    return { exists: row !== null, quantity: row?.quantity ?? 0 };
  },
});

export const readOrderForCheckout = internalQuery({
  args: { orderId: v.id('orders') },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    return order ? { revision: order.revision, due: order.due } : null;
  },
});

// ---------- Exact DB operation counter proxy (documents, ranges, bytes, writes) ----------

const encoder = new TextEncoder();

function createCountingDb<T extends object>(db: T) {
  const stats = { ranges: 0, documents: 0, bytes: 0, writes: 0 };
  const countDoc = (doc: unknown) => {
    if (doc !== null && doc !== undefined) {
      stats.documents++;
      stats.bytes += encoder.encode(JSON.stringify(doc)).length;
    }
    return doc;
  };
  const wrapQuery = (queryObj: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(queryObj, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        if (prop === 'withIndex' || prop === 'withSearchIndex' || prop === 'order' || prop === 'filter') {
          return (...args: unknown[]) => wrapQuery(value.apply(target, args) as Record<string, unknown>);
        }
        if (prop === 'first' || prop === 'unique') {
          return async (...args: unknown[]) => {
            stats.ranges++;
            return countDoc(await value.apply(target, args));
          };
        }
        if (prop === 'take' || prop === 'collect') {
          return async (...args: unknown[]) => {
            stats.ranges++;
            const rows = (await value.apply(target, args)) as unknown[];
            for (const row of rows) countDoc(row);
            return rows;
          };
        }
        if (prop === 'paginate') {
          return async (...args: unknown[]) => {
            stats.ranges++;
            const result = (await value.apply(target, args)) as { page: unknown[] };
            for (const row of result.page) countDoc(row);
            return result;
          };
        }
        if (prop === Symbol.asyncIterator) {
          return function () {
            stats.ranges++;
            const iter = value.apply(target) as AsyncIterator<unknown>;
            return {
              async next() {
                const res = await iter.next();
                if (!res.done) countDoc(res.value);
                return res;
              },
            };
          };
        }
        return value.bind(target);
      },
    });

  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'get') {
        return async (...args: unknown[]) => {
          stats.ranges++;
          return countDoc(await value.apply(target, args));
        };
      }
      if (prop === 'query') {
        return (...args: unknown[]) => wrapQuery(value.apply(target, args) as Record<string, unknown>);
      }
      if (prop === 'insert' || prop === 'patch' || prop === 'replace' || prop === 'delete') {
        return async (...args: unknown[]) => {
          stats.writes++;
          return await value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });

  return { db: proxy, stats };
}

type RawHandler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

function fakeIdentity(subject: string) {
  return {
    issuer: BENCH_ISSUER,
    subject,
    tokenIdentifier: `${BENCH_ISSUER}|${subject}`,
    email: `${subject}@stock-bench.local`,
    emailVerified: true,
  };
}

export const probeQueryBudget = internalQuery({
  args: {
    subject: v.string(),
    probe: v.string(),
    branchId: v.id('branches'),
    variantId: v.optional(v.id('productVariants')),
    search: v.optional(v.string()),
    recountOnly: v.optional(v.boolean()),
    kind: v.optional(v.string()),
    openOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { db, stats } = createCountingDb(ctx.db);
    const wrappedCtx: QueryCtx = {
      ...ctx,
      db,
      auth: { ...ctx.auth, getUserIdentity: async () => fakeIdentity(args.subject) },
    };
    const paginationOpts = { numItems: 25, cursor: null };
    let result: unknown;
    switch (args.probe) {
      case 'stock.listBalances':
        result = await (stockEndpoints.listBalances as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          paginationOpts,
          search: args.search,
          recountOnly: args.recountOnly,
        });
        break;
      case 'stock.listActivity':
        result = await (stockEndpoints.listActivity as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          paginationOpts,
          variantId: args.variantId,
          kind: args.kind,
        });
        break;
      case 'purchasing.orders.open':
        result = await (purchasingEndpoints.orders as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          view: { kind: 'phase', phase: 'open' },
          paginationOpts,
        });
        break;
      case 'purchasing.orders.item':
        result = await (purchasingEndpoints.orders as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          view: { kind: 'item', variantId: args.variantId!, openOnly: Boolean(args.openOnly) },
          paginationOpts,
        });
        break;
      case 'purchasing.requests.all':
        result = await (purchasingEndpoints.requests as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          view: { kind: 'all' },
          paginationOpts,
        });
        break;
      case 'purchasing.requests.item':
        result = await (purchasingEndpoints.requests as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          view: { kind: 'item', variantId: args.variantId! },
          paginationOpts,
        });
        break;
      case 'retail.browse':
        result = await (retailEndpoints.browse as unknown as RawHandler)._handler(wrappedCtx, {
          branchId: args.branchId,
          search: args.search ?? '',
          paginationOpts: { numItems: 24, cursor: null },
        });
        break;
      default:
        throw new Error(`Unknown probe ${args.probe}`);
    }
    const pageLen = (result as { page?: unknown[] } | null)?.page?.length ?? 0;
    const budget = readBudget(wrappedCtx);
    return {
      probe: args.probe,
      pageLen,
      db: stats,
      readBudget: { documents: budget.documents, ranges: budget.ranges, bytes: budget.bytes },
    };
  },
});

export const probeReceiptBudget = internalMutation({
  args: {
    subject: v.string(),
    orderId: v.id('purchaseOrders'),
    expectedIssuedRevision: v.number(),
    operationKey: v.string(),
    lines: v.array(v.object({ orderLineId: v.id('purchaseOrderLines'), accepted: v.number() })),
  },
  handler: async (ctx, args) => {
    const { db, stats } = createCountingDb(ctx.db);
    const wrappedCtx: MutationCtx = {
      ...ctx,
      db,
      auth: { ...ctx.auth, getUserIdentity: async () => fakeIdentity(args.subject) },
    };
    const result = await (purchasingEndpoints.receivePurchaseOrder as unknown as RawHandler)._handler(wrappedCtx, {
      orderId: args.orderId,
      expectedIssuedRevision: args.expectedIssuedRevision,
      operationKey: args.operationKey,
      lines: args.lines,
    });
    const budget = readBudget(wrappedCtx);
    return {
      result,
      db: stats,
      readBudget: { documents: budget.documents, ranges: budget.ranges, bytes: budget.bytes },
    };
  },
});
