"use client";

import { type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type CheckGroup = {
  title: string;
  items: Array<{ id: string; label: string; detail?: string }>;
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
};

export function StaffCalendarFilter({ icon, label, count, groups, extra }: { icon: ReactNode; label: string; count?: number; groups: CheckGroup[]; extra?: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          {icon}
          {label}
          {count ? (
            <Badge variant="secondary" className="ms-0.5 h-5 min-w-5 justify-center rounded-full px-1.5">
              {count}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        {extra}
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title} className="border-b border-border p-2 last:border-b-0">
            <div className="flex items-center justify-between px-2 pb-1">
              <span aria-hidden className="admin-eyebrow">
                {group.title}
              </span>
              <button
                type="button"
                className="min-h-11 rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => group.onChange(new Set())}
              >
                Show all
              </button>
            </div>
            {group.items.map((item) => (
              <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md focus-within:ring-2 focus-within:ring-ring px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={!group.hidden.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(group.hidden);
                    if (event.target.checked) next.delete(item.id);
                    else next.add(item.id);
                    group.onChange(next);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
              </label>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
