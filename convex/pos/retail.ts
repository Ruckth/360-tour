import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { staffMutation, staffQuery } from '../auth/model';
import { listBranchesForAccess, requireBranchAccess } from '../branches/model';
import { readCommerceSettings } from '../commerce/model';
import { readBudget } from '../lib/readBudget';
import { MAX_QTY } from '../shared/orderMath';
import { assertRoom, CURRENCY, editableOrder, lineSnapshot, logOrder, refreshOrder } from './private/orderModel';
import { orderLines } from './private/orderLines';
import { assertRetailQuantity, productsEnabled, requireRetailBranch, retailError, retailProductLines } from './private/retailStock';
import { assertNoPendingApprovals } from './private/staffApprovalState';

const branchValidator = v.object({ branchId: v.id('branches'), name: v.string() });
const variantValidator = v.object({
  variantId: v.id('productVariants'), productName: v.string(), label: v.string(),
  sku: v.union(v.string(), v.null()), price: v.number(), onHand: v.number(), needsRecount: v.boolean(),
});

export const branches = staffQuery({
  capability: 'checkout',
  args: {},
  returns: v.array(branchValidator),
  handler: async ctx => (await listBranchesForAccess(ctx, ctx.staff))
    .filter(branch => branch.state === 'active')
    .map(branch => ({ branchId: branch._id, name: branch.name })),
});

export const browse = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), search: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(variantValidator),
  handler: async (ctx, { branchId, search, paginationOpts }) => {
    const branch = await requireBranchAccess(ctx, ctx.staff, branchId);
    const settings = await readCommerceSettings(ctx);
    if (branch.state !== 'active' || !productsEnabled(settings.saleSwitches.products, ctx.staff.capabilities.approve)) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const term = search.trim().slice(0, 120);
    const opts = { ...paginationOpts, numItems: Math.min(24, Math.max(1, paginationOpts.numItems)), maximumRowsRead: 96 };
    const source = term ? ctx.db.query('productVariants').withSearchIndex('search_stock', q =>
      q.search('searchText', term).eq('status', 'active').eq('productStatus', 'active')) :
      ctx.db.query('productVariants').withIndex('by_active_product', q => q.eq('status', 'active').eq('productStatus', 'active'));
    const page = await source.paginate(opts);
    const budget = readBudget(ctx);
    budget.range();
    const results = await Promise.all(page.page.map(async variant => {
      budget.document(variant);
      budget.range();
      const stock = await ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q =>
        q.eq('variantId', variant._id).eq('branchId', branchId)).unique();
      if (stock) budget.document(stock);
      return { variantId: variant._id, label: variant.label, productName: variant.productName ?? variant.label,
        sku: variant.sku ?? null, price: variant.price, onHand: stock?.onHand ?? 0, needsRecount: stock?.needsRecount ?? false };
    }));
    budget.assert();
    return { ...page, page: results };
  },
});

export const add = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), orderId: v.optional(v.id('orders')), variantId: v.id('productVariants'),
    quantity: v.number(), expectedPrice: v.number(), clientKey: v.string() },
  returns: v.object({ orderId: v.id('orders'), lineId: v.id('orderLines') }),
  handler: async (ctx, args) => {
    const { branchId, orderId, variantId, quantity, expectedPrice, clientKey } = args;
    const actor = ctx.staff;
    await requireBranchAccess(ctx, actor, branchId);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(clientKey)) retailError('invalid_key', 'Start the product addition again.');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QTY) retailError('quantity', `Enter a quantity from 1 to ${MAX_QTY}.`);
    const fingerprint = JSON.stringify([branchId, orderId ?? null, variantId, quantity, expectedPrice]);
    const previous = await ctx.db.query('retailCartAdds').withIndex('by_actor_and_clientKey', q =>
      q.eq('actor', actor.tokenIdentifier).eq('clientKey', clientKey)).unique();
    if (previous) {
      if (previous.fingerprint !== fingerprint) retailError('key_conflict', 'Start a new addition for the changed product or quantity.');
      return { orderId: previous.orderId, lineId: previous.lineId };
    }
    await requireRetailBranch(ctx, actor, branchId);
    const order = await editableOrder(ctx, orderId, actor);
    if (order.stockBranchId && order.stockBranchId !== branchId) retailError('branch_changed', 'This order has products from a different branch.');
    if (orderId && !order.stockBranchId) await assertNoPendingApprovals(ctx, order._id, 'choosing a selling branch');
    const variant = await ctx.db.get('productVariants', variantId);
    const product = variant ? await ctx.db.get('products', variant.productId) : null;
    if (variant?.status !== 'active' || product?.status !== 'active') retailError('catalogue_changed', 'This product is no longer for sale.');
    if (variant.price !== expectedPrice) retailError('price_changed', 'The product price changed. Check the current price and add it again.');
    const lines = await orderLines(ctx, order._id);
    const productLines = await retailProductLines(ctx, order, lines, variantId);
    await assertRetailQuantity(ctx, { branchId, variantId, orderId: order._id,
      demand: quantity + productLines.reduce((total, line) => total + line.qty, 0) });
    const line = {
      orderId: order._id, kind: 'product' as const, variantId, name: product.name,
      ...(variant.label === product.name ? {} : { detail: variant.label }),
      unitPrice: variant.price, catalogUnitPrice: variant.price, currency: CURRENCY, qty: quantity, createdAt: Date.now(),
    };
    const matching = productLines.find(row => !row.saleSnapshot && row.unitPrice === variant.price &&
      row.catalogUnitPrice === variant.price && !row.discount && !row.priceOverride && row.qty + quantity <= MAX_QTY);
    let lineId;
    if (matching) {
      const qty = matching.qty + quantity;
      await ctx.db.patch(matching._id, { qty });
      await logOrder(ctx, order._id, actor.email, 'line_updated', { before: lineSnapshot(matching), after: lineSnapshot({ ...matching, qty }) });
      lineId = matching._id;
    } else {
      await assertRoom(ctx, order._id);
      lineId = await ctx.db.insert('orderLines', line);
      await logOrder(ctx, order._id, actor.email, 'line_added', { after: { ...lineSnapshot(line), lineId, branchId } });
    }
    if (!order.stockBranchId) await ctx.db.patch(order._id, { stockBranchId: branchId });
    await refreshOrder(ctx, order._id);
    await ctx.db.insert('retailCartAdds', { actor: actor.tokenIdentifier, clientKey, branchId, fingerprint, orderId: order._id, lineId });
    return { orderId: order._id, lineId };
  },
});
