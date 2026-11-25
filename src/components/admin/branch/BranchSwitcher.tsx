"use client";

import { Menu } from "@base-ui/react/menu";
import { Building2, Check, ChevronsUpDown, MapPin, Settings2 } from "lucide-react";
import { useState, type ReactElement } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { TONES } from "@/components/admin/status-tones";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useAdminBranch } from "./branch-context";
import { BRANCH_STATE_META, BranchPill, BranchStatePill } from "./branch-pills";
import type { AdminBranchId, AdminBranchOption } from "./branch-selection";

const SWITCH_HINT = "Switching closes the open record and clears filters, search and selection.";
const MANAGE_BRANCHES_HREF = "/admin/settings?tab=branches";

/**
 * "Company" instead of a branch: on company-scoped routes (Settings, Marketing), and everywhere
 * for a marketing-only person, who works company-wide with no branch.
 */
function useShowsCompany() {
  const access = useStaffAccess();
  const { scope } = useAdminBranch();
  const companyOnly = access.role === null && access.marketingRole !== null && access.branches.length === 0;
  return scope === "company" || companyOnly;
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
const MANAGE_ROW = cn(ROW, "min-h-11 text-muted-foreground hover:text-foreground");

function ManageBranchesBody() {
  return (
    <>
      <Settings2 aria-hidden className="size-4 shrink-0" />
      Manage branches
    </>
  );
}

/**
 * The branch list as a bottom sheet (centered on tablets), opened by `children`. Used by the
 * header pill and by the sidebar inside the phone/tablet drawer, which is itself a modal sheet.
 * `onLeave` runs after a switch or the Manage branches link (the drawer closes with it).
 */
function BranchSheet({ children, onLeave }: { children: ReactElement; onLeave?: () => void }) {
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
                  if (!on) void select(branch.id).then((switched) => switched && onLeave?.());
                }}
              >
                <RowBody branch={branch} current={on} />
              </button>
            );
          })}
        </div>
        <p className="-mx-2 border-t border-border px-2 pt-2 text-xs text-muted-foreground">{SWITCH_HINT}</p>
        {access.capabilities.manageTeam ? (
          <Link
            href={MANAGE_BRANCHES_HREF}
            className={cn(MANAGE_ROW, "-mx-2")}
            onClick={() => {
              setOpen(false);
              onLeave?.();
            }}
          >
            <ManageBranchesBody />
          </Link>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SidebarStatic({ company = false, children }: { company?: boolean; children: ReactElement | string }) {
  return (
    <div data-branch-static="" className="grid gap-0.5 rounded-lg px-2.5 py-1.5 leading-tight">
      <span className="admin-eyebrow">Branch</span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {company ? <Building2 aria-hidden className="size-3.5 shrink-0 text-sidebar-foreground/70" /> : null}
        <span className="truncate">{children}</span>
      </span>
    </div>
  );
}

/**
 * Sidebar: the first block under the brand. Two or more branches get a button that opens the
 * list (a popover on desktop, the sheet in the drawer); one branch gets static text; company
 * routes show "Company". Checkout and receipts show nothing.
 */
export function SidebarBranchSwitcher() {
  const { branches, current, select, readOnly } = useAdminBranch();
  const { isMobile, setOpenMobile } = useSidebar();
  const access = useStaffAccess();
  const company = useShowsCompany();
  if (readOnly) return null;
  if (company) return <SidebarStatic company>Company</SidebarStatic>;
  if (!current) return null;
  const name = (
    <>
      <span className="admin-eyebrow">Branch</span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <span className="truncate">{current.name}</span>
      </span>
      {current.state !== "active" ? (
        <span className="mt-1">
          <BranchStatePill state={current.state} />
        </span>
      ) : null}
    </>
  );
  if (branches.length < 2) {
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
      <BranchSheet onLeave={() => setOpenMobile(false)}>
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
            {access.capabilities.manageTeam ? (
              <Menu.Item render={<Link href={MANAGE_BRANCHES_HREF} />} className={cn(MANAGE_ROW, "data-highlighted:bg-muted")}>
                <ManageBranchesBody />
              </Menu.Item>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Header pill, shown whenever the full sidebar isn't: below `xl`, and at `xl` while the sidebar
 * is collapsed. Two or more branches open the bottom sheet; one branch shows the static pill and
 * company routes "Company". Checkout and receipts, the till included, show nothing.
 */
export function HeaderBranchPill({ tillOnly = false }: { tillOnly?: boolean }) {
  const { branches, current, readOnly } = useAdminBranch();
  const company = useShowsCompany();
  const { state } = useSidebar();
  const visibility = tillOnly || state === "collapsed" ? "" : "xl:hidden";

  if (readOnly) return null;
  if (company) return <BranchPill name="Company" company label="Branch" className={visibility} />;
  if (!current) return null;
  if (branches.length < 2) return <BranchPill name={current.name} label="Branch" className={visibility} />;

  const pill = current.state === "active" ? null : BRANCH_STATE_META[current.state];
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
        <span className="sr-only">Branch: </span>
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
