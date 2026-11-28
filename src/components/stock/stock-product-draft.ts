import type { Id } from "convex/_generated/dataModel";
import type { CatalogueStatus } from "./stock-types";
import { parseOptionalSatang } from "./stock-format";

export type VariantDraft = {
  key: string;
  variantId?: Id<"productVariants">;
  label: string;
  sku: string;
  priceBaht: string;
  status: CatalogueStatus;
};

export type ProductDraft = {
  name: string;
  categoryId: string;
  vatProfile: "standard" | "exempt";
  variants: VariantDraft[];
};

type FieldChange = {
  key: string;
  label: string;
  opened: string;
  latest: string;
  draft: string;
  conflict: boolean;
};

function priceValue(value: string) {
  const parsed = parseOptionalSatang(value);
  return parsed.ok && parsed.value !== undefined ? String(parsed.value) : value.trim();
}

export function reviewProductDraft(
  opened: ProductDraft,
  latest: ProductDraft,
  draft: ProductDraft,
  useLatest: ReadonlySet<string>,
): { merged: ProductDraft; changes: FieldChange[] } {
  const changes: FieldChange[] = [];
  function reviewField<T extends string>(
    key: string,
    label: string,
    openedValue: T,
    latestValue: T,
    draftValue: T,
    normalize: (value: T) => string = (value) => value.trim(),
  ): T {
    const localChange = normalize(draftValue) !== normalize(openedValue);
    const remoteChange = normalize(latestValue) !== normalize(openedValue);
    if (localChange || remoteChange) {
      changes.push({
        key, label, opened: openedValue, latest: latestValue, draft: draftValue,
        conflict: localChange && remoteChange && normalize(draftValue) !== normalize(latestValue),
      });
    }
    return localChange && !useLatest.has(key) ? draftValue : latestValue;
  }

  const merged: ProductDraft = {
    name: reviewField("name", "Product name", opened.name, latest.name, draft.name),
    categoryId: reviewField("category", "Category", opened.categoryId, latest.categoryId, draft.categoryId),
    vatProfile: reviewField("vat", "VAT profile", opened.vatProfile, latest.vatProfile, draft.vatProfile),
    variants: [],
  };

  const openedByKey = new Map(opened.variants.map((variant) => [variant.key, variant]));
  const draftByKey = new Map(draft.variants.map((variant) => [variant.key, variant]));
  const latestKeys = new Set(latest.variants.map((variant) => variant.key));

  for (const live of latest.variants) {
    const base = openedByKey.get(live.key);
    if (!base) {
      reviewField(live.key, `Variant ${live.label}`, "", "Added", "");
      merged.variants.push(live);
      continue;
    }
    const local = draftByKey.get(live.key) ?? base;
    merged.variants.push({
      ...live,
      label: reviewField(`${live.key}-label`, `${base.label} label`, base.label, live.label, local.label),
      sku: reviewField(`${live.key}-sku`, `${base.label} SKU`, base.sku, live.sku, local.sku),
      priceBaht: reviewField(`${live.key}-price`, `${base.label} price (THB)`, base.priceBaht, live.priceBaht, local.priceBaht, priceValue),
      status: reviewField(`${live.key}-status`, `${base.label} status`, base.status, live.status, local.status),
    });
  }
  for (const base of opened.variants) {
    if (base.variantId && !latestKeys.has(base.key)) {
      changes.push({
        key: base.key,
        label: `Variant ${base.label}`,
        opened: base.label,
        latest: "Unavailable",
        draft: draftByKey.get(base.key)?.label ?? "",
        conflict: false,
      });
    }
  }
  for (const local of draft.variants) {
    if (local.variantId) continue;
    reviewField(local.key, `Variant ${local.label || "(untitled)"}`, "", "", "Added");
    merged.variants.push(local);
  }
  return { merged, changes };
}
