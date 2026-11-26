"use client";

import { Menu } from "@base-ui/react/menu";
import { SignInButton, SignOutButton, useUser } from "@/platform/auth";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "convex/_generated/api";
import { LogOut, Shield } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "@/platform/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { MarketingInvitation } from "@/components/admin/marketing/MarketingAccess";
import { AdminRail, AdminTabBar } from "@/components/admin/AdminNav";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { adminAccessRedirect, adminNoAccess, adminTillOnly, type StaffAccessView } from "@/components/admin/admin-access";
import { AdminBranchProvider, useAdminBranch } from "@/components/admin/branch/branch-context";
import { BranchChooser, BranchRevokedBanner, GateCard, NoAccessCard } from "@/components/admin/branch/BranchScreens";
import { HeaderBranchPill } from "@/components/admin/branch/BranchSwitcher";
import { adminNavItem } from "@/components/admin/admin-routes";
import { ROLE_LABELS, StaffAccessProvider, useStaffAccess } from "@/components/admin/staff-access";
import type { CheckoutBackend } from "@/components/checkout/backend";
import { CheckoutHeaderStaff } from "@/components/checkout/CheckoutHeaderStaff";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

/** Auth gates, sidebar and header for every `/admin/*` page. Pages render only once the admin is connected. */
export function AdminShell({ children }: { children: ReactNode }) {
  const convexAuth = useConvexAuth();
  const { isLoaded, isSignedIn, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading admin" className="size-6" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[linear-gradient(135deg,var(--background),var(--secondary))] px-5">
        <section className="w-full max-w-md border border-border bg-card p-6 shadow-xl">
          <Shield aria-hidden="true" className="mb-5 h-8 w-8 text-gold-text" />
          <h1 className="font-serif text-4xl font-semibold text-foreground">Admin</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in with an admin account to view visitor chat activity and transcripts.
          </p>
          <SignInButton mode="modal">
            <Button className="mt-6 w-full">Sign in</Button>
          </SignInButton>
        </section>
      </div>
    );
  }

  if (convexAuth.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label="Connecting" className="size-5" />
          Connecting secure admin session
        </div>
      </div>
    );
  }

  if (!convexAuth.isAuthenticated) {
    return (
      <div className="grid min-h-dvh place-items-center px-5">
        <section className="max-w-lg border border-border bg-card p-6 shadow-xl">
          <Shield aria-hidden="true" className="mb-5 h-8 w-8 text-gold-text" />
          <h1 className="font-serif text-3xl font-semibold">
            Convex auth is not connected
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Clerk is signed in, but Convex could not validate the Clerk token. Check
            the Convex `CLERK_JWT_ISSUER_DOMAIN` environment variable and the Clerk
            `convex` JWT template.
          </p>
        </section>
      </div>
    );
  }

  return <AdminAccessGate userEmail={user.primaryEmailAddress?.emailAddress}>{children}</AdminAccessGate>;
}

/**
 * Loads the person's staff access (live), lets an invited person activate it, then shows the
 * admin. A person with no admin access, including one whose access is removed mid-session, gets
 * "No access" with Sign out instead of the frame.
 */
function AdminAccessGate({ userEmail, children }: { userEmail?: string; children: ReactNode }) {
  const pathname = usePathname();
  const access = useQuery(api.auth.staffAccess.myAccess, {});
  const allowed = access !== undefined && !adminNoAccess(access);
  // Whether this session has had access, so losing it reads as a change rather than a refusal.
  const [hadAccess, setHadAccess] = useState(false);
  if (allowed && !hadAccess) setHadAccess(true);
  if (access === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Checking access" className="size-6" />
      </div>
    );
  }
  if (access.pendingInvitation) return <ClaimInvitation access={access} />;
  if (access.marketingInvitation && (!allowed || adminNavItem(pathname)?.href.startsWith("/admin/marketing"))) {
    return <MarketingInvitation email={access.email} role={access.marketingInvitation.role} />;
  }
  if (!allowed) return <NoAccessCard email={access.email ?? userEmail ?? null} changed={hadAccess} />;
  return (
    <StaffAccessProvider access={access}>
      <AdminFrame userEmail={userEmail}>{children}</AdminFrame>
    </StaffAccessProvider>
  );
}

/** As Marketing invitations: the invited account activates its own access, explicitly. */
function ClaimInvitation({ access }: { access: StaffAccessView }) {
  const claim = useMutation(api.auth.staffAccess.claimInvite);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const role = access.pendingInvitation ? ROLE_LABELS[access.pendingInvitation.role] : "";
  return (
    <GateCard title="Activate your access">
      <p>{access.email} is invited as {role}{access.pendingInvitation?.branches.length
        ? ` at ${access.pendingInvitation.branches.map(branch => branch.name).join(", ")}`
        : ""}.</p>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      <Button
        className="w-full"
        disabled={claiming}
        onClick={async () => {
          setClaiming(true);
          setError("");
          try {
            await claim({});
          } catch (cause) {
            setError(errorText(cause, "Couldn’t activate the invitation. Try again."));
          } finally {
            setClaiming(false);
          }
        }}
      >
        {claiming ? "Activating…" : "Activate access"}
      </Button>
    </GateCard>
  );
}

/**
 * The admin's frame for the signed-in person: header, navigation and the page. Cashiers get the
 * till alone, with Sign out in the header. Approvers get Approvals in the header on every page.
 * `checkoutBackend` feeds the header's approvals (Convex; browser fixtures pass their own).
 */
export function AdminFrame(props: { userEmail?: string; checkoutBackend?: CheckoutBackend; children: ReactNode }) {
  // Above the sidebar and header too, so the branch switcher can ask before discarding changes.
  return (
    <ConfirmProvider>
      <AdminBranchProvider>
        <AdminFrameBody {...props} />
      </AdminBranchProvider>
    </ConfirmProvider>
  );
}

function AdminFrameBody({ userEmail, checkoutBackend = convexCheckoutBackend, children }: { userEmail?: string; checkoutBackend?: CheckoutBackend; children: ReactNode }) {
  const pathname = usePathname();
  const branch = useAdminBranch();
  const tab = useSearchParams().get("tab");
  const router = useRouter();
  const access = useStaffAccess();
  const tillOnly = adminTillOnly(access);
  // A cashier on another admin page (or on /admin) goes to checkout; a manager on Team goes to Settings.
  const redirect = adminAccessRedirect(pathname, tab, access);
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);
  // The chat inbox and checkout fill the viewport and scroll their panes; other views scroll the page.
  const checkout = pathname.startsWith("/admin/checkout");
  const fitsViewport = pathname.startsWith("/admin/chats") || checkout;
  // Checkout opens with the sidebar as an icon rail, leaving room for the catalog and order. Opening
  // it there (trigger, ⌘B, search) is kept while on checkout and its receipts, so paying doesn't
  // expand the rail; other pages keep their own state.
  const checkoutFlow = checkout || /^\/admin\/receipt(\/|$)/.test(pathname);
  const [open, setOpen] = useState(true);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Sheets are portaled to <body>, outside the provider below, so the header height they stop
  // under (the phone order sheet, toasts) is set on <html> too.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--admin-header", "calc(4rem + env(safe-area-inset-top))");
    return () => {
      root.removeProperty("--admin-header");
    };
  }, []);

  // A first-time person with two or more branches chooses once before any page.
  if (branch.needsChoice && !redirect) return <BranchChooser email={access.email ?? userEmail ?? null} />;

  return (
    <SidebarProvider
      open={checkoutFlow ? checkoutOpen : open}
      onOpenChange={checkoutFlow ? setCheckoutOpen : setOpen}
      className={cn(
        // --admin-header: the header's height, so the phone order sheet stops under it.
        // --admin-tab-bar: the phone tab bar's height, so bars pinned to the bottom sit above it.
        "bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] [--admin-header:calc(4rem+env(safe-area-inset-top))]",
        tillOnly ? "[--admin-tab-bar:0px]" : "[--admin-tab-bar:calc(3.8125rem+max(0.25rem,env(safe-area-inset-bottom)))] md:[--admin-tab-bar:0px]",
        fitsViewport ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh",
      )}
    >
      {/* Navigation changes form with the window but never disappears: the sidebar from 1280px
          (a drawer below, opened from Menu), an icon rail on iPads, a tab bar on phones. A
          cashier has only the till, so they get none. */}
      {tillOnly ? null : <AdminSidebar userEmail={userEmail} />}
      {tillOnly ? null : <AdminRail />}
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-[var(--admin-header)] shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
          {tillOnly ? null : <SidebarTrigger className="-ml-1 hidden xl:inline-flex" />}
          <h1 className="min-w-0 flex-1 truncate font-serif text-2xl font-semibold tracking-tight text-foreground">
            {adminNavItem(pathname)?.label ?? "Admin"}
          </h1>
          <HeaderBranchPill tillOnly={tillOnly} />
          {/* Page tools render here (checkout ?timing=1), so they never sit over the page. */}
          <div data-admin-header-tools="" className="contents" />
          {access.capabilities.approve || checkoutFlow ? <CheckoutHeaderStaff backend={checkoutBackend} /> : null}
          {tillOnly ? (
            <>
              <div className="sm:hidden">
                <Menu.Root>
                  <Menu.Trigger aria-label="Account menu" className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold hover:bg-muted/80 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-11">
                    <span aria-hidden>{(userEmail ?? access.email ?? "Staff").split("@")[0].split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner align="end" sideOffset={6} className="z-50">
                      <Menu.Popup className="min-w-40 rounded-xl border bg-popover p-1 shadow-xl">
                        <SignOutButton redirectUrl="/admin">
                          <Menu.Item className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm outline-none data-highlighted:bg-muted">
                            <LogOut aria-hidden className="size-4" /> Sign out
                          </Menu.Item>
                        </SignOutButton>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </div>
              <SignOutButton redirectUrl="/admin">
                <Button variant="outline" className="hidden shrink-0 sm:inline-flex">
                  <LogOut aria-hidden className="size-4" />
                  Sign out
                </Button>
              </SignOutButton>
            </>
          ) : null}
        </header>
        <BranchRevokedBanner />
        {redirect ? (
          <div className="grid flex-1 place-items-center p-10">
            <Spinner label="Loading" className="size-6" />
          </div>
        ) : (
          <Fragment key={branch.scopeKey}>{children}</Fragment>
        )}
        {tillOnly ? null : <AdminTabBar />}
      </SidebarInset>
    </SidebarProvider>
  );
}
