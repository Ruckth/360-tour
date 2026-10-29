"use client";

import { BedDouble, Info, Package, Plus, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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
import { TOUCH_TARGETS, amountInput } from "./checkout-ui";

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
  item: CatalogItem;
};

const TABS: { value: Tab; label: string }[] = [
  { value: "frequent", label: "Frequent" },
  { value: "services", label: "Spa" },
  { value: "rooms", label: "Rooms" },
  { value: "extras", label: "Extras" },
];

const THUMBS = {
  service: { icon: Sparkles, className: "bg-teal-100 text-teal-800 dark:bg-teal-400/15 dark:text-teal-200" },
  room: { icon: BedDouble, className: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200" },
  extra: { icon: Package, className: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200" },
} as const;

function catalogTiles(catalog: Catalog) {
  const services: Tile[] = catalog.services.map((s) => ({
    key: `service:${s._id}`, kind: "service", name: s.name, group: s.category || "Services", meta: `${s.durationMin} min`,
    price: s.price, currency: s.currency, description: s.description, item: { kind: "service", serviceId: s._id },
  }));
  const rooms: Tile[] = catalog.rooms.map((r) => ({
    key: `room:${r._id}`, kind: "room", name: r.name, group: "Villas", meta: "per night",
    price: r.price, currency: r.currency, description: `${r.tagline} · up to ${r.maxGuests} guests`, item: { kind: "room", propertyId: r._id },
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

/** Left side of checkout: tabs by type, search, filters, and a grid of tiles that add on tap. */
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

  return (
    <section aria-label="Catalog" className={cn("flex min-h-0 flex-col", className)}>
      <div className="space-y-3 border-b border-border px-4 pt-3 pb-3 sm:px-6">
        <SegmentedTabs tabs={TABS} value={tab} onValueChange={setTab} label="Item type" controls="checkout-catalog" />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" aria-label="Search items" className="pl-9" />
          </div>
          {/* The button is the sheet's trigger, so closing the sheet puts focus back on it. */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" aria-label={`Filters${filterCount ? ` (${filterCount} on)` : ""}`}>
                <SlidersHorizontal aria-hidden className="size-4" />
                <span className="hidden sm:inline">Filters</span>
                {filterCount ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{filterCount}</span> : null}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className={cn("w-80", TOUCH_TARGETS)}>
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

      <div id="checkout-catalog" className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-28 sm:px-6 lg:pb-6">
        {tab === "rooms" ? (
          <p className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Room items record charges only. To reserve dates, create a booking and add it to the order.
          </p>
        ) : null}
        {!catalog ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[68px] animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : (
          <>
            {sections.map(({ group, tiles: groupTiles }) => (
              <div key={group} className="mb-4">
                <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {groupTiles.map((tile) => <CatalogTile key={tile.key} tile={tile} count={onOrder.get(tile.key) ?? 0} onAdd={onAdd} />)}
                </div>
              </div>
            ))}
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
  const thumb = THUMBS[tile.kind];
  const Icon = thumb.icon;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onAdd(tile.item)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-card p-2 text-left transition sm:gap-3 hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
      >
        <span className={cn("relative flex size-10 shrink-0 items-center justify-center rounded-lg sm:size-12", thumb.className)}>
          <Icon aria-hidden className="size-5" />
          {count ? (
            <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] leading-5 font-semibold text-primary-foreground">
              {count}<span className="sr-only"> on the order</span>
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("line-clamp-3 text-sm leading-tight font-semibold", tile.description && "pr-5")}>{tile.name}</span>
          <span className="mt-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{tile.meta}</span>
            <span className="font-semibold text-foreground tabular-nums">{formatMoney(tile.price, tile.currency)}</span>
          </span>
        </span>
      </button>
      {tile.description ? (
        <Popover>
          <PopoverTrigger asChild>
            {/* A bigger hit area in the corner (44px on touch screens); the visible icon stays small. */}
            <button type="button" aria-label={`About ${tile.name}`} className="group absolute top-0 right-0 flex size-8 items-start justify-end p-1 text-muted-foreground hover:text-foreground pointer-coarse:size-11">
              <span className="rounded-full p-1 group-hover:bg-muted"><Info aria-hidden className="size-3.5" /></span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 text-sm">
            <p className="font-semibold">{tile.name}</p>
            <p className="mt-1 text-muted-foreground">{tile.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">{tile.meta} · {formatMoney(tile.price, tile.currency)}</p>
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
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-2 text-left text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-foreground sm:w-auto sm:pr-6"
        >
          <span className="flex size-12 items-center justify-center rounded-lg bg-muted"><Plus aria-hidden className="size-5" /></span>
          Custom item
        </button>
      </DialogTrigger>
      <DialogContent className={cn("max-w-sm", TOUCH_TARGETS)}>
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
