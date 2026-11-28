"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Archive, ArrowRight, History, PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, SearchBox, SkeletonRows, STACKED_TABLE, useDebounced } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Callout, EditorSheet, FieldError, NoticeBar, NumberField, SheetForm, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import {
  CATALOGUE_STATUS_META,
  formatSatang,
  parseOptionalSatang,
  parseStockError,
  STOCK_MAX_LINES,
  STOCK_PAGE_SIZE,
} from "./stock-format";
import type { CatalogueStatus } from "./stock-types";
import { reviewProductDraft, type ProductDraft, type VariantDraft } from "./stock-product-draft";
import { useStockDirtyGuard } from "./StockFormGuard";

type VatProfile = FunctionArgs<typeof api.commerce.stock.saveProduct>["vatProfile"];
type CategoryRow = FunctionReturnType<typeof api.commerce.stock.listCategories>[number];
type ProductRow = FunctionReturnType<typeof api.commerce.stock.listProducts>["page"][number];
type ProductDetail = FunctionReturnType<typeof api.commerce.stock.getProduct>;

let draftKeySeq = 0;
const nextDraftKey = () => `v-${++draftKeySeq}`;

export function StockProductsView() {
  const { current: branch } = useAdminBranch();
  const confirm = useConfirm();
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

  if (!branch) return null;
  if (access === undefined) return <SkeletonRows label="Loading products" rows={5} />;
  if (!access.read) {
    return (
      <Callout tone="warning" title="Stock access required">
        You do not have a stock role for {branch.name}. Ask an owner to grant branch stock access.
      </Callout>
    );
  }

  async function handleArchive(product: ProductRow) {
    if (!branch) return;
    const confirmed = await confirm({
      title: `Archive “${product.name}”?`,
      description:
        "Archived products cannot be added to new purchase requests or orders. Existing issued orders remain receivable.",
      confirmLabel: "Archive product",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await archiveProduct({
        branchId: branch.id,
        productId: product._id,
        expectedRevision: product.revision,
      });
      show(`Archived ${product.name}.`, "success");
    } catch (cause) {
      show(parseStockError(cause, "Could not archive this product.").message, "danger");
    }
  }

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Products</h2>
          <p className="text-sm text-muted-foreground">
            Create, edit, or archive retail products and their sellable variants, SKUs, and prices.
          </p>
        </div>
        {access.canManageProducts ? (
          <Button type="button" onClick={() => setEditingProductId("new")}>
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
          label="Search products by name"
          placeholder="Search product name…"
        />
        <SegmentedTabs
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

      <Card className="overflow-hidden">
        {status === "LoadingFirstPage" ? (
          <SkeletonRows label="Loading products" rows={5} />
        ) : products.length === 0 ? (
          <EmptyState
            action={
              access.canManageProducts && statusFilter === "active" && !debounced ? (
                <Button type="button" onClick={() => setEditingProductId("new")}>
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
          <table className={STACKED_TABLE.table}>
            <thead className={STACKED_TABLE.head}>
              <tr>
                <th scope="col" className={STACKED_TABLE.th}>Product</th>
                <th scope="col" className={STACKED_TABLE.th}>Variants</th>
                <th scope="col" className={STACKED_TABLE.th}>Price range</th>
                <th scope="col" className={STACKED_TABLE.th}>VAT</th>
                <th scope="col" className={STACKED_TABLE.th}>Status</th>
                <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {products.map((product) => (
                <tr key={product._id} className={STACKED_TABLE.row}>
                  <td data-label="Product" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                    <span className="font-medium text-foreground">{product.name}</span>
                  </td>
                  <td data-label="Variants" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "tabular-nums")}>
                    {product.variantCount}
                  </td>
                  <td data-label="Price range" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "tabular-nums")}>
                    {product.minPrice === product.maxPrice
                      ? formatSatang(product.minPrice)
                      : `${formatSatang(product.minPrice)} – ${formatSatang(product.maxPrice)}`}
                  </td>
                  <td data-label="VAT" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs text-muted-foreground")}>
                    {product.vatProfile === "standard" ? "Standard VAT" : "VAT exempt"}
                  </td>
                  <td data-label="Status" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                    <StatusBadge {...CATALOGUE_STATUS_META[product.status]} />
                  </td>
                  <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setHistoryProduct(product)}
                      >
                        <History aria-hidden className="size-3.5" />
                        History
                      </Button>
                      {access.canManageProducts && product.status !== "archived" ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingProductId(product._id)}
                          >
                            <Pencil aria-hidden className="size-3.5" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void handleArchive(product)}
                          >
                            <Archive aria-hidden className="size-3.5" />
                            Archive
                          </Button>
                        </>
                      ) : null}
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
          onClose={() => setEditingProductId(null)}
          onSaved={(productId) => {
            setEditingProductId(null);
            setSavedProductId(productId);
            show("Product saved.", "success");
          }}
        />
      ) : null}

      {historyProduct ? (
        <ProductHistorySheet
          branchId={branch.id}
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      ) : null}
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

function productDraft(detail: NonNullable<ProductDetail>): ProductDraft {
  return {
    name: detail.product.name,
    categoryId: detail.product.categoryId ?? "",
    vatProfile: detail.product.vatProfile,
    variants: detail.variants.map((variant) => ({
      key: variant._id,
      variantId: variant._id,
      label: variant.label,
      sku: variant.sku ?? "",
      priceBaht: (variant.price / 100).toString(),
      status: variant.status,
    })),
  };
}

function ProductEditorSheet({
  branchId,
  productId,
  categories,
  onClose,
  onSaved,
}: {
  branchId: Id<"branches">;
  productId?: Id<"products">;
  categories: readonly CategoryRow[];
  onClose: () => void;
  onSaved: (productId: Id<"products">) => void;
}) {
  const detail = useQuery(api.commerce.stock.getProduct, productId ? { branchId, productId } : "skip");

  if (productId && detail === undefined) {
    return (
      <EditorSheet open wide onClose={onClose} header={<SheetTitle>Loading product…</SheetTitle>}>
        <div className="p-6">
          <SkeletonRows label="Loading product" rows={4} />
        </div>
      </EditorSheet>
    );
  }

  return (
    <ProductEditorForm
      key={productId ?? "new"}
      branchId={branchId}
      detail={detail ?? null}
      categories={categories}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function ProductEditorForm({
  branchId,
  detail,
  categories,
  onClose,
  onSaved,
}: {
  branchId: Id<"branches">;
  detail: ProductDetail;
  categories: readonly CategoryRow[];
  onClose: () => void;
  onSaved: (productId: Id<"products">) => void;
}) {
  const saveProduct = useMutation(api.commerce.stock.saveProduct);
  const [reviewed, setReviewed] = useState(() => ({
    revision: detail?.product.revision,
    draft: detail ? productDraft(detail) : {
      name: "",
      categoryId: categories[0]?._id ?? "",
      vatProfile: "standard" as VatProfile,
      variants: [{ key: nextDraftKey(), label: "Standard", sku: "", priceBaht: "", status: "active" as const }],
    },
  }));
  const [name, setName] = useState(reviewed.draft.name);
  const [categoryId, setCategoryId] = useState<string>(reviewed.draft.categoryId);
  const [vatProfile, setVatProfile] = useState<VatProfile>(reviewed.draft.vatProfile);
  const [variants, setVariants] = useState<VariantDraft[]>(reviewed.draft.variants);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [variantErrors, setVariantErrors] = useState<Record<string, string>>({});
  const [latestChoices, setLatestChoices] = useState<{ revision: number; keys: Set<string> }>();

  const currentDraft: ProductDraft = { name, categoryId, vatProfile, variants };
  const isDirty = JSON.stringify(currentDraft) !== JSON.stringify(reviewed.draft);
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  const liveRevision = detail?.product.revision;
  const liveDraft = detail && liveRevision !== reviewed.revision ? productDraft(detail) : null;
  const useLatest = latestChoices && latestChoices.revision === liveRevision ? latestChoices.keys : new Set<string>();
  const review = liveDraft ? reviewProductDraft(reviewed.draft, liveDraft, currentDraft, useLatest) : null;

  function applyReview(next: ProductDraft) {
    if (!liveDraft || liveRevision === undefined) return;
    setName(next.name);
    setCategoryId(next.categoryId);
    setVatProfile(next.vatProfile);
    setVariants(next.variants);
    setReviewed({ revision: liveRevision, draft: liveDraft });
    setLatestChoices(undefined);
    setVariantErrors({});
    setError("");
  }

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setVariants((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addVariant() {
    if (variants.length >= STOCK_MAX_LINES) return;
    setVariants((current) => [
      ...current,
      { key: nextDraftKey(), label: "", sku: "", priceBaht: "", status: "active" },
    ]);
  }

  function removeVariant(index: number) {
    setVariants((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const nextVariantErrors: Record<string, string> = {};

    if (!name.trim()) {
      setError("Enter a product name.");
      document.getElementById("prod-name")?.focus();
      return;
    }

    const payloadVariants: {
      variantId?: Id<"productVariants">;
      label: string;
      sku?: string;
      price: number;
      status?: CatalogueStatus;
    }[] = [];

    let firstInvalidId: string | undefined;
    for (const row of variants) {
      if (!row.label.trim()) {
        nextVariantErrors[row.key] = "Variant label is required.";
        firstInvalidId ??= `var-label-${row.key}`;
        continue;
      }
      const parsedPrice = parseOptionalSatang(row.priceBaht);
      if (!parsedPrice.ok || parsedPrice.value === undefined) {
        nextVariantErrors[row.key] = parsedPrice.ok ? "Enter a selling price in THB." : parsedPrice.error;
        firstInvalidId ??= `var-price-${row.key}`;
        continue;
      }
      payloadVariants.push({
        ...(row.variantId ? { variantId: row.variantId } : {}),
        label: row.label.trim(),
        ...(row.sku.trim() ? { sku: row.sku.trim() } : {}),
        price: parsedPrice.value,
        status: row.status,
      });
    }

    setVariantErrors(nextVariantErrors);
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (payloadVariants.length > STOCK_MAX_LINES) {
      setError(`Keep at most ${STOCK_MAX_LINES} variants. Remove any extra variants added in this draft.`);
      return;
    }
    if (!payloadVariants.some((v) => v.status === "active")) {
      setError("Keep at least one active sellable variant or archive the product.");
      return;
    }
    if (liveDraft) {
      setError("This product changed elsewhere while editing. Review the updated revision above before saving.");
      return;
    }

    setSaving(true);
    try {
      const id = await saveProduct({
        branchId,
        ...(detail ? { productId: detail.product._id, expectedRevision: reviewed.revision ?? detail.product.revision } : {}),
        ...(categoryId ? { categoryId: categoryId as Id<"productCategories"> } : {}),
        name: name.trim(),
        vatProfile,
        variants: payloadVariants,
      });
      onSaved(id);
    } catch (cause) {
      setError(parseStockError(cause, "Could not save this product. Check the fields and try again.").message);
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <>
          <SheetTitle>{detail ? `Edit ${detail.product.name}` : "New product"}</SheetTitle>
          <SheetDescription>
            Set product details, VAT profile, and sellable variants (up to {STOCK_MAX_LINES}).
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel={detail ? "Save product" : "Create product"}
      >
        {review && liveDraft && liveRevision !== undefined ? (
          <Callout tone="warning" title="Review changed fields">
            <p>Revision {reviewed.revision} → {liveRevision}. The review includes new saved values and keeps your draft edits.</p>
            {review.changes.length ? (
              <ul className="mt-2 grid gap-2 text-xs">
                {review.changes.map((change) => {
                  const formatValue = (value: string) => change.key === "category"
                    ? categories.find((category) => category._id === value)?.name ?? (value || "Default")
                    : value || "—";
                  return (
                    <li key={change.key}>
                      <strong>{change.label}</strong>
                      <p>Opened {formatValue(change.opened)} · Latest {formatValue(change.latest)} · Your draft {formatValue(change.draft)}</p>
                      {change.conflict ? (
                        <label className="mt-1 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={useLatest.has(change.key)}
                            onChange={(event) => {
                              const keys = new Set(useLatest);
                              if (event.target.checked) keys.add(change.key);
                              else keys.delete(change.key);
                              setLatestChoices({ revision: liveRevision, keys });
                            }}
                          />
                          Use latest {change.label}
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => applyReview(review.merged)}>Apply review</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyReview(liveDraft)}>Reload live values</Button>
            </div>
          </Callout>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="prod-name">Product name</Label>
            <Input
              id="prod-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Organic Massage Oil"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="prod-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="prod-category">
                <SelectValue placeholder="Default (General)" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat._id} value={cat._id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="prod-vat">VAT profile</Label>
            <Select value={vatProfile} onValueChange={(v) => setVatProfile(v as VatProfile)}>
              <SelectTrigger id="prod-vat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard VAT</SelectItem>
                <SelectItem value="exempt">VAT exempt</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <section aria-label="Variants" className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Sellable variants ({variants.length}/{STOCK_MAX_LINES})
              </h3>
              <p className="text-xs text-muted-foreground">
                Each active variant needs a unique label and optional unique SKU.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={variants.length >= STOCK_MAX_LINES}
              onClick={addVariant}
            >
              <Plus aria-hidden className="size-4" />
              Add variant
            </Button>
          </div>

          <ul className="grid gap-3">
            {variants.map((row, index) => (
              <li key={row.key} className="grid gap-3 rounded-lg border border-border bg-card p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`var-label-${row.key}`}>Variant label</Label>
                    <Input
                      id={`var-label-${row.key}`}
                      value={row.label}
                      onChange={(event) => updateVariant(index, { label: event.target.value })}
                      placeholder="e.g. 250 ml"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`var-sku-${row.key}`}>SKU (optional)</Label>
                    <Input
                      id={`var-sku-${row.key}`}
                      value={row.sku}
                      onChange={(event) => updateVariant(index, { sku: event.target.value })}
                      placeholder="e.g. OIL-250"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`var-price-${row.key}`}>Price (THB)</Label>
                    <NumberField
                      id={`var-price-${row.key}`}
                      prefix="฿"
                      inputMode="decimal"
                      value={row.priceBaht}
                      onChange={(event) => updateVariant(index, { priceBaht: event.target.value })}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Select
                    value={row.status}
                    onValueChange={(v) => updateVariant(index, { status: v as CatalogueStatus })}
                  >
                    <SelectTrigger aria-label="Variant status" className="h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  {!row.variantId && variants.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeVariant(index)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <FieldError id={`var-err-${row.key}`}>{variantErrors[row.key]}</FieldError>
              </li>
            ))}
          </ul>
        </section>
      </SheetForm>
    </EditorSheet>
  );
}

function ProductHistorySheet({
  branchId,
  product,
  onClose,
}: {
  branchId: Id<"branches">;
  product: ProductRow;
  onClose: () => void;
}) {
  const detail = useQuery(api.commerce.stock.getProduct, { branchId, productId: product._id });
  const [selectedVariantId, setSelectedVariantId] = useState<string>("product");

  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.productHistory,
    {
      branchId,
      productId: product._id,
      ...(selectedVariantId !== "product"
        ? { variantId: selectedVariantId as Id<"productVariants"> }
        : {}),
    },
    { initialNumItems: 15 },
  );

  return (
    <EditorSheet
      open
      onClose={onClose}
      header={
        <>
          <SheetTitle>{product.name} · History</SheetTitle>
          <SheetDescription>Edit and archive audit trail for this product and its variants.</SheetDescription>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid gap-1.5">
            <Label htmlFor="history-target">Target</Label>
            <Select value={selectedVariantId} onValueChange={setSelectedVariantId}>
              <SelectTrigger id="history-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="product">Product ({product.name})</SelectItem>
                {(detail?.variants ?? []).map((variant) => (
                  <SelectItem key={variant._id} value={variant._id}>
                    Variant: {variant.label} {variant.sku ? `(${variant.sku})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
                      Revision {entry.revisionAfter} · {entry.actorLabel}
                    </span>
                    <time
                      dateTime={new Date(entry.recordedAt).toISOString()}
                      className="tabular-nums text-muted-foreground"
                    >
                      {staffDateTime(entry.recordedAt)}
                    </time>
                  </div>
                  <dl className="grid gap-1 rounded-md bg-muted/40 p-2.5">
                    {Object.entries(entry.after).map(([field, afterVal]) => (
                      <div key={field} className="flex flex-wrap gap-1.5">
                        <dt className="font-medium text-foreground">{field}:</dt>
                        <dd className="text-muted-foreground">
                          {entry.before[field] !== undefined ? `${String(entry.before[field])} → ` : ""}
                          <span className="text-foreground">{String(afterVal)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
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
