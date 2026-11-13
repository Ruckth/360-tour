"use client";

import { ChevronDown, Plus, Search } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MAX_PRICE } from "convex/lib/billMath";
import type { Catalog, CatalogItem, OrderLine } from "./backend";
import { amountInput } from "./checkout-ui";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { CheckoutPhoto, KIND_ICONS } from "./CheckoutPhoto";

type Tab = "frequent" | "services" | "rooms" | "extras";
type Tile = {
  key: string;
  kind: CatalogItem["kind"];
  name: string;
  group: string;
  meta: string;
  price: number;
  currency: string;
  imageUrl?: string;
  item: CatalogItem;
};

const TABS: { value: Tab; label: string }[] = [
  { value: "frequent", label: "Frequent" },
  { value: "services", label: "Spa" },
  { value: "rooms", label: "Rooms" },
  { value: "extras", label: "Extras" },
];

/** What a section header counts, e.g. "5 services"; a mixed section (Frequent) counts items. */
const NOUNS: Record<Tile["kind"], [string, string]> = { service: ["service", "services"], room: ["room", "rooms"], extra: ["item", "items"] };

export function sectionCount(tiles: readonly Pick<Tile, "kind">[]) {
  const kinds = new Set(tiles.map((t) => t.kind));
  const [one, many] = kinds.size === 1 ? NOUNS[tiles[0].kind] : NOUNS.extra;
  return `${tiles.length} ${tiles.length === 1 ? one : many}`;
}

function catalogTiles(catalog: Catalog) {
  const services: Tile[] = catalog.services.map((s) => ({
    key: `service:${s._id}`, kind: "service", name: s.name, group: s.category || "Services", meta: `${s.durationMin} min`,
    price: s.price, currency: s.currency, imageUrl: s.imageUrl, item: { kind: "service", serviceId: s._id },
  }));
  const rooms: Tile[] = catalog.rooms.map((r) => ({
    key: `room:${r._id}`, kind: "room", name: r.name, group: "Villas", meta: `per night · up to ${r.maxGuests} guests`,
    price: r.price, currency: r.currency, imageUrl: r.imageUrl, item: { kind: "room", propertyId: r._id },
  }));
  const extras: Tile[] = catalog.extras.map((x) => ({
    key: `extra:${x.name}`, kind: "extra", name: x.name, group: x.category, meta: "each",
    price: x.price, currency: "THB", item: { kind: "extra", name: x.name, price: x.price },
  }));
  const all = new Map([...services, ...rooms, ...extras].map((tile) => [tile.key, tile]));
  const ranked = catalog.frequent.flatMap((key) => all.get(key) ?? []);
  // Until something has been sold, Frequent shows the first services.
  const frequent = (ranked.length ? ranked : services.slice(0, 8)).map((tile) => ({ ...tile, group: "Frequent" }));
  return { frequent, services, rooms, extras } satisfies Record<Tab, Tile[]>;
}

/** Tiles whose name matches the search, from every tab; Frequent repeats the others, so it is left out. */
export function searchTiles<T extends { name: string }>(tabs: { services: T[]; rooms: T[]; extras: T[] }, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  return [...tabs.services, ...tabs.rooms, ...tabs.extras].filter((tile) => tile.name.toLowerCase().includes(text));
}

/**
 * Left side of checkout: tabs by type and one search over every tab, then photo tiles that add on
 * tap. Spa, Rooms and Extras fold by group; Frequent and search results are one flat list. Columns
 * follow the pane's own width (1, 2, then 3), not the window's, since the order panel beside it
 * takes a share.
 */
export function CatalogPane({
  catalog,
  lines,
  onAdd,
  customNeedsManager = false,
  className,
}: {
  catalog: Catalog | undefined;
  lines: readonly OrderLine[];
  onAdd: (item: CatalogItem) => void;
  /** A cashier whose custom items need a manager: the custom item form asks instead of adding. */
  customNeedsManager?: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("frequent");
  const [search, setSearch] = useState("");
  // Groups folded by hand, per tab ("services:Massage").
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const ids = useId();

  const all = useMemo(() => (catalog ? catalogTiles(catalog) : null), [catalog]);
  const query = search.trim();
  const searching = query.length > 0;
  const tiles = all ? (searching ? searchTiles(all, query) : all[tab]) : [];
  const flat = searching || tab === "frequent";
  const sections = flat
    ? []
    : [...new Set(tiles.map((t) => t.group))].map((group) => ({ group, tiles: tiles.filter((t) => t.group === group) }));

  // How many of each tile are on the order, shown as a badge.
  const onOrder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      const key = line.kind === "service" ? `service:${line.serviceId}` : line.kind === "room" ? `room:${line.propertyId}` : line.kind === "extra" ? `extra:${line.name}` : "";
      if (key) counts.set(key, (counts.get(key) ?? 0) + line.qty);
    }
    return counts;
  }, [lines]);

  const toggleGroup = (key: string) => setFolded((prev) => {
    const next = new Set(prev);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const grid = "grid-cols-1 gap-2.5 @min-[34rem]:grid-cols-2 @min-[53rem]:grid-cols-3 @min-[84rem]:grid-cols-4";

  return (
    <section aria-label="Catalog" className={cn("@container flex min-h-0 flex-col", className)}>
      <div className="flex flex-col gap-3 px-4 pt-2 pb-3 sm:px-6 @3xl:flex-row @3xl:items-end @3xl:gap-6">
        <SegmentedTabs
          tabs={TABS}
          value={tab}
          onValueChange={(next) => { setTab(next); setSearch(""); }}
          label="Item type"
          controls="checkout-catalog"
          className="shrink-0 gap-7 border-border/70 [&_[aria-selected=true]]:border-gold-text [&_[role=tab]]:pt-2"
        />
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all items"
            aria-label="Search all items"
            className="h-11 rounded-xl bg-card/60 pl-10 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      </div>

      <div id="checkout-catalog" className="min-h-[min(16rem,40dvh)] flex-1 scroll-pb-28 overflow-y-auto px-4 pt-1 pb-28 sm:px-6 lg:scroll-pb-6 lg:pb-6">
        {tab === "rooms" && !searching ? (
          <p className="mb-4 rounded-xl border border-border/70 bg-card/50 p-3 text-sm text-muted-foreground">
            Room items record charges only. To reserve dates, create a booking and add it to the order.
          </p>
        ) : null}
        {!catalog ? (
          <div role="status" aria-label="Loading items" className={cn("grid", grid)}>
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[88px] animate-pulse rounded-xl bg-card/70 motion-reduce:animate-none" />)}
          </div>
        ) : (
          <>
            {flat && tiles.length ? (
              <div className={cn("grid", grid)} aria-label={searching ? `Results for ${query}` : undefined} role={searching ? "group" : undefined}>
                {tiles.map((tile) => <CatalogTile key={tile.key} tile={tile} count={onOrder.get(tile.key) ?? 0} onAdd={onAdd} />)}
              </div>
            ) : null}
            {flat ? null : sections.map(({ group, tiles: groupTiles }, index) => {
              const key = `${tab}:${group}`;
              const open = !folded.has(key);
              const panelId = `${ids}-group-${index}`;
              const Icon = KIND_ICONS[groupTiles[0].kind];
              return (
                <div key={group} className="mb-3">
                  <h3>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => toggleGroup(key)}
                      className="group/head flex min-h-11 w-full items-center gap-3 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-gold-text" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-[0.2em] text-foreground uppercase">{group}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{sectionCount(groupTiles)}</span>
                      <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none group-hover/head:text-foreground", !open && "-rotate-90")} />
                    </button>
                  </h3>
                  <div id={panelId} hidden={!open} className={cn("mt-1", grid, open ? "grid" : "hidden")}>
                    {groupTiles.map((tile) => <CatalogTile key={tile.key} tile={tile} count={onOrder.get(tile.key) ?? 0} onAdd={onAdd} />)}
                  </div>
                </div>
              );
            })}
            {searching && !tiles.length ? (
              <div className="grid justify-items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                <p>No item matches “{query}”.</p>
                <CustomItemDialog key={query} onAdd={onAdd} needsManager={customNeedsManager} initialName={query} label="Add as custom item" />
              </div>
            ) : null}
            {!searching && !tiles.length && tab !== "extras" ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nothing to sell here yet.</p>
            ) : null}
            {tab === "extras" && !searching ? <CustomItemDialog onAdd={onAdd} needsManager={customNeedsManager} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function CatalogTile({ tile, count, onAdd }: { tile: Tile; count: number; onAdd: (item: CatalogItem) => void }) {
  const price = formatMoney(tile.price, tile.currency);
  return (
    <button
      type="button"
      onClick={() => onAdd(tile.item)}
      className="group flex h-full min-h-[72px] w-full flex-wrap items-stretch gap-3 rounded-xl border border-border/70 bg-card/70 p-2 text-left @min-[34rem]:min-h-[88px] transition hover:border-gold/60 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <span className="relative shrink-0">
        <CheckoutPhoto src={tile.imageUrl} kind={tile.kind} className="h-full min-h-14 w-14 @min-[34rem]:min-h-[72px] @min-[34rem]:w-[72px] @min-[53rem]:w-20" />
        {count ? (
          <span className="absolute -top-1.5 -left-1.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs leading-5 font-semibold text-primary-foreground shadow">
            {count}<span className="sr-only"> on the order</span>
          </span>
        ) : null}
      </span>
      <span className="flex min-w-[min(100%,8rem)] flex-1 flex-col py-0.5">
        <span className="line-clamp-2 text-sm leading-snug font-semibold [overflow-wrap:anywhere]">{tile.name}</span>
        <span className="mt-0.5 truncate text-xs text-muted-foreground">{tile.meta}</span>
        <span className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-1 @min-[34rem]:pt-1.5">
          <span className="text-sm font-semibold tabular-nums">{price}</span>
          {/* Gold fill on hover takes accent-foreground: primary-foreground is cream in light mode. */}
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/70 text-gold-text transition group-hover:border-accent group-hover:bg-accent group-hover:text-accent-foreground motion-reduce:transition-none">
            <Plus aria-hidden className="size-4" />
            <span className="sr-only">Add to order</span>
          </span>
        </span>
      </span>
    </button>
  );
}

/**
 * A one-off item and its form. On the Extras tab the trigger is the Custom item tile; when a search
 * finds nothing it reads "Add as custom item" and starts with the search as the name. The trigger
 * is the dialog's, so closing it puts focus back on it.
 */
function CustomItemDialog({ onAdd, needsManager, initialName = "", label = "Custom item" }: { onAdd: (item: CatalogItem) => void; needsManager: boolean; initialName?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState("");
  const valid = name.trim() && price !== "" && Number(price) >= 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onAdd({ kind: "extra", name: name.trim(), price: Number(price) });
    setName(initialName);
    setPrice("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mt-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-2 text-left text-sm font-semibold text-muted-foreground transition hover:border-gold/70 hover:text-foreground sm:w-auto sm:pr-6"
        >
          <span className="flex size-12 items-center justify-center rounded-lg bg-muted text-gold-text"><Plus aria-hidden className="size-5" /></span>
          {label}
        </button>
      </DialogTrigger>
      {/* Held inside the screen and scrolled within, so enlarged text never pushes Close or the actions off it.
          On a narrow phone with enlarged text the padding stops growing past 7.5% of the width, and in a
          narrow form the heading starts below the corner Close button instead of running under it. */}
      <CheckoutDialogContent className="max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto overscroll-contain p-[min(1.5rem,7.5vw)]">
        <form onSubmit={submit} className="@container grid min-w-0 gap-4">
          <DialogHeader className="@max-[14rem]:pt-8">
            <DialogTitle>Custom item</DialogTitle>
            <DialogDescription>A one-off item that isn&apos;t in the catalog. Same name and price stack into a quantity.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="custom-item-name">Name</Label>
            <Input id="custom-item-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus={!initialName} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custom-item-price">Price (฿, VAT included)</Label>
            <Input id="custom-item-price" inputMode="decimal" value={price} onChange={(e) => setPrice(amountInput(e.target.value, MAX_PRICE))} autoFocus={Boolean(initialName)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={!valid}>{needsManager ? "Ask manager" : "Add to order"}</Button>
          </DialogFooter>
        </form>
      </CheckoutDialogContent>
    </Dialog>
  );
}
