"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Package, Plus } from "lucide-react";
import { useDeferredValue, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_QTY } from "convex/shared/orderMath";
import type { Run } from "./useOrderWrites";
import { useCommerceCopy } from "./commerce-copy";

type Variant = FunctionReturnType<typeof api.pos.retail.browse>["page"][number];

export default function CheckoutProducts({ orderBranchId, preferredBranchId, busy, run }: {
  orderBranchId?: Id<"branches">;
  preferredBranchId?: Id<"branches">;
  busy: boolean;
  run: Run;
}) {
  const { t } = useCommerceCopy();
  const branches = useQuery(api.pos.retail.branches, {});
  const [chosen, setChosen] = useState<Id<"branches">>();
  const selected = branches?.find(branch => branch.branchId === (orderBranchId ?? chosen ?? preferredBranchId)) ?? (!orderBranchId ? branches?.[0] : undefined);
  const branchId = selected?.branchId;
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const variants = usePaginatedQuery(api.pos.retail.browse, branchId ? { branchId, search: query } : "skip", { initialNumItems: 24 });
  const add = useMutation(api.pos.retail.add);
  const branchLabel = useId();

  if (branches === undefined) return <p role="status" className="text-sm text-muted-foreground">{t("retail.loadingBranches")}</p>;
  if (!selected) return <p role="status" className="text-sm text-muted-foreground">{orderBranchId ? t("retail.orderBranchUnavailable") : t("retail.noBranch")}</p>;

  return (
    <section aria-label={t("kinds.products")} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor={branchLabel}>{t("retail.branch")}</Label>
          {orderBranchId ? <p id={branchLabel} className="flex min-h-11 items-center rounded-md border px-3 text-sm">{selected.name}</p> : (
            <select id={branchLabel} className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={selected.branchId} disabled={busy} onChange={event => {
              const next = branches.find(branch => branch.branchId === event.target.value);
              if (next) setChosen(next.branchId);
            }}>
              {branches.map(branch => <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>)}
            </select>
          )}
        </div>
        <div className="grid gap-1.5"><Label htmlFor={`${branchLabel}-search`}>{t("retail.search")}</Label><Input id={`${branchLabel}-search`} type="search" className="min-h-11" placeholder={t("retail.searchPlaceholder")} value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></div>
      </div>
      {variants.status === "LoadingFirstPage" ? <p role="status" className="text-sm text-muted-foreground">{t("retail.loading")}</p> : null}
      {variants.status === "Exhausted" && !variants.results.length ? <p role="status" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("retail.noResults")}</p> : null}
      <div className="grid gap-2 @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-3">
        {variants.results.map(variant => (
          <ProductTile key={`${selected.branchId}:${variant.variantId}`} variant={variant} busy={busy} add={async (quantity, clientKey) =>
            await run(orderId => add({ branchId: selected.branchId, orderId, variantId: variant.variantId, expectedPrice: variant.price, quantity, clientKey }))} />
        ))}
      </div>
      {variants.status === "CanLoadMore" || variants.status === "LoadingMore" ? <Button type="button" variant="outline" className="min-h-11 justify-self-start" disabled={variants.status === "LoadingMore"} onClick={() => variants.loadMore(24)}>{t("retail.loadMore")}</Button> : null}
    </section>
  );
}

function ProductTile({ variant, busy, add }: { variant: Variant; busy: boolean; add(quantity: number, clientKey: string): Promise<boolean> }) {
  const { t, money } = useCommerceCopy();
  const [quantity, setQuantity] = useState("1");
  const intent = useRef<{ quantity: number; price: number; key: string } | null>(null);
  const sending = useRef(false);
  const count = Number(quantity);
  const valid = Number.isSafeInteger(count) && count > 0 && count <= MAX_QTY;
  const name = variant.label === variant.productName ? variant.productName : `${variant.productName} · ${variant.label}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sending.current || !valid) return;
    sending.current = true;
    if (intent.current?.quantity !== count || intent.current.price !== variant.price) {
      intent.current = { quantity: count, price: variant.price, key: crypto.randomUUID() };
    }
    try {
      if (await add(count, intent.current.key)) {
        intent.current = null;
        setQuantity("1");
      }
    } finally {
      sending.current = false;
    }
  }

  return (
    <form onSubmit={event => void submit(event)} className="grid min-w-0 gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2"><Package aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="min-w-0 break-words text-sm font-medium">{name}</p></div>
      <p className="text-xs text-muted-foreground">{variant.sku ? `${variant.sku} · ` : ""}{t("retail.onHand", { count: variant.onHand })}{variant.needsRecount ? ` · ${t("stock.states.needsRecount")}` : ""}</p>
      <p className="text-sm font-medium tabular-nums">{money(variant.price)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" min={1} max={MAX_QTY} step={1} inputMode="numeric" aria-label={t("retail.quantityFor", { name })} className="min-h-11 w-16" value={quantity} disabled={busy} onChange={event => setQuantity(event.target.value)} />
        <Button type="submit" className="min-h-11 flex-1" disabled={busy || !valid} aria-label={t("retail.addNamed", { name })}><Plus aria-hidden className="size-4" /> {t("retail.add")}</Button>
      </div>
    </form>
  );
}
