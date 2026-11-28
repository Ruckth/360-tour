import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export type StockRoles = {
  requester: boolean;
  approver: boolean;
  buyer: boolean;
  receiver: boolean;
  lead: boolean;
};

export type StockBranchAccess = StockRoles & {
  read: boolean;
  directOrder: boolean;
  directReceipt: boolean;
};

export type StockMovementKind =
  | "opening"
  | "sale"
  | "room_bill"
  | "taken_back"
  | "return"
  | "write_off"
  | "adjust"
  | "count"
  | "purchase_receipt"
  | "direct_receipt"
  | "correction"
  | "supplier_return"
  | "transfer_out"
  | "transfer_in"
  | "transfer_short"
  | "lot_adjustment";

export type CatalogueStatus = "draft" | "active" | "archived";

export type StockItemSnapshot = {
  productName: string;
  variantLabel: string;
  sku?: string;
};

export type StockSupplierSnapshot = {
  address?: string;
  taxId?: string;
  paymentTerms?: string;
  deliveryDays?: string;
  minimumOrder?: string;
  leadTimeDays?: number;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
};

export type StockBalanceRow = {
  variantId: Id<"productVariants">;
  productId: Id<"products">;
  productName: string;
  variantLabel: string;
  sku?: string;
  barcode?: string;
  price?: number;
  status?: CatalogueStatus;
  productStatus?: CatalogueStatus;
  onHand: number;
  onOrder: number;
  revision: number;
  needsRecount: boolean;
  lotTracked?: boolean;
  stockLevelId?: Id<"stockLevels">;
};

export type StockCatalogVariant = {
  variantId: Id<"productVariants">;
  productId: Id<"products">;
  productName: string;
  variantLabel: string;
  sku?: string;
  barcode?: string;
  price?: number;
  status?: CatalogueStatus;
  onHand?: number;
  onOrder?: number;
  revision?: number;
  lotTracked?: boolean;
};

export type PurchaseRequestStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "needs_changes"
  | "declined"
  | "closed"
  | "deleted";

export type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "closed_short"
  | "cancelled"
  | "deleted"
  | "awaiting_approval";

export type SupplierStatus = "active" | "inactive";
export type SupplierReceiptKind = "order" | "direct" | "rejected";
export type PurchaseHoldStatus = "open" | "accepted" | "declined";
export type ReceiptAdjustmentKind = "correction" | "supplier_return" | "return_reversal";

export type StockProblemStatus = "open" | "resolved";

export type StockHistoryChange = {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

export type StockPurchaseEvent = FunctionReturnType<typeof api.commerce.purchasing.history>["page"][number];

export type StockLineDraft = {
  variantId: Id<"productVariants">;
  productName: string;
  variantLabel: string;
  sku?: string;
  quantityText: string;
  quantityHint?: string;
  unitCostText?: string;
  requestLineId?: string;
  maxQuantity?: number;
  availableQuantity?: number;
  onHand?: number;
  onOrder?: number;
  revision?: number;
  lotTracked?: boolean;
  /** Order lines: the supplier will confirm the price (issues without a unit cost, prints TBC). */
  priceTbc?: boolean;
};
