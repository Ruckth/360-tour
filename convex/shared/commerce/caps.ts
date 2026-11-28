import { ConvexError } from 'convex/values';
import { MAX_QTY, MAX_TENDERS } from '../orderMath';

export const MAX_TRANSFER_LINES = 12;
export const CHECKOUT_STOCK_HOLD_MS = 10 * 60_000;

const saleLimits = {
  rows: 100,
  packageRows: 20,
  expandedContents: 200,
  distinctVariants: 60,
  sessionGrants: 20,
  coveredRows: 20,
  voucherIssuances: 20,
  roomCharges: 20,
  feeRows: 5,
  paymentRows: MAX_TENDERS,
  distinctFundingVouchers: 2,
  requestBytes: 64 * 1024,
  commerceStays: 1,
  commerceStayNights: 600,
};

const packageLimits = { contents: 20, choosableProducts: 3 };
const returnLimits = { parts: 20, visits: 5, affectedGrants: 20 };
const productLimits = { options: 3, variants: 100 };
const categoryLimits = { depth: 2 };

export const COMMERCE_LIMITS = {
  sale: saleLimits,
  package: packageLimits,
  return: returnLimits,
  product: productLimits,
  category: categoryLimits,
  productQuantity: MAX_QTY,
  servicesPerGrant: 10,
  rowSnapshotBytes: 8 * 1024,
} as const;

type Counts<Limits> = { [Field in keyof Limits]: number };

export type CommerceCapsInput =
  | ({ kind: 'sale'; productQuantities: readonly number[]; rowSnapshotBytes: readonly number[] } & Counts<typeof saleLimits>)
  | ({ kind: 'package'; servicesPerGrant: readonly number[]; productQuantities: readonly number[] } & Counts<typeof packageLimits>)
  | ({ kind: 'return' } & Counts<typeof returnLimits>)
  | ({ kind: 'product' } & Counts<typeof productLimits>)
  | ({ kind: 'category' } & Counts<typeof categoryLimits>);

export function assertCount(label: string, value: number, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConvexError(`${label} must be an integer between ${min} and ${max}`);
  }
}

function assertCounts<Field extends string>(limits: Record<Field, number>, counts: Record<NoInfer<Field>, number>) {
  for (const field of Object.keys(limits) as Field[]) {
    assertCount(field, counts[field], 0, limits[field]);
  }
}

/**
 * Counts describe the proposed state, including already present rows or expanded return parts.
 * Count a funding voucher once across both its paid and goodwill buckets. Pass zero stay/night
 * counts for pre-commerce stay-only orders and count only nights being collected in a commerce sale.
 */
export function assertCommerceCaps(input: CommerceCapsInput): void {
  switch (input.kind) {
    case 'sale':
      assertCounts(saleLimits, input);
      for (const bytes of input.rowSnapshotBytes) {
        assertCount('rowSnapshotBytes', bytes, 0, COMMERCE_LIMITS.rowSnapshotBytes);
      }
      break;
    case 'package':
      assertCounts(packageLimits, input);
      assertCount('contents', input.contents, 1, packageLimits.contents);
      for (const services of input.servicesPerGrant) {
        assertCount('servicesPerGrant', services, 1, COMMERCE_LIMITS.servicesPerGrant);
      }
      break;
    case 'return':
      assertCounts(returnLimits, input);
      break;
    case 'product':
      assertCounts(productLimits, input);
      break;
    case 'category':
      assertCounts(categoryLimits, input);
      break;
  }
  if (input.kind === 'sale' || input.kind === 'package') {
    for (const qty of input.productQuantities) {
      assertCount('productQuantity', qty, 1, COMMERCE_LIMITS.productQuantity);
    }
  }
}
