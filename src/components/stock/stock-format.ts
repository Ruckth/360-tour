import { bahtToSatang, MAX_MONEY, satangToBaht } from "convex/shared/money";
import type { Tone } from "@/components/admin/status-tones";
import { errorText } from "@/lib/staff-bookings";
import type {
  CatalogueStatus,
  PurchaseHoldStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  StockMovementKind,
  StockProblemStatus,
  SupplierReceiptKind,
  SupplierStatus,
} from "./stock-types";

export const STOCK_MAX_LINES = 50;
export const STOCK_PAGE_SIZE = 25;
export const STOCK_MAX_QUANTITY = 1_000_000;

/** Parse a comma-separated `variants` query param into deduplicated, capped variant ID strings. */
export function parseVariantIdsParam(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= STOCK_MAX_LINES) break;
  }
  return out;
}

/** Validate an internal Stock return path so breadcrumbs only navigate within `/admin/stock`. */
export function sanitizeStockReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/admin/stock")) return null;
  if (/[\\\r\n\t]/.test(trimmed)) return null;
  const nextChar = trimmed["/admin/stock".length];
  if (nextChar !== undefined && nextChar !== "/" && nextChar !== "?") return null;
  const url = new URL(trimmed, "https://stock.local");
  if (url.pathname !== "/admin/stock" && !url.pathname.startsWith("/admin/stock/")) return null;
  return trimmed;
}

/** Human-readable back link label for a sanitized `/admin/stock...` return path. */
export function stockReturnLabel(returnTo: string | null, fallback: string): string {
  if (!returnTo) return fallback;
  if (returnTo.startsWith("/admin/stock/balances")) return "Balances";
  if (returnTo.startsWith("/admin/stock/activity")) return "Activity";
  if (returnTo.startsWith("/admin/stock/products")) return "Products";
  if (returnTo.startsWith("/admin/stock/expansion")) return "Transfers & Lots";
  if (returnTo.startsWith("/admin/stock/purchasing/orders/")) return "Order";
  if (returnTo.startsWith("/admin/stock/purchasing/requests/")) return "Request";
  if (returnTo.startsWith("/admin/stock/purchasing/receipts/")) return "Receipt";
  if (returnTo.startsWith("/admin/stock/purchasing")) {
    const tab = new URL(returnTo, "https://stock.local").searchParams.get("tab");
    if (tab === "requests") return "Requests";
    if (tab === "receipts") return "Receipts";
    if (tab === "holds") return "Held goods";
    if (tab === "suppliers") return "Suppliers";
    return "Orders";
  }
  return fallback;
}

/** Build a clean pathname+search string with consumed auto-open query params stripped. */
export function stripSearchParams(
  pathname: string,
  searchParams: URLSearchParams,
  keys: readonly string[],
): string {
  const next = new URLSearchParams(searchParams.toString());
  for (const key of keys) next.delete(key);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Format integer satang in THB with tabular figures. */
export function formatSatang(satang: number | undefined | null): string {
  if (satang === undefined || satang === null) return "—";
  const baht = satangToBaht(satang);
  return `฿${baht.toLocaleString("en-US", { minimumFractionDigits: baht % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Parse a user-entered THB unit cost string into integer satang (or undefined when blank). */
export function parseOptionalSatang(raw: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = raw.trim().replaceAll(",", "");
  if (!trimmed) return { ok: true, value: undefined };
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid THB amount with up to 2 decimal places." };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Amount must be zero or more." };
  }
  const satang = bahtToSatang(parsed);
  if (satang > MAX_MONEY) {
    return { ok: false, error: `Amount cannot exceed ฿${(MAX_MONEY / 100).toLocaleString("en-US")}.` };
  }
  return { ok: true, value: satang };
}

/** Parse a whole-number quantity string. */
export function parseWholeQuantity(
  raw: string,
  options: { allowZero?: boolean; allowBlank?: boolean; max?: number; label?: string } = {},
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const { allowZero = false, allowBlank = false, max = STOCK_MAX_QUANTITY, label = "Quantity" } = options;
  const trimmed = raw.trim();
  if (!trimmed) {
    if (allowBlank) return { ok: true, value: undefined };
    return { ok: false, error: `${label} is required.` };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${label} must be a whole number.` };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: `${label} is out of range.` };
  }
  if (!allowZero && value <= 0) {
    return { ok: false, error: `${label} must be at least 1.` };
  }
  if (value > max) {
    return { ok: false, error: `${label} cannot exceed ${max.toLocaleString("en-US")}.` };
  }
  return { ok: true, value };
}

/** Generate an idempotency operation key for stock/purchasing writes. */
export function createOperationKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${random}`;
}

export function formatSignedDelta(delta: number): string {
  if (delta > 0) return `+${delta.toLocaleString("en-US")}`;
  if (delta < 0) return `−${Math.abs(delta).toLocaleString("en-US")}`;
  return "0";
}

export function formatItemDisplay(item: { productName?: string; variantLabel?: string; sku?: string }): string {
  const name = [item.productName, item.variantLabel].filter(Boolean).join(" · ") || "Unnamed item";
  return item.sku ? `${name} (${item.sku})` : name;
}

export type StockErrorPayload = {
  code?: string;
  message?: string;
  existingReceiptId?: string;
  existingReceiptReference?: string;
  availableByLine?: Record<string, number>;
  details?: Record<string, unknown>;
};

export function parseStockError(error: unknown, fallback: string): { message: string; payload: StockErrorPayload | null } {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const payload = data as StockErrorPayload;
      if (typeof payload.message === "string" && payload.message.trim()) {
        return { message: payload.message, payload };
      }
      return { message: errorText(error, fallback), payload };
    }
  }
  return { message: errorText(error, fallback), payload: null };
}

export const REQUEST_STATUS_META: Record<PurchaseRequestStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  awaiting_approval: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  needs_changes: { label: "Needs changes", tone: "warning" },
  declined: { label: "Declined", tone: "danger" },
  closed: { label: "Closed", tone: "muted" },
  deleted: { label: "Deleted", tone: "muted" },
};

export const ORDER_STATUS_META: Record<PurchaseOrderStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ordered: { label: "Ordered", tone: "info" },
  partially_received: { label: "Partially received", tone: "warning" },
  received: { label: "Received", tone: "success" },
  closed_short: { label: "Closed short", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
  deleted: { label: "Deleted", tone: "muted" },
};

export const RECEIPT_KIND_META: Record<SupplierReceiptKind, { label: string; tone: Tone }> = {
  order: { label: "Order receipt", tone: "success" },
  direct: { label: "Direct receipt", tone: "info" },
  rejected: { label: "Rejected delivery", tone: "danger" },
};

export const HOLD_STATUS_META: Record<PurchaseHoldStatus, { label: string; tone: Tone }> = {
  open: { label: "Held for buyer", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "muted" },
};

export const SUPPLIER_STATUS_META: Record<SupplierStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "muted" },
};

export const CATALOGUE_STATUS_META: Record<CatalogueStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  archived: { label: "Archived", tone: "muted" },
};

export const PROBLEM_STATUS_META: Record<StockProblemStatus, { label: string; tone: Tone }> = {
  open: { label: "Needs review", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};

export const MOVEMENT_KIND_META: Record<StockMovementKind, { label: string; tone: Tone }> = {
  opening: { label: "Opening stock", tone: "info" },
  sale: { label: "Sale", tone: "neutral" },
  room_bill: { label: "Room bill", tone: "neutral" },
  taken_back: { label: "Taken back", tone: "info" },
  return: { label: "Customer return", tone: "success" },
  write_off: { label: "Write-off", tone: "danger" },
  adjust: { label: "Adjustment", tone: "warning" },
  count: { label: "Stock count", tone: "info" },
  purchase_receipt: { label: "PO receipt", tone: "success" },
  direct_receipt: { label: "Direct receipt", tone: "success" },
  correction: { label: "Correction", tone: "accent" },
  supplier_return: { label: "Supplier return", tone: "danger" },
  transfer_out: { label: "Transfer out", tone: "info" },
  transfer_in: { label: "Transfer in", tone: "success" },
  transfer_short: { label: "Transfer shortage", tone: "danger" },
  lot_adjustment: { label: "Lot adjustment", tone: "warning" },
};

export const ADJUST_REMOVE_REASONS = [
  { code: "damaged", label: "Damaged" },
  { code: "expired", label: "Expired" },
  { code: "lost", label: "Lost" },
  { code: "other", label: "Other" },
] as const;

export const ADJUST_ADD_REASONS = [
  { code: "found", label: "Found" },
  { code: "other", label: "Other" },
] as const;

export const COUNT_VARIANCE_CHIPS = [
  "Shelf recount",
  "Unrecorded breakage",
  "Display sample",
  "Supplier miscount",
] as const;

export const DIRECT_RECEIPT_REASON_CHIPS = [
  "Opening stock",
  "Urgent local purchase",
  "Unplanned supplier drop-off",
  "Wrong-item follow-up",
] as const;

export const CORRECTION_REASON_CHIPS = [
  "Overcount on delivery",
  "Posted against wrong SKU",
  "Duplicate entry",
  "Damaged unit found after posting",
] as const;

export const SUPPLIER_RETURN_REASON_CHIPS = [
  "Damaged goods",
  "Wrong item supplied",
  "Expired or short-dated",
  "Quality defect",
] as const;
