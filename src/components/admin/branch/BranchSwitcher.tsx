"use client";

import { Menu } from "@base-ui/react/menu";
import { Building2, Check, ChevronsUpDown, MapPin } from "lucide-react";
import { useState, type ReactElement } from "react";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useStaffAccess } from "@/components/admin/staff-access";
import { TONES } from "@/components/admin/status-tones";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useAdminBranch } from "./branch-context";
import { BRANCH_STATE_PILLS, type AdminBranchId, type AdminBranchOption } from "./branch-selection";

const SWITCH_HINT = "Switching clears filters, search and selection.";

/** The branch's state pill; Active shows none. */
export function BranchStatePill({ state, className }: { state: AdminBranchOption["state"]; className?: string }) {
  const pill = BRANCH_STATE_PILLS[state];
  return pill ? <StatusBadge tone={pill.tone} label={pill.label} className={className} /> : null;
}

/** The one read-only branch pill: a map-pin (building for Company) and the name. */
function BranchPill({ name, company = false, className }: { name: string; company?: boolean; className?: string }) {
  const Icon = company ? Building2 : MapPin;
  return (
    <span data-branch-pill="" className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-xs font-medium text-foreground", className)}>
      <Icon aria-hidden className="size-3 text-muted-foreground" />
      {name}
    </span>
  );
}

/** A marketing-only person works company-wide, with no branch: they see "Company". */
function useCompanyOnly() {
  const access = useStaffAccess();
  return access.role === null && access.marketingRole !== null && access.branches.length === 0;
}

function RowBody({ branch, current }: { branch: AdminBranchOption; current: boolean }) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">{current ? <Check aria-hidden className="size-4" /> : null}</span>
      <MapPin aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate", current && "font-medium")}>{branch.name}</span>
      <BranchStatePill state={branch.state} />
    </>
  );
}

const ROW = "flex w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted";
const SIDEBAR_TRIGGER =
  "flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 py-1.5 text-left outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 pointer-coarse:min-h-11";

/**
 * The branch list as a bottom sheet (centered on tablets), opened by `children`. Used by the
 * header pill and by the sidebar inside the phone/tablet drawer, which is itself a modal sheet.
 */
function BranchSheet({ children }: { children: ReactElement }) {
  const { branches, current, select } = useAdminBranch();
  const access = useStaffAccess();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" className="md:bottom-4 md:left-1/2 md:right-auto md:w-[28rem] md:-translate-x-1/2 md:rounded-2xl md:border">
        <SheetHeader className="pe-10 text-left">
          <SheetTitle>Switch branch</SheetTitle>
          <SheetDescription>
            {access.email ? `Signed in as ${access.email}. ` : ""}Only branches you are assigned to are listed.
          </SheetDescription>
        </SheetHeader>
        <div role="group" aria-label="Your branches" className="-mx-2 grid gap-1">
          {branches.map((branch) => {
            const on = branch.id === current?.id;
            return (
              <button
                key={branch.id}
                type="button"
                aria-current={on ? "true" : undefined}
                className={cn(ROW, "min-h-12")}
                onClick={() => {
                  setOpen(false);
                  if (!on) void select(branch.id);
                }}
              >
                <RowBody branch={branch} current={on} />
              </button>
            );
          })}
        </div>
        <p className="-mx-2 border-t border-border px-2 pt-2 text-xs text-muted-foreground">{SWITCH_HINT}</p>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Sidebar: the first block under the brand. Two or more branches get a button that opens the
 * list (a popover on desktop, the sheet in the drawer); one branch, or a read-only route, gets
 * static text.
 */
export function SidebarBranchSwitcher() {
  const { branches, current, select, readOnly } = useAdminBranch();
  const { isMobile } = useSidebar();
  const companyOnly = useCompanyOnly();
  if (!current) {
    if (!companyOnly) return null;
    return (
      <div data-branch-static="" className="grid gap-0.5 rounded-lg px-2.5 py-1.5 leading-tight">
        <span className="admin-eyebrow">Branch</span>
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <Building2 aria-hidden className="size-3.5 shrink-0 text-sidebar-foreground/70" />
          <span className="truncate">Company</span>
        </span>
      </div>
    );
  }
  const name = (
    <>
      <span className="admin-eyebrow">Branch</span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <span className="truncate">{current.name}</span>
      </span>
      {BRANCH_STATE_PILLS[current.state] ? (
        <span className="mt-1">
          <BranchStatePill state={current.state} />
        </span>
      ) : null}
    </>
  );
  if (branches.length < 2 || readOnly) {
    return (
      <div data-branch-static="" className="grid gap-0.5 rounded-lg px-2.5 py-1.5 leading-tight">
        {name}
      </div>
    );
  }
  const body = (
    <>
      <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">{name}</span>
      <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-sidebar-foreground/60" />
    </>
  );
  if (isMobile) {
    return (
      <BranchSheet>
        <button type="button" data-branch-switcher="" className={SIDEBAR_TRIGGER}>
          {body}
        </button>
      </BranchSheet>
    );
  }
  return (
    <Menu.Root>
      <Menu.Trigger data-branch-switcher="" className={SIDEBAR_TRIGGER}>
        {body}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" sideOffset={4} className="z-50">
          <Menu.Popup aria-label="Switch branch" className="w-[21rem] max-w-[calc(100vw-1rem)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl outline-none">
            <Menu.Group>
              <Menu.GroupLabel className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Your branches</Menu.GroupLabel>
              <Menu.RadioGroup value={current.id} onValueChange={(id: AdminBranchId) => void select(id)}>
                {branches.map((branch) => (
                  <Menu.RadioItem key={branch.id} value={branch.id} closeOnClick className={cn(ROW, "min-h-11 data-highlighted:bg-muted")}>
                    <RowBody branch={branch} current={branch.id === current.id} />
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <div className="mx-1 my-1 h-px bg-border" />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{SWITCH_HINT}</p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Header pill, shown whenever the full sidebar isn't: below `xl`, and at `xl` while the sidebar
 * is collapsed. Two or more branches open the bottom sheet; one branch, or a read-only route,
 * shows the static pill. The till (no sidebar) always shows its branch as plain text.
 */
export function HeaderBranchPill({ tillOnly = false }: { tillOnly?: boolean }) {
  const { branches, current, readOnly } = useAdminBranch();
  const companyOnly = useCompanyOnly();
  const { state } = useSidebar();
  const visibility = tillOnly || state === "collapsed" ? "" : "xl:hidden";

  if (!current) return companyOnly ? <BranchPill name="Company" company className={visibility} /> : null;
  if (tillOnly) {
    return (
      <span data-branch-static="" className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{current.name}</span>
      </span>
    );
  }
  if (branches.length < 2 || readOnly) return <BranchPill name={current.name} className={visibility} />;

  const pill = BRANCH_STATE_PILLS[current.state];
  return (
    <BranchSheet>
      <button
        type="button"
        data-branch-switcher=""
        className={cn(
          "inline-flex h-9 max-w-40 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
          visibility,
        )}
      >
        <MapPin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current.name}</span>
        {pill ? (
          <>
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONES[pill.tone].dot)} />
            <span className="sr-only">, {pill.label}</span>
          </>
        ) : null}
      </button>
    </BranchSheet>
  );
}
