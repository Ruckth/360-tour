"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Section<T extends string> = { value: T; label: string; keywords?: readonly string[] };

export function MobileSectionPicker<T extends string>({
  label,
  sections,
  value,
  onSelect,
}: {
  label: string;
  sections: readonly Section<T>[];
  value: T;
  onSelect: (value: T) => boolean | Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const selected = sections.find((section) => section.value === value);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sections.filter((section) => {
    const searchable = [label, section.label, ...(section.keywords ?? [])].join(" ").toLowerCase();
    return words.every((word) => searchable.includes(word));
  });

  async function select(next: T) {
    if (selecting) return;
    setSelecting(true);
    try {
      if (next === value || await onSelect(next)) setOpen(false);
    } finally {
      setSelecting(false);
    }
  }

  return (
    <div className="min-w-0 sm:hidden">
      <Dialog open={open} onOpenChange={(next) => {
        if (next) setQuery("");
        setOpen(next);
      }}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="min-h-11 w-full justify-between" aria-label={`${label}: ${selected?.label ?? ""}`}>
            <span className="min-w-0 truncate">{selected?.label}</span>
            <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined} className="gap-3 px-4 pt-4" onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus();
        }}>
          <DialogTitle asChild><h2 ref={title} tabIndex={-1}>{label}</h2></DialogTitle>
          <label className="relative block min-w-0">
            <span className="sr-only">Search {label.toLowerCase()}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" className="min-h-11 ps-9" placeholder="Find a section…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {shown.length ? (
            <ul className="divide-y divide-border">
              {shown.map((section) => (
                <li key={section.value}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn("min-h-11 w-full justify-between rounded-none", section.value === value && "font-semibold")}
                    aria-current={section.value === value ? "true" : undefined}
                    aria-disabled={selecting || undefined}
                    onClick={() => void select(section.value)}
                  >
                    {section.label}
                    {section.value === value ? <Check aria-hidden className="size-4" /> : null}
                  </Button>
                </li>
              ))}
            </ul>
          ) : <p role="status" className="py-2 text-sm text-muted-foreground">No sections match.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
