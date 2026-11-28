import { sanitizeStockReturnTo } from "./stock-format";

export const PURCHASING_HUB_PATH = "/admin/stock/purchasing";

const tabs = ["requests", "orders", "receipts", "holds", "suppliers"] as const;
const requestFilters = ["default", "mine", "needs_changes", "draft", "declined", "closed", "awaiting_approval", "approved", "fully_ordered", "all", "item"] as const;
/** `closed` stays accepted for older links; the UI offers received, closed_short and cancelled separately. */
const orderFilters = [
  "open", "overdue", "due_soon", "awaiting_approval", "draft", "received", "closed_short", "cancelled", "closed", "supplier", "item",
] as const;
const receiptFilters = ["all", "exceptions"] as const;
const holdStatuses = ["open", "accepted", "declined"] as const;

function choice<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find(option => option === value);
}

function stockId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/i.test(value) ? value : undefined;
}

function reference(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.slice(0, 64) : undefined;
}

export function validatePurchasingSearch(search: Record<string, unknown>) {
  return {
    tab: choice(search.tab, tabs),
    requestFilter: choice(search.requestFilter, requestFilters),
    orderFilter: choice(search.orderFilter, orderFilters),
    receiptFilter: choice(search.receiptFilter, receiptFilters),
    holdStatus: choice(search.holdStatus, holdStatuses),
    requestVariantId: stockId(search.requestVariantId),
    variantId: stockId(search.variantId),
    supplierId: stockId(search.supplierId),
    allItemOrders: search.allItemOrders === "1" || search.allItemOrders === 1 ? "1" : undefined,
    reference: reference(search.reference),
    receiptReference: reference(search.receiptReference),
    returnTo: typeof search.returnTo === "string" ? sanitizeStockReturnTo(search.returnTo) ?? undefined : undefined,
    new: search.new === "1" || search.new === 1 ? "1" : undefined,
    receive: search.receive === "1" || search.receive === 1 ? "1" : undefined,
    variants: typeof search.variants === "string" ? search.variants : undefined,
  };
}

export function purchasingDetailHref(path: string, params: URLSearchParams) {
  const queue = validatePurchasingSearch(Object.fromEntries(params));
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(queue)) {
    if (value && name !== "new" && name !== "receive" && name !== "variants") search.set(name, value);
  }
  const returnTo = search.size ? `${PURCHASING_HUB_PATH}?${search}` : PURCHASING_HUB_PATH;
  return `${path}?${new URLSearchParams({ returnTo })}`;
}

export function supplierActivityHref(tab: "orders" | "receipts", supplierId: string) {
  return `${PURCHASING_HUB_PATH}?${new URLSearchParams({ tab, orderFilter: "supplier", supplierId })}`;
}
