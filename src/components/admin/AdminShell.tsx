"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Shield } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Component, useEffect, useState, type ReactNode } from "react";
import { AdminRail, AdminTabBar } from "@/components/admin/AdminNav";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { adminAccessRedirect, type StaffAccessView } from "@/components/admin/admin-access";
import { adminNavItem } from "@/components/admin/admin-routes";
import { ROLE_LABELS, StaffAccessProvider, useStaffAccess } from "@/components/admin/staff-access";
import { CheckoutHeaderStaff } from "@/components/checkout/CheckoutHeaderStaff";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

/** Auth gates, sidebar and header for every `/admin/*` page. Pages render only once the admin is connected. */
export function AdminShell({ children }: { children: ReactNode }) {
  const convex = useOptionalConvex();
  const convexAuth = useOptionalConvexAuth();
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
            Sign in with an allowlisted admin account to view visitor chat activity and
            transcripts.
          </p>
          <SignInButton mode="modal">
            <Button className="mt-6 w-full">Sign in</Button>
          </SignInButton>
        </section>
      </div>
    );
  }

  if (!convex) {
    return (
      <div className="grid min-h-dvh place-items-center px-5">
        <section className="max-w-lg border border-border bg-card p-6 shadow-xl">
          <h1 className="font-serif text-3xl font-semibold">Convex is not configured</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Add `NEXT_PUBLIC_CONVEX_URL` so the admin dashboard can query chat sessions.
          </p>
        </section>
      </div>
    );
  }

  if (convexAuth.isAuthEnabled && convexAuth.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label="Connecting" className="size-5" />
          Connecting secure admin session
        </div>
      </div>
    );
  }

  if (convexAuth.isAuthEnabled && !convexAuth.isAuthenticated) {
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

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <section className="w-full max-w-md border border-border bg-card p-6 shadow-xl">
        <Shield aria-hidden="true" className="mb-5 h-8 w-8 text-gold-text" />
        <h1 className="font-serif text-3xl font-semibold">{title}</h1>
        <div className="mt-3 grid gap-4 text-sm leading-6 text-muted-foreground">{children}</div>
      </section>
    </div>
  );
}

/** Loads the person's staff access once, lets an invited person activate it, then shows the admin. */
function AdminAccessGate({ userEmail, children }: { userEmail?: string; children: ReactNode }) {
  const access = useQuery(api.staffAccess.myAccess, {});
  const [pendingCount, setPendingCount] = useState(0);
  if (access === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Checking access" className="size-6" />
      </div>
    );
  }
  if (!access.role && access.pendingInvitation) return <ClaimInvitation access={access} />;
  return (
    <StaffAccessProvider access={access} pendingApprovals={access.capabilities.approve ? pendingCount : 0}>
      {access.capabilities.approve ? <QuietBoundary><PendingApprovalsCount onCount={setPendingCount} /></QuietBoundary> : null}
      <AdminFrame userEmail={userEmail}>{children}</AdminFrame>
    </StaffAccessProvider>
  );
}

/** Only feeds the badge count, so a failed approvals query never takes down the admin. */
function PendingApprovalsCount({ onCount }: { onCount: (count: number) => void }) {
  const count = useQuery(api.pos.staffApprovals.pending, {})?.count ?? 0;
  useEffect(() => onCount(count), [count, onCount]);
  return null;
}

/** Renders nothing on error: the badge simply shows no count. */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** As Marketing invitations: the invited account activates its own access, explicitly. */
function ClaimInvitation({ access }: { access: StaffAccessView }) {
  const claim = useMutation(api.staffAccess.claimInvite);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const role = access.pendingInvitation ? ROLE_LABELS[access.pendingInvitation.role] : "";
  return (
    <GateCard title="Activate your access">
      <p>{access.email} is invited as {role}.</p>
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

function AdminFrame({ userEmail, children }: { userEmail?: string; children: ReactNode }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const router = useRouter();
  const access = useStaffAccess();
  // A cashier on another admin page goes to checkout; a manager on Team goes to Settings.
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

  return (
    <SidebarProvider
      open={checkoutFlow ? checkoutOpen : open}
      onOpenChange={checkoutFlow ? setCheckoutOpen : setOpen}
      className={cn(
        // --admin-tab-bar: the phone tab bar's height, so bars pinned to the bottom sit above it.
        "bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] [--admin-tab-bar:calc(3.8125rem+max(0.25rem,env(safe-area-inset-bottom)))] md:[--admin-tab-bar:0px]",
        fitsViewport ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh",
      )}
    >
      {/* Navigation changes form with the window but never disappears: the sidebar from 1280px
          (a drawer below, opened from Menu), an icon rail on iPads, a tab bar on phones. */}
      <AdminSidebar userEmail={userEmail} />
      <AdminRail />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
          <SidebarTrigger className="-ml-1 hidden xl:inline-flex" />
          <div className="min-w-0 flex-1">
            <p className="admin-eyebrow">Concierge operations</p>
            <h1 className="truncate font-serif text-2xl font-semibold tracking-tight text-foreground">
              {adminNavItem(pathname)?.label ?? "Admin"}
            </h1>
          </div>
          {checkoutFlow ? <CheckoutHeaderStaff /> : null}
        </header>
        <ConfirmProvider>
          {redirect ? (
            <div className="grid flex-1 place-items-center p-10">
              <Spinner label="Loading" className="size-6" />
            </div>
          ) : (
            children
          )}
        </ConfirmProvider>
        <AdminTabBar />
      </SidebarInset>
    </SidebarProvider>
  );
}
