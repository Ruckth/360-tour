"use client";

import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowRight, PackagePlus, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { EmptyState, SearchBox, SkeletonRows, useDebounced } from "@/components/admin/admin-bulk";
import { STOCK_TABLE } from "./stock-table";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Callout, EditorSheet, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { Toast, useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import {
  CATALOGUE_STATUS_META,
  formatSatang,
  parseStockError,
  STOCK_PAGE_SIZE,
} from "./stock-format";
import type { CatalogueStatus } from "./stock-types";
import { ProductEditorSheet } from "./ProductEditorSheet";

type ProductRow = FunctionReturnType<typeof api.commerce.stock.listProducts>["page"][number];
type ProductDetail = FunctionReturnType<typeof api.commerce.stock.getProduct>;

export function StockProductsView() {
  const { current: branch } = useAdminBranch();
  const confirm = useConfirm();
  const client = useConvex();
  const archiveToast = useToast(10_000);
  const screen = useRef<HTMLDivElement>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  const sheetClosing = useRef(false);
  const undoProductId = useRef<Id<"products"> | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<Id<"products"> | null>(null);
  const [pending, setPending] = useState(false);
  const { notice, show, clear } = useNotice();

  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), 200);
  const [statusFilter, setStatusFilter] = useState<CatalogueStatus>("active");
  const [editingProductId, setEditingProductId] = useState<Id<"products"> | "new" | null>(null);
  const [historyProduct, setHistoryProduct] = useState<ProductRow | null>(null);
  const [savedProductId, setSavedProductId] = useState<Id<"products"> | null>(null);

  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");
  const categories = useQuery(
    api.commerce.stock.listCategories,
    branch && access?.read ? { branchId: branch.id } : "skip",
  );
  const { results: products, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.listProducts,
    branch && access?.read
      ? {
          branchId: branch.id,
          status: statusFilter,
          ...(debounced ? { search: debounced } : {}),
        }
      : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );
  const savedDetail = useQuery(
    api.commerce.stock.getProduct,
    branch && access?.read && savedProductId ? { branchId: branch.id, productId: savedProductId } : "skip",
  );
  const archiveProduct = useMutation(api.commerce.stock.archiveProduct);

  const restoreProduct = useMutation(api.commerce.stock.restoreProduct);

  if (!branch) return null;
  if (access === undefined) return <SkeletonRows label="Loading products" rows={5} />;
  if (!access.read) {
    return (
      <Callout tone="warning" title="Stock access required">
        You do not have a stock role for {branch.name}. Ask an owner to grant branch stock access.
      </Callout>
    );
  }

  function fallbackFocus() {
    return screen.current?.querySelector<HTMLElement>('[id^="stock-product-status-tab-"][aria-selected="true"]')
      ?? null;
  }

  function restoreSheetFocus(event: Event) {
    event.preventDefault();
    if (!sheetClosing.current) return;
    sheetClosing.current = false;
    const opener = sheetOpener.current;
    sheetOpener.current = null;
    (opener?.isConnected ? opener : fallbackFocus())?.focus();
  }

  function openEditor(id: Id<"products"> | "new", opener: HTMLElement) {
    sheetClosing.current = false;
    sheetOpener.current = opener;
    setEditingProductId(id);
  }

  function closeEditor() {
    sheetClosing.current = true;
    setEditingProductId(null);
  }

  function rowMenu(product: ProductRow) {
    return document.getElementById(`stock-product-actions-${product._id}`)?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? null;
  }

  function focusAfterRowRemoval(opener: Element | null, nextStatus?: CatalogueStatus) {
    if (document.activeElement === opener || document.activeElement === document.body) {
      const target = nextStatus && document.getElementById(`stock-product-status-tab-${nextStatus}`);
      (target || fallbackFocus())?.focus();
    }
  }

  async function handleArchive(product: ProductRow) {
    if (!branch || pending) return;
    setPending(true);
    const opener = rowMenu(product);
    let archived = false;
    try {
      const args = { branchId: branch.id, productId: product._id };
      const impact = await client.query(api.commerce.stock.productArchiveImpact, args);
      const confirmed = await confirm({
        title: `Archive “${product.name}”?`,
        description: (
          <>
            <span className="block">Archived products cannot be added to new purchase requests or orders. Existing issued orders remain receivable.</span>
            <span className="mt-2 block font-medium">
              {impact.partialVariants && "First 50 variants: "}
              {impact.onHand} on hand at {branch.name} · {impact.onOrder} on order
              {" "}({impact.partialOrders ? "at least " : ""}{impact.openOrders} open {impact.openOrders === 1 ? "order" : "orders"}) · {impact.variantCount} variants
            </span>
            {impact.hasStock || impact.partialVariants ? (
              <ButtonLink href="/admin/stock/balances" variant="link" className="mt-1 px-0">View balances</ButtonLink>
            ) : null}
          </>
        ),
        confirmLabel: impact.hasStock || impact.partialVariants ? "Archive anyway" : "Archive product",
        destructive: true,
        returnFocusTo: () => !archived && opener?.isConnected ? opener : fallbackFocus(),
      });
      if (!confirmed) return;
      await archiveProduct({ ...args, expectedRevision: product.revision });
      archived = true;
      focusAfterRowRemoval(opener);
      clear();
      undoProductId.current = product._id;
      archiveToast.show(`Archived ${product.name}.`, {
        label: "Undo",
        retryOnError: true,
        run: async () => {
          const undoTrigger = document.activeElement;
          try {
            await restoreProduct({ ...args, expectedRevision: product.revision + 1 });
            setStatusFilter("active");
            focusAfterRowRemoval(undoTrigger, "active");
          } catch (cause) {
            setStatusFilter("archived");
            const failure = parseStockError(cause, "Could not undo the archive.");
            throw new Error(`${failure.message} You can also restore from the Archived tab.`);
          }
        },
      });
    } catch (cause) {
      show(parseStockError(cause, "Could not archive this product.").message, "danger");
    } finally {
      setPending(false);
    }
  }

  async function handleRestore(product: ProductRow, opener: HTMLElement) {
    if (!branch || pending) return;
    setPending(true);
    try {
      await restoreProduct({ branchId: branch.id, productId: product._id, expectedRevision: product.revision });
      focusAfterRowRemoval(opener, "active");
      if (undoProductId.current === product._id) archiveToast.dismiss();
      setStatusFilter("active");
      show(`Restored ${product.name}.`, "success");
    } catch (cause) {
      show(parseStockError(cause, "Could not restore this product.").message, "danger");
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={screen} className="grid gap-5">
      <NoticeBar notice={archiveToast.current && notice?.tone === "success" ? null : notice} onClose={clear} />
      <Toast {...archiveToast} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Products</h2>
        </div>
        {access.canManageProducts ? (
          <Button type="button" onClick={event => openEditor("new", event.currentTarget)}>
            <PackagePlus aria-hidden className="size-4" />
            New product
          </Button>
        ) : null}
      </div>

      {savedDetail ? (
        <SavedProductCard
          key={`${branch.id}-${savedDetail.product._id}`}
          detail={savedDetail}
          canReceive={access.receiver}
          branchName={branch.name}
          onDismiss={() => setSavedProductId(null)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SearchBox
          value={search}
          onChange={setSearch}
          label="Search products by name or SKU"
          placeholder="Search product name or SKU…"
        />
        <SegmentedTabs
          id="stock-product-status"
          label="Product status"
          value={statusFilter}
          onValueChange={setStatusFilter}
          tabs={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
            { value: "draft", label: "Draft" },
          ]}
        />
      </div>

      <Card {...tabPanelProps("stock-product-status", statusFilter)} className="overflow-hidden">
        {status === "LoadingFirstPage" ? (
          <SkeletonRows label="Loading products" rows={5} />
        ) : products.length === 0 ? (
          <EmptyState
            action={
              access.canManageProducts && statusFilter === "active" && !debounced ? (
                <Button type="button" onClick={event => openEditor("new", event.currentTarget)}>
                  <Plus aria-hidden className="size-4" />
                  Create first product
                </Button>
              ) : null
            }
          >
            {debounced
              ? `No ${statusFilter} products match “${debounced}”.`
              : `No ${statusFilter} products yet.`}
          </EmptyState>
        ) : (
          <table className={STOCK_TABLE.table}>
            <thead className={STOCK_TABLE.head}>
              <tr>
                <th scope="col" className={STOCK_TABLE.th}>Product</th>
                <th scope="col" className={STOCK_TABLE.th}>Category</th>
                <th scope="col" className={STOCK_TABLE.th}>Variants</th>
                <th scope="col" className={STOCK_TABLE.th}>Price range</th>
                <th scope="col" className={STOCK_TABLE.th}>VAT</th>
                <th scope="col" className={STOCK_TABLE.th}>Status</th>
                <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className={STOCK_TABLE.body}>
              {products.map((product) => (
                <tr key={product._id} className={STOCK_TABLE.row}>
                  <td data-label="Product" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                    {access.canManageProducts && product.status !== "archived" ? (
                      <Button type="button" variant="link" className="h-auto whitespace-normal px-0 text-left" onClick={event => openEditor(product._id, event.currentTarget)}>
                        {product.name}
                      </Button>
                    ) : <span className="font-medium text-foreground">{product.name}</span>}
                  </td>
                  <td data-label="Category" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                    {product.categoryName ?? "—"}
                  </td>
                  <td data-label="Variants" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "tabular-nums")}>
                    {product.variantCount} variants
                    {expandedProduct === product._id && <ProductVariants branchId={branch.id} product={product} />}
                  </td>
                  <td data-label="Price range" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "tabular-nums")}>
                    {product.minPrice === product.maxPrice
                      ? formatSatang(product.minPrice)
                      : `${formatSatang(product.minPrice)} – ${formatSatang(product.maxPrice)}`}
                  </td>
                  <td data-label="VAT" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "text-xs text-muted-foreground")}>
                    {product.vatProfile === "standard" ? "Standard VAT" : "VAT exempt"}
                  </td>
                  <td data-label="Status" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                    <StatusBadge {...CATALOGUE_STATUS_META[product.status]} />
                  </td>
                  <td className={cn(STOCK_TABLE.cell, "lg:text-right")}>
                    <div id={`stock-product-actions-${product._id}`} className="flex flex-wrap gap-1.5 lg:justify-end">
                      {access.canManageProducts && product.status === "archived" ? (
                        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={event => void handleRestore(product, event.currentTarget)}>
                          Restore
                        </Button>
                      ) : null}
                      <MoreMenu label={`Actions for ${product.name}`} items={[
                        { label: expandedProduct === product._id ? "Hide variants" : "Show variants",
                          onSelect: () => setExpandedProduct(current => current === product._id ? null : product._id) },
                        { label: "History", onSelect: () => {
                          sheetClosing.current = false;
                          sheetOpener.current = rowMenu(product);
                          setHistoryProduct(product);
                        } },
                        { label: "Archive", destructive: true, hidden: !access.canManageProducts || product.status === "archived",
                          disabled: pending, onSelect: () => void handleArchive(product) },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {status === "CanLoadMore" ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
            Load more products
          </Button>
        </div>
      ) : null}

      {editingProductId !== null ? (
        <ProductEditorSheet
          branchId={branch.id}
          productId={editingProductId === "new" ? undefined : editingProductId}
          categories={categories ?? []}
          onClose={closeEditor}
          onCloseAutoFocus={restoreSheetFocus}
          onSaved={(productId) => {
            closeEditor();
            setSavedProductId(productId);
            show("Product saved.", "success");
          }}
        />
      ) : null}

      {historyProduct ? (
        <ProductHistorySheet
          branchId={branch.id}
          product={historyProduct}
          onCloseAutoFocus={restoreSheetFocus}
          onClose={() => {
            sheetClosing.current = true;
            setHistoryProduct(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ProductVariants({ branchId, product }: { branchId: Id<"branches">; product: ProductRow }) {
  const detail = useQuery(api.commerce.stock.getProduct, { branchId, productId: product._id, includeStock: true });
  return (
    <div aria-live="polite">
      {detail === undefined ? <p>Loading variants…</p> : detail?.balances?.length ? (
        <ul className="mt-2 grid gap-2 text-xs">
          {detail.balances.map(variant => (
            <li key={variant.variantId}>
              <strong>{variant.label}</strong>
              <span className="block text-muted-foreground">{variant.sku ?? "No SKU"} · {formatSatang(variant.price)} · {variant.onHand} on hand</span>
            </li>
          ))}
          {detail.hasMoreVariants && <li>Showing the first 50 variants.</li>}
        </ul>
      ) : <p>No variants available.</p>}
    </div>
  );
}

function SavedProductCard({
  detail,
  canReceive,
  branchName,
  onDismiss,
}: {
  detail: NonNullable<ProductDetail>;
  canReceive: boolean;
  branchName: string;
  onDismiss: () => void;
}) {
  const [selectedId, setSelectedId] = useState<Id<"productVariants"> | null>(null);
  const active = detail.variants.filter((variant) => variant.status === "active");
  const receiveAvailable = canReceive && detail.product.status === "active" && active.length > 0;
  const target = active.length === 1 ? active[0] : active.find((variant) => variant._id === selectedId);

  return (
    <Callout
      tone="success"
      title={`Saved ${detail.product.name}`}
      action={
        <div className="flex flex-wrap gap-2">
          {receiveAvailable ? (
            target ? (
              <ButtonLink href={`/admin/stock/balances?receiveVariantId=${target._id}`} size="sm">
                {active.length > 1 ? "Receive selected variant" : "Open Receive"}
                <ArrowRight aria-hidden className="size-4" />
              </ButtonLink>
            ) : (
              <Button type="button" size="sm" disabled>Receive selected variant</Button>
            )
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
        </div>
      }
    >
      {receiveAvailable && active.length > 1 ? (
        <fieldset className="mt-2 grid gap-1">
          <legend className="font-medium">Variant to receive at {branchName}</legend>
          {active.map((variant) => (
            <label key={variant._id} className="flex items-center gap-2">
              <input
                type="radio"
                name="saved-receive-variant"
                checked={target?._id === variant._id}
                onChange={() => setSelectedId(variant._id)}
              />
              {variant.label}{variant.sku ? ` · ${variant.sku}` : ""}
            </label>
          ))}
        </fieldset>
      ) : null}
    </Callout>
  );
}

const HISTORY_FIELDS: Record<string, string> = {
  name: "Product name", categoryId: "Category", vatProfile: "VAT profile",
  label: "Label", sku: "SKU", price: "Price", status: "Status",
};

function formatHistoryValue(field: string, value: unknown, categories: Record<string, string>) {
  if (value == null) return "—";
  if (field === "categoryId") return typeof value === "string" ? categories[value] ?? "Unavailable category" : "Unavailable category";
  if (field === "price" && typeof value === "number") return formatSatang(value);
  if (field === "vatProfile") return value === "standard" ? "Standard VAT" : "VAT exempt";
  if (field === "status" && typeof value === "string" && Object.hasOwn(CATALOGUE_STATUS_META, value)) {
    return CATALOGUE_STATUS_META[value as CatalogueStatus].label;
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "Value unavailable";
}

function ProductHistorySheet({
  branchId,
  product,
  onClose,
  onCloseAutoFocus,
}: {
  branchId: Id<"branches">;
  product: ProductRow;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const detail = useQuery(api.commerce.stock.getProduct, { branchId, productId: product._id });
  const [selectedVariantId, setSelectedVariantId] = useState<string>("all");

  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.productHistory,
    {
      branchId,
      productId: product._id,
      allTargets: selectedVariantId === "all",
      ...(selectedVariantId !== "product" && selectedVariantId !== "all"
        ? { variantId: selectedVariantId as Id<"productVariants"> }
        : {}),
    },
    { initialNumItems: 15 },
  );

  return (
    <EditorSheet
      open
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      header={
        <>
          <SheetTitle>{product.name} · History</SheetTitle>
          <SheetDescription>Edit and archive audit trail for this product and its variants.</SheetDescription>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-5 sm:px-6">
          <SegmentedTabs label="History target" value={selectedVariantId} onValueChange={setSelectedVariantId}
            tabs={[
              { value: "all", label: "All" },
              { value: "product", label: "Product" },
              ...(detail?.variants ?? []).map(variant => ({ value: variant._id, label: variant.label })),
            ]}
          />
          {detail?.hasMoreVariants && <p className="text-sm text-muted-foreground">History includes the first 50 variants.</p>}

          {status === "LoadingFirstPage" ? (
            <SkeletonRows label="Loading product history" rows={4} />
          ) : results.length === 0 ? (
            <EmptyState>No edit or archive history recorded yet.</EmptyState>
          ) : (
            <ol className="divide-y divide-border">
              {results.map((entry) => (
                <li key={entry._id} className="grid gap-1.5 py-3 first:pt-0 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {entry.revisionBefore === 0 ? "Created" : `Revision ${entry.revisionAfter}`} by {entry.actorLabel}
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5">
                        {entry.targetType === "product" ? "Product" : ["Variant", detail?.variants.find(variant => variant._id === entry.targetId)?.label].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <time
                      dateTime={new Date(entry.recordedAt).toISOString()}
                      className="tabular-nums text-muted-foreground"
                    >
                      {staffDateTime(entry.recordedAt)}
                    </time>
                  </div>
                  {Object.keys(entry.after).some(field => HISTORY_FIELDS[field]) ? (
                    <dl className="grid gap-1 rounded-md bg-muted/40 p-2.5">
                      {Object.entries(entry.after).filter(([field]) => HISTORY_FIELDS[field]).map(([field, value]) => (
                        <div key={field} className="flex flex-wrap gap-1.5">
                          <dt className="font-medium">{HISTORY_FIELDS[field]}</dt>
                          <dd className="text-muted-foreground">
                            {entry.revisionBefore !== 0 && `${formatHistoryValue(field, entry.before[field], entry.categoryNames)} → `}
                            <span className="text-foreground">{formatHistoryValue(field, value, entry.categoryNames)}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="text-muted-foreground">Variants updated</p>}
                </li>
              ))}
            </ol>
          )}

          {status === "CanLoadMore" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => loadMore(15)}>
              Load earlier history
            </Button>
          ) : null}
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </EditorSheet>
  );
}
