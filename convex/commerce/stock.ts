import { mergedStream, stream } from 'convex-helpers/server/stream';
import schema from '../schema';
import { createStockBin, readBinBalances, relocateStockBetweenBins } from './private/stockBins';
import { paginationOptsValidator, type PaginationResult } from 'convex/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { canReadCheckoutOrder, internalMutation, staffMutation, staffQuery, type StaffActor } from '../auth/model';
import { requireBranchAccess } from '../branches/model';
import { readBudget } from '../lib/readBudget';
import { MAX_MONEY } from '../shared/money';
import { catalogueFields, recordCatalogueEdit } from './private/adjustments';
import { listBranchStockGrants, purchasingPolicyPatch, readStockAccess, readStockGrant, readStockPolicy, requireStockAccess, type StockPermission } from './private/stockAccess';
import { getProductCategory, normalizeStockSku, refreshStockSearch, requireUniqueStockSku, stockSearchFields, stockSearchTerm } from './private/stockCatalog';
import { normalizeStockFilter, readStockLevel, stockActorLabel, stockError, stockQuantity, stockRead, stockText, writeStockMovement } from './private/stockLedger';
import { previewStockCorrection, previewStockOperation, requireBranchMovement, sameStockRevision, STOCK_LINE_LIMIT, stockOperationKey, stockPage, type StockOperationInputKind } from './private/stockOperations';
import { stockGrantRoles, stockOperationInputKind, stockOperationLine, stockReportedStatus } from './stockValidators';
import { PURCHASING_MAX_QUANTITY } from './purchasingTables';
import { lotReceipt } from './stockExpansionTables';
import { catalogueStatus, stockMovementKind, vatProfile } from './validators';

const branchIdArg = { branchId: v.id('branches') };
const operationLine = v.object(stockOperationLine);
const postOperationLine = v.object({
  ...stockOperationLine,
  expectedRevision: v.number(),
  lotReceipt: v.optional(lotReceipt),
  unitCost: v.optional(v.number()),
});
const operationArgs = {
  ...branchIdArg, kind: stockOperationInputKind, reason: v.optional(v.string()), reasonCode: v.optional(v.string()),
};
const correctionArgs = {
  ...branchIdArg, movementId: v.id('stockMovements'), quantity: v.number(),
};
const paged = { paginationOpts: paginationOptsValidator };
const requestKey = { operationKey: v.string() };
const selected = 'selectedBranch' as const;

export const access = staffQuery({
  capability: 'checkout', scope: selected,
  args: branchIdArg,
  handler: async (ctx, { branchId }) => {
    const { branch, ...access } = await readStockAccess(ctx, ctx.staff, branchId);
    let recountCount = 0;
    let openReportCount = 0;
    let lastVerifiedCountAt: number | null = null;
    if (access.read) {
      const [recountRows, lastCount, openReports] = await Promise.all([
        stockRead(ctx, () => ctx.db.query('stockLevels').withIndex('by_branchId_and_needsRecount', q =>
          q.eq('branchId', branchId).eq('needsRecount', true)).take(101)),
        stockRead(ctx, () => ctx.db.query('stockMovements').withIndex('by_branch_and_kind_and_date', q =>
          q.eq('branchId', branchId).eq('kind', 'count')).order('desc').first()),
        access.lead
          ? stockRead(ctx, () => ctx.db.query('stockProblemReports').withIndex('by_branch_status_date', q =>
            q.eq('branchId', branchId).eq('status', 'open')).take(101))
          : Promise.resolve([]),
      ]);
      recountCount = recountRows.length;
      lastVerifiedCountAt = lastCount?.createdAt ?? null;
      openReportCount = openReports.length;
    }
    return {
      ...access,
      canManageGrants: ctx.staff.capabilities.manageTeam,
      canManageProducts: access.lead && ctx.staff.capabilities.operations,
      branchName: branch.name,
      actorEmail: ctx.staff.email,
      recountCount,
      openReportCount,
      lastVerifiedCountAt,
    };
  },
});

function readReorderPoint(ctx: QueryCtx | MutationCtx, branchId: Id<'branches'>, variantId: Id<'productVariants'>) {
  return stockRead(ctx, () => ctx.db.query('stockReorderPoints').withIndex('by_branchId_and_variantId', q =>
    q.eq('branchId', branchId).eq('variantId', variantId)).unique());
}

export const setReorderPoint = staffMutation({
  capability: 'checkout', scope: selected,
  args: {
    ...branchIdArg, variantId: v.id('productVariants'),
    quantity: v.union(v.number(), v.null()), expectedRevision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { branchId, variantId, quantity, expectedRevision }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'lead');
    if (quantity !== null) stockQuantity(quantity, 'Reorder point', 0, PURCHASING_MAX_QUANTITY);
    const variant = await ctx.db.get(variantId);
    const product = variant && await ctx.db.get(variant.productId);
    if (variant?.status !== 'active' || product?.status !== 'active') {
      stockError('ITEM_NOT_AVAILABLE', 'Choose an active stock item.');
    }
    const current = await readReorderPoint(ctx, branchId, variantId);
    if ((current?.quantity ?? null) === quantity) return null;
    const revision = current?.revision ?? 0;
    if (revision !== expectedRevision) stockError('STALE_REORDER_POINT', 'The reorder point changed. Review the latest value and try again.');
    const patch = { quantity: quantity ?? undefined, revision: revision + 1, changedAt: Date.now(), changedBy: ctx.staff.email };
    if (current) await ctx.db.patch(current._id, patch);
    else await ctx.db.insert('stockReorderPoints', { branchId, variantId, ...patch });
    return null;
  },
});

async function stockBalanceRow(ctx: QueryCtx, branchId: Id<'branches'>, variant: Doc<'productVariants'>,
  { balance: loaded, includeReorderPoint }: { balance?: Doc<'stockLevels'>; includeReorderPoint?: boolean } = {},
) {
  const [balance, incoming, product, reorderPoint] = await Promise.all([
    loaded ?? readStockLevel(ctx, branchId, variant._id),
    stockRead(ctx, () => ctx.db.query('stockIncoming').withIndex('by_branch_variant', q =>
      q.eq('branchId', branchId).eq('variantId', variant._id)).unique()),
    variant.productName ? null : stockRead(ctx, () => ctx.db.get(variant.productId)),
    includeReorderPoint ? readReorderPoint(ctx, branchId, variant._id) : null,
  ]);
  const productStatus = variant.productStatus ?? product?.status ?? 'archived';
  return {
    variantId: variant._id, productId: variant.productId,
    productName: variant.productName ?? product?.name ?? variant.label, label: variant.label, sku: variant.sku,
    status: productStatus === 'active' ? variant.status : productStatus,
    price: variant.price, onHand: balance?.onHand ?? 0, onOrder: incoming?.quantity ?? 0,
    revision: balance?.revision ?? 0, needsRecount: balance?.needsRecount ?? false, hasBalance: balance !== null,
    lotTracked: variant.lotTracked === true,
    ...(reorderPoint ? {
      reorderPointRevision: reorderPoint.revision,
      ...(reorderPoint.quantity === undefined ? {} : { reorderPoint: reorderPoint.quantity }),
    } : {}),
  };
}

function countPage<T>(ctx: QueryCtx, result: PaginationResult<T>) {
  const budget = readBudget(ctx);
  budget.range();
  for (const row of result.page) budget.document(row);
  budget.assert();
  return result;
}

export const listBalances = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...paged, search: v.optional(v.string()), recountOnly: v.optional(v.boolean()), includeReorderPoint: v.optional(v.boolean()) },
  handler: async (ctx, { branchId, search, recountOnly, includeReorderPoint, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const options = stockPage(paginationOpts);
    const term = stockSearchTerm(search);
    if (term && recountOnly) stockError('STOCK_FILTER_CONFLICT', 'Choose item search or Needs recount.');
    if (recountOnly) {
      const result = countPage(ctx, await ctx.db.query('stockLevels').withIndex('by_branchId_and_needsRecount', q =>
        q.eq('branchId', branchId).eq('needsRecount', true)).paginate(options));
      const page = await Promise.all(result.page.map(async balance => {
        const variant = await stockRead(ctx, () => ctx.db.get(balance.variantId));
        return variant ? await stockBalanceRow(ctx, branchId, variant, { balance, includeReorderPoint }) : null;
      }));
      return { ...result, page: page.filter(row => row !== null) };
    }
    const result = countPage(ctx, term
      ? await ctx.db.query('productVariants').withSearchIndex('search_stock', q =>
        q.search('searchText', term).eq('status', 'active').eq('productStatus', 'active')).paginate(options)
      : await ctx.db.query('productVariants').withIndex('by_active_product', q =>
        // Legacy variants sort before the active prefix until search fields are backfilled.
        q.eq('status', 'active').lte('productStatus', 'active')).paginate(options));
    const page = await Promise.all(result.page.map(variant => stockBalanceRow(ctx, branchId, variant, { includeReorderPoint })));
    return { ...result, page: page.filter(row => row.status === 'active') };
  },
});

/** Resolve items already selected in a form or deep link without paging the catalog. */
export const selectedBalances = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, variantIds: v.array(v.string()), includeRecount: v.optional(v.boolean()), includeReorderPoint: v.optional(v.boolean()) },
  handler: async (ctx, { branchId, variantIds, includeRecount, includeReorderPoint }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    if (variantIds.length > STOCK_LINE_LIMIT) stockError('INVALID_STOCK_LINES', 'Choose at most 50 different stock items.');
    const rows = await Promise.all([...new Set(variantIds)].map(async rawId => {
      const id = ctx.db.normalizeId('productVariants', rawId);
      const variant = id && await stockRead(ctx, () => ctx.db.get(id));
      return variant ? await stockBalanceRow(ctx, branchId, variant, { includeReorderPoint }) : null;
    }));
    return rows.flatMap(row => row && (row.status === 'active' || includeRecount && row.needsRecount) ? [row] : []);
  },
});

const activityFacet = {
  variantId: v.optional(v.id('productVariants')), kind: v.optional(stockMovementKind),
  actor: v.optional(v.string()), reasonCode: v.optional(v.string()),
};
const activityDates = { from: v.optional(v.number()), to: v.optional(v.number()) };

async function activityRow(ctx: QueryCtx, movement: Doc<'stockMovements'>) {
  const variant = movement.itemLabel ? null : await stockRead(ctx, () => ctx.db.get(movement.variantId));
  const name = variant?.productName ?? (variant ? (await stockRead(ctx, () => ctx.db.get(variant.productId)))?.name : undefined);
  return { ...movement, fingerprint: undefined, actor: undefined, actorSearch: undefined,
    itemLabel: movement.itemLabel ?? (variant && name ? `${name} · ${variant.label}` : variant?.label) ?? 'Stock item',
    sku: movement.sku ?? variant?.sku, actorLabel: stockActorLabel(movement.actor, movement.actorLabel) ?? 'Staff member' };
}

export const listActivity = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...activityFacet, ...activityDates, ...paged },
  handler: async (ctx, { branchId, variantId, kind, actor, reasonCode, from, to, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const actorFilter = normalizeStockFilter(actor, 400, 'Staff member');
    const reasonFilter = normalizeStockFilter(reasonCode, 60, 'Reason code');
    const lower = stockQuantity(from ?? 0, 'Start time');
    const upper = stockQuantity(to ?? Number.MAX_SAFE_INTEGER, 'End time', lower);
    const query = ctx.db.query('stockMovements');
    const range = variantId ? query.withIndex('by_variantId_and_branchId_and_createdAt', q =>
      q.eq('variantId', variantId).eq('branchId', branchId).gte('createdAt', lower).lte('createdAt', upper))
      : kind ? query.withIndex('by_branch_and_kind_and_date', q =>
        q.eq('branchId', branchId).eq('kind', kind).gte('createdAt', lower).lte('createdAt', upper))
      : query.withIndex('by_branch_and_date', q => q.eq('branchId', branchId).gte('createdAt', lower).lte('createdAt', upper));
    // The indexed range includes historical rows whose search keys were never populated.
    const result = countPage(ctx, await range.order('desc').paginate(stockPage(paginationOpts)));
    const matching = result.page.filter(row =>
      (!kind || row.kind === kind) &&
      (!actorFilter || normalizeStockFilter(stockActorLabel(row.actor, row.actorLabel), 400, 'Staff member') === actorFilter) &&
      (!reasonFilter || row.reasonCode?.normalize('NFKC').toLowerCase().trim() === reasonFilter));
    return { ...result, page: await Promise.all(matching.map(row => activityRow(ctx, row))) };
  },
});

export const getMovement = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, movementId: v.id('stockMovements') },
  handler: async (ctx, { branchId, movementId }) => {
    const access = await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const movement = await requireBranchMovement(ctx, branchId, movementId);
    const [item, reports, correction] = await Promise.all([
      activityRow(ctx, movement),
      stockRead(ctx, () => ctx.db.query('stockProblemReports').withIndex('by_movement_actor', q =>
        q.eq('movementId', movementId).eq('actor', ctx.staff.tokenIdentifier)).order('desc').take(5)),
      stockRead(ctx, () => ctx.db.query('stockCorrections').withIndex('by_original', q => q.eq('originalMovementId', movementId)).unique()),
    ]);
    const raw = movement.sourceId ?? movement.sourceKey.split(':')[1];
    const orderId = raw && ctx.db.normalizeId('orders', raw);
    const returnId = raw && movement.sourceKey.startsWith('return:') ? ctx.db.normalizeId('orderReturns', raw) : null;
    const returned = returnId ? await stockRead(ctx, () => ctx.db.get(returnId)) : null;
    const sourceOrderId = orderId || returned?.orderId;
    const order = sourceOrderId ? await stockRead(ctx, () => ctx.db.get(sourceOrderId)) : null;
    const correctable = ['opening', 'adjust', 'write_off', 'return'].includes(movement.kind) && movement.delta !== 0;
    return {
      ...item, canCorrect: access.lead && correctable && Math.abs(movement.delta) > (correction?.reversed ?? 0),
      reversibleQuantity: correctable ? Math.max(0, Math.abs(movement.delta) - (correction?.reversed ?? 0)) : 0,
      operationId: raw ? ctx.db.normalizeId('stockOperations', raw) ?? undefined : undefined,
      receiptId: raw ? ctx.db.normalizeId('supplierReceipts', raw) ?? undefined : undefined,
      orderId: order && (order.stockBranchId === branchId || order.stockBranchId === undefined) && canReadCheckoutOrder(ctx.staff, order) ? order._id : undefined,
      reports: reports.map(({ _id, status, resolution }) => ({ _id, status, resolution })),
    };
  },
});

export const getOperation = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, operationId: v.id('stockOperations') },
  handler: async (ctx, { branchId, operationId }) => {
    const access = await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const operation = await stockRead(ctx, () => ctx.db.get(operationId));
    if (!operation || operation.branchId !== branchId) stockError('STOCK_OPERATION_NOT_FOUND', 'This operation was not found in the selected branch.');
    const canReadCost = access.buyer || access.lead;
    return {
      ...operation,
      actor: undefined,
      lines: canReadCost ? operation.lines : operation.lines.map(line => ({ ...line, unitCost: undefined })),
    };
  },
});

export const sourceActivity = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, sourceId: v.string(), ...paged },
  handler: async (ctx, { branchId, sourceId, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    stockText(sourceId, 'Source', 200, true);
    const result = countPage(ctx, await ctx.db.query('stockMovements').withIndex('by_branch_and_source', q =>
      q.eq('branchId', branchId).eq('sourceId', sourceId)).order('desc').paginate(stockPage(paginationOpts)));
    return { ...result, page: await Promise.all(result.page.map(row => activityRow(ctx, row))) };
  },
});

export const correctionHistory = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, movementId: v.id('stockMovements'), ...paged },
  handler: async (ctx, { branchId, movementId, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    await requireBranchMovement(ctx, branchId, movementId);
    const result = countPage(ctx, await ctx.db.query('stockMovements').withIndex('by_originalMovementId', q =>
      q.eq('originalMovementId', movementId)).order('desc').paginate(stockPage(paginationOpts)));
    const page = result.page.filter(row => row.branchId === branchId);
    return { ...result, page: await Promise.all(page.map(row => activityRow(ctx, row))) };
  },
});

function operationPermission(kind: StockOperationInputKind): StockPermission {
  return kind === 'adjust' ? 'lead' : 'receiver';
}

export const previewOperation = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...operationArgs, lines: v.array(operationLine) },
  handler: async (ctx, { branchId, kind, lines, reason, reasonCode }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, operationPermission(kind));
    return await previewStockOperation(ctx, branchId, kind, lines, reason, reasonCode);
  },
});

export const postOperation = staffMutation({
  capability: 'checkout', scope: selected,
  args: { ...operationArgs, ...requestKey, lines: v.array(postOperationLine) },
  handler: async (ctx, { operationKey, ...input }) => {
    const { branchId, kind } = input;
    await requireStockAccess(ctx, ctx.staff, branchId, operationPermission(kind));
    if (input.lines.length > STOCK_LINE_LIMIT) stockError('INVALID_STOCK_LINES', 'Choose at most 50 different stock items.');
    const key = await stockOperationKey(ctx, ctx.staff, branchId, kind, operationKey, input);
    if (key.previous) return ctx.db.normalizeId('stockOperations', key.previous.resultId)!;
    const preview = await previewStockOperation(ctx, branchId, kind, input.lines, input.reason, input.reasonCode);
    if (preview.requiresReason && (!preview.reason || (kind === 'adjust' && /^other\s*:?$/i.test(preview.reason.normalize('NFKC'))))) {
      stockError('STOCK_REASON_REQUIRED', 'Enter a reason for this stock change.');
    }
    for (const [index, line] of preview.lines.entries()) {
      sameStockRevision(input.lines[index].expectedRevision, line.revision);
      const unitCost = input.lines[index].unitCost;
      if (unitCost !== undefined) stockQuantity(unitCost, 'Unit cost in satang', 0, MAX_MONEY);
    }
    const header = {
      branchId, kind, createdAt: Date.now(), actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email,
      reason: preview.reason ?? (kind === 'adjust' ? preview.reasonCode : undefined), reasonCode: kind === 'opening' ? 'opening_stock' : preview.reasonCode,
    };
    const operationId = await ctx.db.insert('stockOperations', { ...header, lines: [] });
    const lines = [];
    for (const [index, line] of preview.lines.entries()) {
      const damagedStock = kind === 'adjust' && line.delta < 0 && ['damaged', 'expired', 'lost'].includes(header.reasonCode ?? '');
      const movement = await writeStockMovement(ctx, {
        ...header, variantId: line.variantId, delta: line.delta, kind: damagedStock ? 'write_off' : kind,
        sourceKey: `stock:${operationId}:${line.variantId}`,
        sourceId: operationId, sourceRef: operationId, clearRecount: kind === 'count', lotReceipt: input.lines[index].lotReceipt,
      });
      const unitCost = input.lines[index].unitCost;
      lines.push({ ...line, movementId: movement.movementId, ...(unitCost !== undefined ? { unitCost } : {}) });
    }
    await ctx.db.patch(operationId, { lines });
    await key.save('operation', operationId);
    return operationId;
  },
});

export const previewCorrection = staffQuery({
  capability: 'checkout', scope: selected,
  args: correctionArgs,
  handler: async (ctx, { branchId, movementId, quantity }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'lead');
    const { available, line, requiresReconciliation } = await previewStockCorrection(ctx, branchId, movementId, quantity);
    return { available, line, requiresReconciliation };
  },
});

async function resolveStockReport(ctx: MutationCtx, actor: StaffActor, report: Doc<'stockProblemReports'>, resolution: string, correctionId?: Id<'stockOperations'>) {
  await ctx.db.patch(report._id, { status: 'resolved', revision: report.revision + 1, resolution,
    resolvedAt: Date.now(), resolvedBy: actor.tokenIdentifier, correctionId });
}

async function readReport(ctx: QueryCtx, branchId: Id<'branches'>, reportId: Id<'stockProblemReports'>) {
  const report = await stockRead(ctx, () => ctx.db.get(reportId));
  if (!report || report.branchId !== branchId) stockError('STOCK_REPORT_NOT_FOUND', 'This report was not found in the selected branch.');
  return report;
}

export const postCorrection = staffMutation({
  capability: 'checkout', scope: selected,
  args: { ...correctionArgs, ...requestKey, expectedRevision: v.number(), reason: v.string(), reasonCode: v.optional(v.string()),
    reportId: v.optional(v.id('stockProblemReports')), physicalCount: v.optional(v.number()), confirmNegative: v.optional(v.boolean()) },
  handler: async (ctx, { operationKey, ...input }) => {
    const { branchId, movementId, quantity } = input;
    await requireStockAccess(ctx, ctx.staff, branchId, 'lead');
    const key = await stockOperationKey(ctx, ctx.staff, branchId, 'correction', operationKey, input);
    if (key.previous) return {
      operationId: key.previous.resultType === 'operation' ? ctx.db.normalizeId('stockOperations', key.previous.resultId) : null,
      reportId: key.previous.resultType === 'report' ? ctx.db.normalizeId('stockProblemReports', key.previous.resultId) : null,
    };
    const { original, line, counter, requiresReconciliation } = await previewStockCorrection(ctx, branchId, movementId, quantity);
    sameStockRevision(input.expectedRevision, line.revision);
    const reason = stockText(input.reason, 'Reason', 1000, true)!;
    const reasonCode = stockText(input.reasonCode, 'Reason code', 60) ?? 'correction';
    const existingReport = input.reportId ? await readReport(ctx, branchId, input.reportId) : null;
    if (existingReport && (existingReport.status !== 'open' || existingReport.movementId !== movementId)) {
      stockError('STOCK_REPORT_MISMATCH', 'Choose an open report for this movement.');
    }
    if (requiresReconciliation && !input.confirmNegative) {
      const reportId = existingReport?._id ?? await ctx.db.insert('stockProblemReports', {
        branchId, movementId, actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email, reason,
        createdAt: Date.now(), status: 'open', revision: 1, requestedQuantity: quantity, reviewedRevision: line.revision,
      });
      if (existingReport) await ctx.db.patch(reportId, {
        requestedQuantity: quantity, reviewedRevision: line.revision, revision: existingReport.revision + 1,
      });
      await key.save('report', reportId);
      return { operationId: null, reportId };
    }
    if (requiresReconciliation && (input.physicalCount === undefined || (existingReport?.requestedQuantity !== undefined && existingReport.requestedQuantity !== quantity))) {
      stockError('STOCK_RECONCILIATION_REQUIRED', 'Enter the physical count before confirming a negative correction.');
    }
    if (input.physicalCount !== undefined) stockQuantity(input.physicalCount, 'Physical count');
    const header = {
      branchId, kind: 'correction' as const, createdAt: Date.now(), actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email,
      reason, reasonCode, originalMovementId: movementId,
    };
    const operationId = await ctx.db.insert('stockOperations', { ...header, physicalCount: input.physicalCount, lines: [] });
    const movement = await writeStockMovement(ctx, {
      ...header, variantId: original.variantId, delta: line.delta, sourceKey: `stock:${operationId}:${original.variantId}`,
      sourceId: operationId, sourceRef: operationId, allowNegative: requiresReconciliation, markRecount: requiresReconciliation,
    });
    await ctx.db.patch(operationId, { lines: [{ ...line, movementId: movement.movementId }] });
    if (counter) await ctx.db.patch(counter._id, { reversed: counter.reversed + quantity, revision: counter.revision + 1 });
    else await ctx.db.insert('stockCorrections', { originalMovementId: movementId, reversed: quantity, revision: 1 });
    if (existingReport) {
      if (requiresReconciliation) await ctx.db.patch(existingReport._id, {
        requestedQuantity: quantity, reviewedRevision: line.revision,
      });
      await resolveStockReport(ctx, ctx.staff, existingReport, reason, operationId);
    } else if (requiresReconciliation) {
      const recordedAt = Date.now();
      await ctx.db.insert('stockProblemReports', {
        branchId, movementId, actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email, reason,
        createdAt: recordedAt, status: 'resolved', revision: 1, requestedQuantity: quantity, reviewedRevision: line.revision,
        resolution: reason, resolvedAt: recordedAt, resolvedBy: ctx.staff.tokenIdentifier, correctionId: operationId,
      });
    }
    await key.save('operation', operationId);
    return { operationId, reportId: null };
  },
});

export const reportProblem = staffMutation({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...requestKey, movementId: v.id('stockMovements'), reason: v.string() },
  handler: async (ctx, { operationKey, ...input }) => {
    const { branchId, movementId } = input;
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const key = await stockOperationKey(ctx, ctx.staff, branchId, 'report', operationKey, input);
    if (key.previous) return ctx.db.normalizeId('stockProblemReports', key.previous.resultId)!;
    await requireBranchMovement(ctx, branchId, movementId);
    const reportId = await ctx.db.insert('stockProblemReports', {
      branchId, movementId, actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email,
      reason: stockText(input.reason, 'Problem', 1000, true)!, createdAt: Date.now(), status: 'open', revision: 1,
    });
    await key.save('report', reportId);
    return reportId;
  },
});

export const listReports = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...paged, status: v.optional(stockReportedStatus) },
  handler: async (ctx, { branchId, status, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'lead');
    const result = countPage(ctx, await ctx.db.query('stockProblemReports').withIndex('by_branch_status_date', q =>
      q.eq('branchId', branchId).eq('status', status ?? 'open')).order('desc').paginate(stockPage(paginationOpts)));
    const page = await Promise.all(result.page.map(async row => {
      const movement = await stockRead(ctx, () => ctx.db.get(row.movementId));
      const item = movement?.branchId === branchId ? await activityRow(ctx, movement) : null;
      return { ...row, actor: undefined, resolvedBy: undefined,
        movement: item && { itemLabel: item.itemLabel, kind: item.kind, delta: item.delta } };
    }));
    return { ...result, page };
  },
});

export const resolveReport = staffMutation({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...requestKey, reportId: v.id('stockProblemReports'), expectedRevision: v.number(), reason: v.string() },
  handler: async (ctx, { operationKey, ...input }) => {
    await requireStockAccess(ctx, ctx.staff, input.branchId, 'lead');
    const key = await stockOperationKey(ctx, ctx.staff, input.branchId, 'resolveReport', operationKey, input);
    if (key.previous) return ctx.db.normalizeId('stockProblemReports', key.previous.resultId)!;
    const report = await readReport(ctx, input.branchId, input.reportId);
    if (report.status !== 'open' || report.revision !== input.expectedRevision) stockError('STALE_STOCK_REPORT', 'This report changed. Reload it and review again.');
    await resolveStockReport(ctx, ctx.staff, report, stockText(input.reason, 'Resolution', 1000, true)!);
    await key.save('report', report._id);
    return report._id;
  },
});

async function requireProductEditor(ctx: QueryCtx, actor: StaffActor, branchId: Id<'branches'>) {
  await requireStockAccess(ctx, actor, branchId, 'lead');
  if (!actor.capabilities.operations) stockError('STOCK_CATALOG_FORBIDDEN', 'Product editing requires operations access.');
}

export const listCategories = staffQuery({
  capability: 'checkout', scope: selected,
  args: branchIdArg,
  handler: async (ctx, { branchId }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    return await stockRead(ctx, () => ctx.db.query('productCategories').withIndex('by_parentId_and_sort').take(100));
  },
});

async function withProductCategories(ctx: QueryCtx, result: PaginationResult<Doc<'products'>>) {
  const ids = [...new Set(result.page.map(product => product.categoryId))];
  const categories = new Map(await Promise.all(ids.map(async id =>
    [id, (await stockRead(ctx, () => ctx.db.get(id)))?.name] as const)));
  return { ...result, page: result.page.map(product => ({
    ...product, ...(categories.get(product.categoryId) ? { categoryName: categories.get(product.categoryId) } : {}),
  })) };
}

export const listProducts = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...paged, search: v.optional(v.string()), status: v.optional(catalogueStatus) },
  handler: async (ctx, { branchId, search, status, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const term = stockSearchTerm(search);
    const options = stockPage(paginationOpts);
    if (term) {
      const [indexed, legacy] = await Promise.all([
        stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_normalizedSku',
          q => q.eq('normalizedSku', normalizeStockSku(term))).first()),
        stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_sku', q => q.eq('sku', term)).first()),
      ]);
      const match = indexed ?? legacy;
      const product = match && await stockRead(ctx, () => ctx.db.get(match.productId));
      if (product && (!status || product.status === status)) {
        return await withProductCategories(ctx, { page: options.cursor ? [] : [product], isDone: true, continueCursor: '' });
      }
    }
    const result = countPage(ctx, term
      ? await ctx.db.query('products').withSearchIndex('search_name', q => {
        const result = q.search('name', term);
        return status ? result.eq('status', status) : result;
      }).paginate(options)
      : await ctx.db.query('products').withIndex('by_status_and_sort', q => q.eq('status', status ?? 'active')).paginate(options));
    return await withProductCategories(ctx, result);
  },
});

export const getProduct = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, productId: v.id('products'), includeStock: v.optional(v.boolean()) },
  handler: async (ctx, { branchId, productId, includeStock }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const product = await stockRead(ctx, () => ctx.db.get(productId));
    if (!product) return null;
    const variants = await stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_productId', q =>
      q.eq('productId', productId)).take(STOCK_LINE_LIMIT + 1));
    const visible = variants.slice(0, STOCK_LINE_LIMIT);
    return {
      product, variants: visible, hasMoreVariants: variants.length > STOCK_LINE_LIMIT,
      ...(includeStock ? { balances: await Promise.all(visible.map(variant => stockBalanceRow(ctx, branchId, variant))) } : {}),
    };
  },
});

export const productArchiveImpact = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, productId: v.id('products') },
  handler: async (ctx, { branchId, productId }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    const variants = await stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_productId',
      q => q.eq('productId', productId)).take(STOCK_LINE_LIMIT + 1));
    const visible = variants.slice(0, STOCK_LINE_LIMIT);
    const rows = await Promise.all(visible.map(async variant => {
      const [balance, lines] = await Promise.all([
        stockBalanceRow(ctx, branchId, variant),
        stockRead(ctx, () => ctx.db.query('purchaseOrderLines').withIndex('by_branchId_and_variantId_and_open',
          q => q.eq('branchId', branchId).eq('variantId', variant._id).eq('open', true)).take(21)),
      ]);
      return { balance, lines };
    }));
    return {
      onHand: rows.reduce((total, row) => total + row.balance.onHand, 0),
      onOrder: rows.reduce((total, row) => total + row.balance.onOrder, 0),
      hasStock: rows.some(row => row.balance.onHand !== 0),
      openOrders: new Set(rows.flatMap(row => row.lines.map(line => line.orderId))).size,
      partialOrders: rows.some(row => row.lines.length > 20),
      partialVariants: variants.length > STOCK_LINE_LIMIT,
      variantCount: visible.length,
    };
  },
});

export const productHistory = staffQuery({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, ...paged, productId: v.id('products'), variantId: v.optional(v.id('productVariants')), allTargets: v.optional(v.boolean()) },
  handler: async (ctx, { branchId, productId, variantId, allTargets, paginationOpts }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    if (variantId && (await stockRead(ctx, () => ctx.db.get(variantId)))?.productId !== productId) {
      stockError('STOCK_VARIANT_NOT_FOUND', 'This variant does not belong to the product.');
    }
    const options = stockPage(paginationOpts);
    const variants = allTargets && !variantId ? await stockRead(ctx, () => ctx.db.query('productVariants')
      .withIndex('by_productId', q => q.eq('productId', productId)).take(STOCK_LINE_LIMIT)) : null;
    const result = countPage(ctx, variants
      ? await mergedStream([
          stream(ctx.db, schema).query('commerceAdjustments').withIndex('by_targetType_and_targetId_and_recordedAt',
            q => q.eq('targetType', 'product').eq('targetId', productId)).order('desc'),
          ...variants.map(variant => stream(ctx.db, schema).query('commerceAdjustments')
            .withIndex('by_targetType_and_targetId_and_recordedAt',
              q => q.eq('targetType', 'variant').eq('targetId', variant._id)).order('desc')),
        ], ['recordedAt']).paginate(options)
      : await ctx.db.query('commerceAdjustments').withIndex('by_targetType_and_targetId_and_recordedAt',
          q => variantId ? q.eq('targetType', 'variant').eq('targetId', variantId) : q.eq('targetType', 'product').eq('targetId', productId))
        .order('desc').paginate(options));
    const categoryIds = new Set(result.page.flatMap(row => [row.before.categoryId, row.after.categoryId])
      .flatMap(value => typeof value === 'string' ? [ctx.db.normalizeId('productCategories', value)] : []).filter(id => id !== null));
    const categoryNames = Object.fromEntries(await Promise.all([...categoryIds].map(async id =>
      [id, (await stockRead(ctx, () => ctx.db.get(id)))?.name ?? 'Unavailable category'] as const)));
    return { ...result, page: result.page.map(({ _id, actorLabel, before, after, recordedAt, revisionBefore, revisionAfter, targetType, targetId }) =>
      ({ _id, actorLabel, before, after, recordedAt, revisionBefore, revisionAfter, targetType, targetId, categoryNames })) };
  },
});

const productVariantInput = v.object({
  variantId: v.optional(v.id('productVariants')), label: v.string(), sku: v.optional(v.string()),
  price: v.number(), status: v.optional(catalogueStatus),
});

type ProductEdit = Pick<Doc<'products'>, 'categoryId' | 'name' | 'status' | 'vatProfile' | 'minPrice' | 'maxPrice' | 'variantCount'>;
type VariantEdit = Pick<Doc<'productVariants'>, 'label' | 'sku' | 'price' | 'status'>;

async function queueVariantSearchRefresh(ctx: MutationCtx, productId: Id<'products'>) {
  await ctx.scheduler.runAfter(0, internal.commerce.stock.backfillVariantSearch, {
    productId, paginationOpts: { numItems: 25, cursor: null }, continueBatches: true,
  });
}

export const saveProduct = staffMutation({
  capability: 'operations', scope: selected,
  args: {
    ...branchIdArg, productId: v.optional(v.id('products')), expectedRevision: v.optional(v.number()),
    categoryId: v.optional(v.id('productCategories')), name: v.string(), vatProfile,
    variants: v.array(productVariantInput),
  },
  handler: async (ctx, input): Promise<Id<'products'>> => {
    await requireProductEditor(ctx, ctx.staff, input.branchId);
    if (input.variants.length < 1 || input.variants.length > STOCK_LINE_LIMIT) {
      stockError('INVALID_STOCK_LINES', 'Provide 1–50 sellable variants.');
    }
    const previous = input.productId ? await stockRead(ctx, () => ctx.db.get(input.productId!)) : null;
    if (input.productId && !previous) stockError('STOCK_PRODUCT_NOT_FOUND', 'This product no longer exists.');
    if (previous && previous.revision !== input.expectedRevision) stockError('STALE_STOCK_PRODUCT', 'This product changed. Reload before saving.');
    if (previous?.status === 'archived') stockError('STOCK_PRODUCT_ARCHIVED', 'An archived product cannot be edited.');
    const oldVariants = previous ? await stockRead(ctx, () => ctx.db.query('productVariants')
      .withIndex('by_productId', q => q.eq('productId', previous._id)).take(STOCK_LINE_LIMIT + 1)) : [];
    const byId = new Map(oldVariants.map(row => [row._id, row]));
    if (previous && oldVariants.length > STOCK_LINE_LIMIT) {
      const editedVariant = input.variants.some(row => {
        const old = row.variantId ? byId.get(row.variantId) : undefined;
        return !old || normalizeStockSku(row.label) !== normalizeStockSku(old.label) ||
          normalizeStockSku(row.sku ?? '') !== normalizeStockSku(old.sku ?? '') ||
          row.price !== old.price || (row.status ?? old.status) !== old.status;
      });
      if (editedVariant) stockError('STOCK_PRODUCT_LIMIT', 'This imported product has over 50 variants. Save the product details without changing its variants.');
      const fields = {
        name: stockText(input.name, 'Product name', 150, true)!, vatProfile: input.vatProfile,
        categoryId: await getProductCategory(ctx, input.categoryId ?? previous.categoryId),
      };
      const change = await catalogueFields(previous, fields);
      if (Object.keys(change.after).length) {
        await recordCatalogueEdit(ctx, ctx.staff.email, { targetType: 'product', targetId: previous._id }, previous.revision, {
          ...change,
          apply: async ({ revisionAfter }) => {
            await ctx.db.patch(previous._id, { ...fields, revision: revisionAfter });
            if (previous.name !== fields.name) await queueVariantSearchRefresh(ctx, previous._id);
            return [];
          },
        });
      }
      return previous._id;
    }
    const seen = new Set<Id<'productVariants'>>();
    const variants = [];
    for (const inputVariant of input.variants) {
      const oldVariant = inputVariant.variantId ? byId.get(inputVariant.variantId) : undefined;
      if (inputVariant.variantId && (!oldVariant || seen.has(inputVariant.variantId))) {
        stockError('INVALID_STOCK_VARIANT', 'Select different variants from this product.');
      }
      if (oldVariant) seen.add(oldVariant._id);
      const label = stockText(inputVariant.label, 'Variant label', 100, true)!;
      const sku = stockText(inputVariant.sku, 'SKU', 80);
      const price = stockQuantity(inputVariant.price, 'Price in satang');
      const status = inputVariant.status ?? oldVariant?.status ?? 'active';
      if (sku && sku !== oldVariant?.sku) await requireUniqueStockSku(ctx, sku, oldVariant?._id);
      const fields: VariantEdit = { label, sku, price, status };
      variants.push({ fields, oldVariant });
    }
    for (const oldVariant of oldVariants) {
      if (!seen.has(oldVariant._id)) variants.push({ fields: {
        label: oldVariant.label, sku: oldVariant.sku, price: oldVariant.price, status: oldVariant.status,
      }, oldVariant });
    }
    if (variants.length > STOCK_LINE_LIMIT) stockError('STOCK_PRODUCT_LIMIT', 'Products can have at most 50 variants.');
    const skuKeys = variants.map(row => normalizeStockSku(row.fields.sku ?? '')).filter(Boolean);
    if (new Set(skuKeys).size !== skuKeys.length) stockError('DUPLICATE_STOCK_SKU', 'Use different SKUs for each variant.');
    const activeVariants = variants.filter(row => row.fields.status === 'active');
    if (new Set(activeVariants.map(row => normalizeStockSku(row.fields.label))).size !== activeVariants.length) {
      stockError('DUPLICATE_STOCK_VARIANT', 'Use different labels for active variants.');
    }
    const prices = activeVariants.map(row => row.fields.price);
    if (!prices.length) stockError('STOCK_ACTIVE_VARIANT_REQUIRED', 'Keep an active sellable variant or archive the product.');
    const fields: ProductEdit = {
      categoryId: await getProductCategory(ctx, input.categoryId ?? previous?.categoryId),
      name: stockText(input.name, 'Product name', 150, true)!, vatProfile: input.vatProfile, status: 'active',
      minPrice: Math.min(...prices), maxPrice: Math.max(...prices), variantCount: variants.length,
    };
    const productId = previous?._id ?? await ctx.db.insert('products', { ...fields, options: [], sort: 0, revision: 1 });
    const productChange = await catalogueFields(previous ?? {}, fields);
    const changes = await Promise.all(variants.map(async ({ fields: variant, oldVariant }) =>
      await catalogueFields(oldVariant ?? {}, variant)));
    if (Object.keys(productChange.after).length || changes.some(change => Object.keys(change.after).length)) {
      await recordCatalogueEdit(ctx, ctx.staff.email, { targetType: 'product', targetId: productId }, previous?.revision ?? 0, {
        ...productChange,
        apply: async ({ revisionAfter }) => {
          if (previous) await ctx.db.patch(productId, { ...fields, revision: revisionAfter });
          return [];
        },
      });
    }
    for (const [index, { fields: variant, oldVariant }] of variants.entries()) {
      const search = stockSearchFields(fields, { ...variant, barcode: oldVariant?.barcode });
      const variantId = oldVariant?._id ?? await ctx.db.insert('productVariants',
        { ...variant, ...search, productId, optionValueIds: [], revision: 1 });
      const change = changes[index];
      if (Object.keys(change.after).length) {
        await recordCatalogueEdit(ctx, ctx.staff.email, { targetType: 'variant', targetId: variantId }, oldVariant?.revision ?? 0, {
          ...change,
          apply: async ({ revisionAfter }) => {
            if (oldVariant) await ctx.db.patch(variantId, { ...variant, ...search, revision: revisionAfter });
            return [];
          },
        });
      } else if (oldVariant) {
        await refreshStockSearch(ctx, oldVariant, fields);
      }
    }
    return productId;
  },
});

async function changeProductStatus(
  ctx: MutationCtx, actor: StaffActor,
  { branchId, productId, expectedRevision }: { branchId: Id<'branches'>; productId: Id<'products'>; expectedRevision: number },
  status: 'active' | 'archived',
): Promise<Id<'products'>> {
  await requireProductEditor(ctx, actor, branchId);
  const product = await stockRead(ctx, () => ctx.db.get(productId));
  if (!product) stockError('STOCK_PRODUCT_NOT_FOUND', 'This product no longer exists.');
  if (product.revision !== expectedRevision) stockError('STALE_STOCK_PRODUCT', 'This product changed. Reload before changing its status.');
  if (product.status === status) return productId;
  if (status === 'active' && product.status !== 'archived') {
    stockError('STOCK_PRODUCT_NOT_ARCHIVED', 'Only archived products can be restored.');
  }
  const fields = { status };
  await recordCatalogueEdit(ctx, actor.email, { targetType: 'product', targetId: productId }, expectedRevision, {
    ...await catalogueFields(product, fields),
    apply: async ({ revisionAfter }) => {
      await ctx.db.patch(productId, { ...fields, revision: revisionAfter });
      const variants = await stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_productId',
        q => q.eq('productId', productId)).take(STOCK_LINE_LIMIT + 1));
      if (variants.length > STOCK_LINE_LIMIT) await queueVariantSearchRefresh(ctx, productId);
      else for (const variant of variants) await refreshStockSearch(ctx, variant, { ...product, ...fields });
      return [];
    },
  });
  return productId;
}

export const archiveProduct = staffMutation({
  capability: 'operations', scope: selected,
  args: { ...branchIdArg, productId: v.id('products'), expectedRevision: v.number() },
  handler: (ctx, args) => changeProductStatus(ctx, ctx.staff, args, 'archived'),
});

export const restoreProduct = staffMutation({
  capability: 'operations', scope: selected,
  args: { ...branchIdArg, productId: v.id('products'), expectedRevision: v.number() },
  handler: (ctx, args) => changeProductStatus(ctx, ctx.staff, args, 'active'),
});

export const backfillVariantSearch = internalMutation({
  args: { ...paged, productId: v.optional(v.id('products')), continueBatches: v.optional(v.boolean()) },
  returns: v.object({ updated: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { productId, paginationOpts, continueBatches }) => {
    const variants = ctx.db.query('productVariants');
    const options = stockPage(paginationOpts);
    const result = countPage(ctx, productId
      ? await variants.withIndex('by_productId', q => q.eq('productId', productId)).paginate(options)
      : await variants.paginate(options));
    const products = new Map<Id<'products'>, Doc<'products'> | null>();
    let updated = 0;
    for (const variant of result.page) {
      if (!products.has(variant.productId)) products.set(variant.productId, await stockRead(ctx, () => ctx.db.get(variant.productId)));
      const product = products.get(variant.productId);
      if (product && await refreshStockSearch(ctx, variant, product)) updated++;
    }
    if (continueBatches && !result.isDone) {
      await ctx.scheduler.runAfter(0, internal.commerce.stock.backfillVariantSearch, {
        productId, paginationOpts: { numItems: options.numItems, cursor: result.continueCursor }, continueBatches,
      });
    }
    return { updated, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const backfillMovementFilters = internalMutation({
  args: paged,
  handler: async (ctx, { paginationOpts }) => {
    const result = countPage(ctx, await ctx.db.query('stockMovements').paginate(stockPage(paginationOpts)));
    let updated = 0;
    for (const row of result.page) {
      const actorSearch = normalizeStockFilter(stockActorLabel(row.actor, row.actorLabel), 400, 'Staff member');
      if (row.actorSearch === actorSearch) continue;
      await ctx.db.patch(row._id, { actorSearch });
      updated++;
    }
    return { updated, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const branchPolicy = staffQuery({
  capability: 'manageTeam', scope: selected,
  args: branchIdArg,
  handler: async (ctx, { branchId }) => {
    await requireBranchAccess(ctx, ctx.staff, branchId);
    const policy = await readStockPolicy(ctx, branchId);
    return policy && {
      directOrder: policy.directOrder, directReceipt: policy.directReceipt, revision: policy.revision,
      separateReceiving: policy.separateReceiving ?? false, directOrderLimit: policy.directOrderLimit ?? null,
      overReceiptTolerancePct: policy.overReceiptTolerancePct ?? 0,
      receivingContact: policy.receivingContact ?? '', receivingPhone: policy.receivingPhone ?? '',
    };
  },
});

export const listGrants = staffQuery({
  capability: 'manageTeam', scope: selected,
  args: { ...branchIdArg, ...paged, email: v.optional(v.string()), search: v.optional(v.string()) },
  handler: async (ctx, { branchId, paginationOpts, email, search }) => {
    await requireBranchAccess(ctx, ctx.staff, branchId);
    return await listBranchStockGrants(ctx, branchId, paginationOpts, email, search);
  },
});

export const setGrant = staffMutation({
  capability: 'manageTeam', scope: selected,
  args: { ...branchIdArg, staffGrantId: v.id('staffGrants'), roles: stockGrantRoles, expectedRevision: v.number() },
  handler: async (ctx, { branchId, staffGrantId, roles, expectedRevision }) => {
    await requireBranchAccess(ctx, ctx.staff, branchId);
    const staff = await stockRead(ctx, () => ctx.db.get(staffGrantId));
    if (!staff || (staff.role !== 'owner' && !staff.branchIds.includes(branchId))) {
      stockError('BRANCH_FORBIDDEN', 'Assign this staff member to the branch before granting stock permissions.');
    }
    const current = await readStockGrant(ctx, branchId, staffGrantId);
    if ((current?.revision ?? 0) !== expectedRevision) stockError('STALE_STOCK_GRANT', 'This access grant changed. Reload and try again.');
    const values = { roles, revision: expectedRevision + 1, changedBy: ctx.staff.tokenIdentifier, changedAt: Date.now() };
    if (current) await ctx.db.patch(current._id, values);
    else await ctx.db.insert('stockGrants', { ...values, branchId, staffGrantId });
    return values.revision;
  },
});

export const setBranchPolicy = staffMutation({
  capability: 'manageTeam', scope: selected,
  args: {
    ...branchIdArg, directOrder: v.boolean(), directReceipt: v.boolean(), expectedRevision: v.number(),
    // Purchasing policies; omitted fields keep their current value.
    separateReceiving: v.optional(v.boolean()), directOrderLimit: v.optional(v.union(v.number(), v.null())),
    overReceiptTolerancePct: v.optional(v.number()),
    receivingContact: v.optional(v.string()), receivingPhone: v.optional(v.string()),
  },
  handler: async (ctx, { branchId, directOrder, directReceipt, expectedRevision, ...purchasing }) => {
    await requireBranchAccess(ctx, ctx.staff, branchId);
    const current = await readStockPolicy(ctx, branchId);
    if ((current?.revision ?? 0) !== expectedRevision) stockError('STALE_STOCK_POLICY', 'This branch policy changed. Reload and try again.');
    const values = {
      directOrder, directReceipt, ...purchasingPolicyPatch(purchasing),
      revision: expectedRevision + 1, changedBy: ctx.staff.tokenIdentifier, changedAt: Date.now(),
    };
    if (current) await ctx.db.patch(current._id, values);
    else await ctx.db.insert('stockBranchPolicies', { ...values, branchId });
    return values.revision;
  },
});

const binVariant = { ...branchIdArg, variantId: v.id('productVariants') };
const binLocation = v.union(v.id('stockBins'), v.null());

export const binBalances = staffQuery({
  capability: 'checkout', scope: selected,
  args: binVariant,
  handler: (ctx, args) => readBinBalances(ctx, ctx.staff, args),
});

export const addBin = staffMutation({
  capability: 'checkout', scope: selected,
  args: { ...branchIdArg, name: v.string() },
  handler: (ctx, args) => createStockBin(ctx, ctx.staff, args),
});

export const relocateBinStock = staffMutation({
  capability: 'checkout', scope: selected,
  args: { ...binVariant, from: binLocation, to: binLocation, lotId: v.optional(v.id('stockLots')), quantity: v.number(), requestKey: v.string() },
  handler: (ctx, args) => relocateStockBetweenBins(ctx, ctx.staff, args),
});
