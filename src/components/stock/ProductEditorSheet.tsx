"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { SkeletonRows } from "@/components/admin/admin-bulk";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Callout, EditorSheet, FieldError, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useStockDirtyGuard } from "./StockFormGuard";
import { CATALOGUE_STATUS_META, parseOptionalSatang, parseStockError, STOCK_MAX_LINES } from "./stock-format";
import { reviewProductDraft, type ProductDraft, type VariantDraft } from "./stock-product-draft";
import type { CatalogueStatus } from "./stock-types";

type VatProfile = FunctionArgs<typeof api.commerce.stock.saveProduct>["vatProfile"];
type CategoryRow = FunctionReturnType<typeof api.commerce.stock.listCategories>[number];
type ProductDetail = FunctionReturnType<typeof api.commerce.stock.getProduct>;

let draftKeySeq = 0;
const nextDraftKey = () => `v-${++draftKeySeq}`;

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

export function ProductEditorSheet({
  branchId,
  productId,
  categories,
  onClose,
  onCloseAutoFocus,
  onSaved,
}: {
  branchId: Id<"branches">;
  productId?: Id<"products">;
  categories: readonly CategoryRow[];
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onSaved: (productId: Id<"products">) => void;
}) {
  const detail = useQuery(api.commerce.stock.getProduct, productId ? { branchId, productId } : "skip");

  if (productId && detail === undefined) {
    return (
      <EditorSheet open wide onCloseAutoFocus={onCloseAutoFocus} onClose={onClose} header={<SheetTitle>Loading product…</SheetTitle>}>
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
      onCloseAutoFocus={onCloseAutoFocus}
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
  onCloseAutoFocus,
  onSaved,
}: {
  branchId: Id<"branches">;
  detail: ProductDetail;
  categories: readonly CategoryRow[];
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
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
  const confirm = useConfirm();
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const submitting = useRef(false);
  function toggleVariant(key: string) {
    setExpandedVariants(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
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
    if (submitting.current) return;
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
      setExpandedVariants(current => new Set([...current, ...Object.keys(nextVariantErrors)]));
      requestAnimationFrame(() => document.getElementById(firstInvalidId)?.focus());
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

    submitting.current = true;
    const archived = variants.filter(row => row.status === "archived" &&
      reviewed.draft.variants.find(original => original.key === row.key)?.status !== "archived");
    if (archived.length && !await confirm({
      title: "Archive these variants?",
      description: (
        <>
          <span className="block">Saving will archive these variants and remove them from new purchases.</span>
          <span className="mt-2 block">{archived.map(row => row.sku ? `${row.label} (${row.sku})` : row.label).join(", ")}</span>
        </>
      ),
      confirmLabel: "Archive variants and save",
      destructive: true,
    })) {
      submitting.current = false;
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
    } finally {
      submitting.current = false;
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      onCloseAutoFocus={onCloseAutoFocus}
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
                Each active variant needs a unique label and optional unique SKU. Archive saved variants to preserve their stock and purchase history.
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

          <table className="block w-full sm:table sm:table-fixed">
            <thead className="hidden text-left text-xs text-muted-foreground sm:table-header-group">
              <tr>
                <th scope="col" className="pb-1">Label</th>
                <th scope="col" className="pb-1">SKU</th>
                <th scope="col" className="w-24 pb-1">Price</th>
                <th scope="col" className="w-28 pb-1">Status</th>
                <th scope="col" className="w-12 pb-1"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="grid gap-2 sm:table-row-group">
              {variants.map((row, index) => {
                const label = [row.label || `Variant ${index + 1}`, row.sku].filter(Boolean).join(" · ");
                const expanded = expandedVariants.has(row.key);
                const archived = row.status === "archived";
                const collapsible = Boolean(row.variantId) || archived;
                const error = variantErrors[row.key];
                return (
                  <VariantEditorRows key={row.key} {...{ row, label, expanded, archived, collapsible, error }}
                    canRemove={!row.variantId && variants.length > 1}
                    onToggle={() => toggleVariant(row.key)}
                    index={index}
                    onChange={patch => updateVariant(index, patch)}
                    onRemove={() => removeVariant(index)}
                  />
                );
              })}
            </tbody>
          </table>
        </section>
      </SheetForm>
    </EditorSheet>
  );
}

function VariantEditorRows({
  row, label, expanded, archived, collapsible, error, canRemove, index, onToggle, onChange, onRemove,
}: {
  row: VariantDraft;
  label: string;
  expanded: boolean;
  archived: boolean;
  collapsible: boolean;
  error: string | undefined;
  canRemove: boolean;
  index: number;
  onToggle: () => void;
  onChange: (patch: Partial<VariantDraft>) => void;
  onRemove: () => void;
}) {
  const cell = "grid min-w-0 gap-1 sm:table-cell sm:py-1 sm:pr-2";
  return (
    <>
      {collapsible ? (
        <tr className={cn("block", archived ? "text-muted-foreground sm:table-row" : "sm:hidden")}>
          <td colSpan={5} className="block sm:table-cell">
            <button type="button" aria-expanded={expanded} onClick={onToggle}
              className="min-h-11 w-full rounded border px-3 text-left text-sm font-medium">
              {label} · {CATALOGUE_STATUS_META[row.status].label} · {row.priceBaht ? `฿${row.priceBaht}` : "No price"}
            </button>
          </td>
        </tr>
      ) : null}
      <tr className={cn(
        "grid gap-2 rounded-lg border p-3 sm:border-0 sm:p-0",
        collapsible && !expanded && "hidden",
        archived ? expanded && "sm:table-row" : "sm:table-row",
      )}>
        <td className={cell}>
          <Label className="sm:sr-only" htmlFor={`var-label-${row.key}`}>Variant label</Label>
          <Input id={`var-label-${row.key}`} value={row.label} onChange={event => onChange({ label: event.target.value })} />
        </td>
        <td className={cell}>
          <Label className="sm:sr-only" htmlFor={`var-sku-${row.key}`}>SKU (optional)</Label>
          <Input id={`var-sku-${row.key}`} value={row.sku} onChange={event => onChange({ sku: event.target.value })} />
        </td>
        <td className={cell}>
          <Label className="sm:sr-only" htmlFor={`var-price-${row.key}`}>Price (THB)</Label>
          <NumberField id={`var-price-${row.key}`} prefix="฿" inputMode="decimal" value={row.priceBaht}
            onChange={event => onChange({ priceBaht: event.target.value })} />
        </td>
        <td className={cell}>
          <Select value={row.status} onValueChange={value => onChange({ status: value as CatalogueStatus })}>
            <SelectTrigger aria-label={`Status for ${label}, row ${index + 1}`} className="min-h-11 w-full text-xs">
              <SelectValue>{CATALOGUE_STATUS_META[row.status].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              {row.status === "draft" && <SelectItem value="draft" disabled>Draft</SelectItem>}
              <SelectItem value="archived">Archive variant</SelectItem>
            </SelectContent>
          </Select>
        </td>
        <td className={cell}>
          {canRemove ? <MoreMenu label={`Actions for ${label}`} items={[{ label: "Remove", onSelect: onRemove }]} /> : null}
        </td>
      </tr>
      {error ? <tr className="block sm:table-row"><td colSpan={5}><FieldError id={`var-err-${row.key}`}>{error}</FieldError></td></tr> : null}
    </>
  );
}
