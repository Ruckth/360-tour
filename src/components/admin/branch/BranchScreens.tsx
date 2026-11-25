"use client";

import { ArrowLeft, ChevronRight, Info, LogOut, MapPin, Shield, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { SignOutButton } from "@/platform/auth";
import { Button, ButtonLink } from "@/components/ui/button";
import { useAdminBranch } from "./branch-context";
import { BranchStatePill } from "./branch-pills";

/** The full-page card the access gate shows instead of the admin. */
export function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <section className="w-full max-w-md border border-border bg-card p-6 shadow-xl">
        <Shield aria-hidden="true" className="mb-5 h-8 w-8 text-gold-text" />
        <h1 className="font-serif text-3xl font-semibold">{title}</h1>
        <div className="mt-3 grid gap-4 text-sm leading-6 text-muted-foreground">{children}</div>
      </section>
    </div>
  );
}

/**
 * No admin access: a signed-in person without a role (or whose last branch was removed). Someone
 * who had access earlier in this session is told it changed. Sign out is the only action.
 */
export function NoAccessCard({ email, changed }: { email: string | null; changed: boolean }) {
  const who = email ?? "This account";
  return (
    <GateCard title={changed ? "Your access has changed" : "No access"}>
      {changed ? (
        <p>{who} no longer has desk access. Anything not yet saved on this device was not sent.</p>
      ) : (
        <p>{who} doesn’t have access to the admin.</p>
      )}
      <p>If this looks wrong, ask a company owner.</p>
      <SignOutButton redirectUrl="/admin">
        <Button className="w-full">
          <LogOut aria-hidden className="size-4" />
          Sign out
        </Button>
      </SignOutButton>
    </GateCard>
  );
}

/** First visit with two or more branches and no valid saved choice: choose once. */
export function BranchChooser({ email }: { email: string | null }) {
  const { branches, select } = useAdminBranch();
  return (
    <GateCard title="Choose a branch to start">
      <p>
        You work at {branches.length} branches. Pick where to start. You can switch any time from the branch button in the
        sidebar or at the top of the screen.
      </p>
      <div className="grid gap-2" role="list">
        {branches.map((branch) => (
          <div role="listitem" key={branch.id}>
            <button
              type="button"
              onClick={() => void select(branch.id)}
              className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left text-foreground transition-colors hover:border-gold/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MapPin aria-hidden className="size-5 shrink-0 text-gold-text" />
              <span className="grid min-w-0 flex-1 justify-items-start gap-1">
                <span className="text-[15px] font-semibold">{branch.name}</span>
                <BranchStatePill state={branch.state} />
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs">{email ? `Signed in as ${email}. ` : ""}We remember your choice on this device only.</p>
    </GateCard>
  );
}

/** Shown above the page after the working branch was removed mid-session. */
export function BranchRevokedBanner() {
  const { revoked, dismissRevoked } = useAdminBranch();
  if (!revoked) return null;
  return (
    <div className="mx-auto w-full max-w-7xl px-3 pt-4 sm:px-6">
      <div role="status" className="relative flex w-full flex-wrap items-center gap-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-foreground">
        <Info aria-hidden className="size-4 shrink-0 text-gold-text" />
        <p className="min-w-0 flex-1 basis-60 leading-relaxed">
          <strong className="font-semibold">Your access to {revoked.from} ended.</strong> You’re now working in {revoked.to}.
          {revoked.discarded ? ` Unsaved changes for ${revoked.from} were discarded.` : null}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={dismissRevoked}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * A record from a branch this person isn't assigned to. Fixed copy only: never the server's
 * message, the guest, an amount or a name.
 */
export function BranchForbiddenCard({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <section role="alert" className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
        <ShieldAlert aria-hidden="true" className="mb-4 size-6 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">You don’t have access to this branch’s records</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This link opens a record from a branch you aren’t assigned to. Ask a company owner if you need it.
        </p>
        <ButtonLink href={backHref} className="mt-5">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </ButtonLink>
      </section>
    </div>
  );
}

/** `BRANCH_FORBIDDEN` from a branch check (`ConvexError` data, or its serialized message). */
export function isBranchForbidden(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data: unknown = "data" in error ? error.data : undefined;
  if (data && typeof data === "object" && "code" in data && data.code === "BRANCH_FORBIDDEN") return true;
  return error instanceof Error && /"code"\s*:\s*"BRANCH_FORBIDDEN"/.test(error.message);
}
