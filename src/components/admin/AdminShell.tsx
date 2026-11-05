"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { Shield } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AdminRail, AdminTabBar } from "@/components/admin/AdminNav";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { adminNavItem } from "@/components/admin/admin-routes";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useOptionalConvex, useOptionalConvexAuth } from "@/lib/react/convex";
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

  return <AdminFrame userEmail={user.primaryEmailAddress?.emailAddress}>{children}</AdminFrame>;
}

function AdminFrame({ userEmail, children }: { userEmail?: string; children: ReactNode }) {
  const pathname = usePathname();
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
          <div className="min-w-0">
            <p className="admin-eyebrow">Concierge operations</p>
            <h1 className="truncate font-serif text-2xl font-semibold tracking-tight text-foreground">
              {adminNavItem(pathname)?.label ?? "Admin"}
            </h1>
          </div>
        </header>
        <ConfirmProvider>{children}</ConfirmProvider>
        <AdminTabBar />
      </SidebarInset>
    </SidebarProvider>
  );
}
