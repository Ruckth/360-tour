"use client";

import { ChevronDown, Info, Plus, Search, SlidersHorizontal, Star } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MAX_PRICE } from "convex/lib/billMath";
import type { Catalog, CatalogItem, OrderLine } from "./backend";
import { CHECKOUT_LAYER, CHECKOUT_THEME, amountInput } from "./checkout-ui";
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
  description?: string;
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
    price: s.price, currency: s.currency, description: s.description, imageUrl: s.imageUrl, item: { kind: "service", serviceId: s._id },
  }));
  const rooms: Tile[] = catalog.rooms.map((r) => ({
    key: `room:${r._id}`, kind: "room", name: r.name, group: "Villas", meta: `per night · up to ${r.maxGuests} guests`,
    price: r.price, currency: r.currency, description: r.tagline || undefined, imageUrl: r.imageUrl, item: { kind: "room", propertyId: r._id },
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

/**
 * Left side of checkout: tabs by type, search and filters, then the items in collapsible groups
 * of photo tiles that add on tap. Columns follow the pane's own width (1, 2, then 3), not the
 * window's, since the order panel beside it takes a share.
 */
export function CatalogPane({
  catalog,
  lines,
  onAdd,
  className,
}: {
  catalog: Catalog | undefined;
  lines: readonly OrderLine[];
  onAdd: (item: CatalogItem) => void;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("frequent");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [maxPrice, setMaxPrice] = useState("");
  // Groups folded by hand, per tab ("services:Massage"); search and filters keep them folded, with their count.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const ids = useId();

  const tiles = useMemo(() => (catalog ? catalogTiles(catalog)[tab] : []), [catalog, tab]);
  const tabGroups = useMemo(() => [...new Set(tiles.map((t) => t.group))], [tiles]);
  const activeGroups = groups.filter((g) => tabGroups.includes(g));
  const priceCap = Number(maxPrice) > 0 ? Number(maxPrice) : Infinity;
  const text = search.trim().toLowerCase();
  const shown = tiles.filter(
    (t) => (!text || t.name.toLowerCase().includes(text)) && (!activeGroups.length || activeGroups.includes(t.group)) && t.price <= priceCap,
  );
  const sections = tabGroups.map((group) => ({ group, tiles: shown.filter((t) => t.group === group) })).filter((s) => s.tiles.length);
  const filterCount = activeGroups.length + (priceCap < Infinity ? 1 : 0);

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

  return (
    <section aria-label="Catalog" className={cn("@container flex min-h-0 flex-col", className)}>
      <div className="flex flex-col gap-3 px-4 pt-2 pb-3 sm:px-6 @3xl:flex-row @3xl:items-end @3xl:gap-6">
        <SegmentedTabs
          tabs={TABS}
          value={tab}
          onValueChange={setTab}
          label="Item type"
          controls="checkout-catalog"
          className="shrink-0 gap-7 border-border/70 [&_[aria-selected=true]]:border-gold [&_[role=tab]]:pt-2"
        />
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items"
              aria-label="Search items"
              className="h-11 rounded-xl bg-card/60 pl-10 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          {/* The button is the sheet's trigger, so closing the sheet puts focus back on it. */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="h-11 rounded-xl bg-card/60 px-3 sm:px-4" aria-label={`Filters${filterCount ? ` (${filterCount} on)` : ""}`}>
                <SlidersHorizontal aria-hidden className="size-4" />
                <span className="hidden sm:inline">Filters</span>
                {filterCount ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{filterCount}</span> : null}
              </Button>
            </SheetTrigger>
            <SheetContent overlayClassName={CHECKOUT_THEME} side="right" className={cn("w-80", CHECKOUT_LAYER)}>
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>Narrow the {TABS.find((t) => t.value === tab)?.label.toLowerCase()} tab.</SheetDescription>
              </SheetHeader>
              <div className="space-y-2">
                <p className="text-sm font-medium">Group</p>
                <div className="flex flex-wrap gap-2">
                  {tabGroups.map((group) => {
                    const on = activeGroups.includes(group);
                    return (
                      <button
                        key={group}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setGroups(on ? groups.filter((g) => g !== group) : [...groups, group])}
                        className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
                      >
                        {group}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-max-price">Price up to (฿)</Label>
                <Input id="checkout-max-price" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(amountInput(e.target.value, MAX_PRICE))} placeholder="Any price" />
              </div>
              <Button variant="outline" onClick={() => { setGroups([]); setMaxPrice(""); }} disabled={!filterCount}>Reset filters</Button>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <div id="checkout-catalog" className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-28 sm:px-6 lg:pb-6">
        {tab === "rooms" ? (
          <p className="mb-4 rounded-xl border border-border/70 bg-card/50 p-3 text-sm text-muted-foreground">
            Room items record charges only. To reserve dates, create a booking and add it to the order.
          </p>
        ) : null}
        {!catalog ? (
          <div role="status" aria-label="Loading items" className="grid grid-cols-1 gap-2.5 @min-[34rem]:grid-cols-2 @min-[53rem]:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[88px] animate-pulse rounded-xl bg-card/70 motion-reduce:animate-none" />)}
          </div>
        ) : (
          <>
            {sections.map(({ group, tiles: groupTiles }, index) => {
              const key = `${tab}:${group}`;
              const open = !folded.has(key);
              const panelId = `${ids}-group-${index}`;
              const Icon = tab === "frequent" ? Star : KIND_ICONS[groupTiles[0].kind];
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
                  <div id={panelId} hidden={!open} className={cn("mt-1 grid-cols-1 gap-2.5 @min-[34rem]:grid-cols-2 @min-[53rem]:grid-cols-3 @min-[84rem]:grid-cols-4", open ? "grid" : "hidden")}>
                    {groupTiles.map((tile) => <CatalogTile key={tile.key} tile={tile} count={onOrder.get(tile.key) ?? 0} onAdd={onAdd} />)}
                  </div>
                </div>
              );
            })}
            {!sections.length && (tab !== "extras" || text || filterCount) ? (
              <div className="grid justify-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <p>{text || filterCount ? "Nothing matches the search or filters." : "Nothing to sell here yet."}</p>
                {text || filterCount ? (
                  <Button variant="outline" size="sm" onClick={() => { setSearch(""); setGroups([]); setMaxPrice(""); }}>
                    Clear search and filters
                  </Button>
                ) : null}
              </div>
            ) : null}
            {tab === "extras" ? <CustomItemDialog onAdd={onAdd} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function CatalogTile({ tile, count, onAdd }: { tile: Tile; count: number; onAdd: (item: CatalogItem) => void }) {
  const price = formatMoney(tile.price, tile.currency);
  return (
    <div className="relative h-full">
      <button
        type="button"
        onClick={() => onAdd(tile.item)}
        className="group flex h-full min-h-[72px] w-full items-stretch gap-3 rounded-xl border border-border/70 bg-card/70 p-2 text-left @min-[34rem]:min-h-[88px] transition hover:border-gold/60 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span className="relative shrink-0">
          <CheckoutPhoto src={tile.imageUrl} kind={tile.kind} className="h-full min-h-14 w-14 @min-[34rem]:min-h-[72px] @min-[34rem]:w-[72px] @min-[53rem]:w-20" />
          {count ? (
            <span className="absolute -top-1.5 -left-1.5 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] leading-5 font-semibold text-primary-foreground shadow">
              {count}<span className="sr-only"> on the order</span>
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col py-0.5">
          <span className={cn("line-clamp-2 text-sm leading-snug font-semibold [overflow-wrap:anywhere]", tile.description && "pr-7")}>{tile.name}</span>
          <span className="mt-0.5 truncate text-xs text-muted-foreground">{tile.meta}</span>
          <span className="mt-auto flex items-end justify-between gap-2 pt-1 @min-[34rem]:pt-1.5">
            <span className="text-sm font-semibold tabular-nums">{price}</span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/70 text-gold-text transition group-hover:bg-gold group-hover:text-primary-foreground motion-reduce:transition-none">
              <Plus aria-hidden className="size-4" />
              <span className="sr-only">Add to order</span>
            </span>
          </span>
        </span>
      </button>
      {tile.description ? (
        <Popover>
          <PopoverTrigger asChild>
            {/* A bigger hit area in the corner (44px on touch screens); the visible icon stays small. */}
            <button type="button" aria-label={`About ${tile.name}`} className="group absolute top-0 right-0 flex size-9 items-start justify-end p-1.5 text-muted-foreground hover:text-foreground pointer-coarse:size-11">
              <span className="rounded-full p-1 group-hover:bg-muted"><Info aria-hidden className="size-3.5" /></span>
            </button>
          </PopoverTrigger>
          <PopoverContent className={cn("w-64 text-sm", CHECKOUT_THEME)}>
            <p className="font-semibold">{tile.name}</p>
            <p className="mt-1 text-muted-foreground">{tile.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">{tile.meta} · {price}</p>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

/** The Custom item tile on the Extras tab and its form; the tile is the trigger, so focus returns to it. */
function CustomItemDialog({ onAdd }: { onAdd: (item: CatalogItem) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const valid = name.trim() && price !== "" && Number(price) >= 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onAdd({ kind: "extra", name: name.trim(), price: Number(price) });
    setName("");
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
          Custom item
        </button>
      </DialogTrigger>
      <DialogContent overlayClassName={CHECKOUT_THEME} className={cn("max-w-sm", CHECKOUT_LAYER)}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Custom item</DialogTitle>
            <DialogDescription>A one-off item that isn&apos;t in the catalog. Same name and price stack into a quantity.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="custom-item-name">Name</Label>
            <Input id="custom-item-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custom-item-price">Price (฿, VAT included)</Label>
            <Input id="custom-item-price" inputMode="decimal" value={price} onChange={(e) => setPrice(amountInput(e.target.value, MAX_PRICE))} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid}>Add to order</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
