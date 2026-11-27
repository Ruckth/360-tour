import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { stockError, stockRead, stockText } from './stockLedger';

export const normalizeStockSku = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export function stockSearchFields(
  product: Pick<Doc<'products'>, 'name' | 'status'>,
  variant: Pick<Doc<'productVariants'>, 'label' | 'sku' | 'barcode'>,
) {
  const normalizedSku = variant.sku && normalizeStockSku(variant.sku);
  // Include punctuation-free SKU so exact fragments remain searchable after the tokenizer splits hyphens.
  const compactSku = normalizedSku?.replace(/[\p{P}\p{S}\s]/gu, '');
  return {
    productName: product.name, productStatus: product.status, normalizedSku,
    searchText: [product.name, variant.label, normalizedSku, compactSku, variant.barcode].filter(Boolean).join(' '),
  };
}

export async function requireUniqueStockSku(ctx: QueryCtx, sku: string, variantId?: Id<'productVariants'>) {
  const key = normalizeStockSku(sku);
  const [indexed, legacy] = await Promise.all([
    stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_normalizedSku', q => q.eq('normalizedSku', key)).take(2)),
    stockRead(ctx, () => ctx.db.query('productVariants').withIndex('by_sku', q => q.eq('sku', sku)).take(2)),
  ]);
  if ([...indexed, ...legacy].some(row => row._id !== variantId)) stockError('DUPLICATE_STOCK_SKU', 'This SKU is already in use.');
}

export async function refreshStockSearch(ctx: MutationCtx, variant: Doc<'productVariants'>, product: Pick<Doc<'products'>, 'name' | 'status'>) {
  const fields = stockSearchFields(product, variant);
  if (variant.searchText === fields.searchText && variant.productName === fields.productName &&
      variant.normalizedSku === fields.normalizedSku && variant.productStatus === fields.productStatus) return false;
  await ctx.db.patch(variant._id, fields);
  return true;
}

export async function getProductCategory(ctx: MutationCtx, categoryId?: Id<'productCategories'>) {
  if (categoryId) {
    if (!await stockRead(ctx, () => ctx.db.get(categoryId))) stockError('STOCK_CATEGORY_NOT_FOUND', 'This product category no longer exists.');
    return categoryId;
  }
  const general = await stockRead(ctx, () => ctx.db.query('productCategories').withIndex('by_name', q => q.eq('name', 'General')).first());
  return general?._id ?? await ctx.db.insert('productCategories', { name: 'General', sort: 0 });
}

export function stockSearchTerm(value: string | undefined) {
  return stockText(value?.normalize('NFKC'), 'Search', 100);
}
