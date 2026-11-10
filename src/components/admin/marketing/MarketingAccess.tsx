"use client";

import { SignInButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Component, createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { marketingErrorText } from "./marketing-format";

export type MarketingRole = "admin" | "manager" | "marketer" | "finance" | "viewer";
export type MarketingCapabilities = Record<"view" | "draft" | "publish" | "spend" | "partners" | "reviewCredits" | "manageAccess", boolean>;
export type MarketingAccess = {
  email: string | null;
  role: MarketingRole | null;
  capabilities: MarketingCapabilities;
  pendingInvitation: { role: Exclude<MarketingRole, "admin"> } | null;
};

// Production pages always receive the gate's server result. The fallback keeps existing isolated
// prop-driven fixtures usable without adding Convex or Clerk providers to those fixtures.
const fixtureAccess: MarketingAccess = {
  email: null, role: "admin", pendingInvitation: null,
  capabilities: { view: true, draft: true, publish: true, spend: true, partners: true, reviewCredits: true, manageAccess: true },
};
const Context = createContext<MarketingAccess | undefined>(undefined);
export function MarketingAccessProvider({ value, children }: { value: MarketingAccess; children?: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMarketingAccess(): MarketingAccess {
  return useContext(Context) ?? fixtureAccess;
}
export function canEditMarketing(access: MarketingAccess, record?: { status: string }): boolean {
  return access.capabilities.draft && (access.capabilities.publish || record === undefined || record.status === "draft");
}

// Explicit typed references until the parent runs local codegen for the new module.
const current = makeFunctionReference<"query", Record<string, never>, MarketingAccess>("marketingAccess:current");
const claimInvite = makeFunctionReference<"mutation", Record<string, never>, null>("marketingAccess:claimInvite");

function AccessState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mx-auto my-8 grid w-[calc(100%-2rem)] max-w-xl gap-3 border border-border bg-card p-6">
    <h2 className="text-xl font-semibold text-foreground">{title}</h2>
    <div className="grid gap-3 text-sm text-muted-foreground">{children}</div>
  </section>;
}

class AccessBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <AccessState title="Marketing access didn’t load"><p>Reconnect and try again.</p><Button onClick={() => window.location.reload()}>Reload access</Button></AccessState>;
    return this.props.children;
  }
}

function AccessGate({ children }: { children: ReactNode }) {
  const auth = useConvexAuth();
  const access = useQuery(current, auth.isAuthenticated ? {} : "skip");
  const claim = useMutation(claimInvite);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (auth.isLoading || (auth.isAuthenticated && access === undefined)) return <AccessState title="Checking Marketing access"><Spinner label="Loading Marketing access" /></AccessState>;
  if (!auth.isAuthenticated || !access?.email) return <AccessState title="Sign in to Marketing"><p>Use the account invited to Marketing.</p><SignInButton mode="modal"><Button>Sign in</Button></SignInButton></AccessState>;
  if (access.capabilities.view) return <MarketingAccessProvider value={access}>{children}</MarketingAccessProvider>;
  if (access.pendingInvitation) return <AccessState title="Activate your Marketing invitation">
    <p>{access.email} has been invited as {access.pendingInvitation.role}. Activate access for this signed-in account.</p>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Button disabled={claiming} onClick={async () => {
      setClaiming(true); setError(null);
      try { await claim({}); } catch (cause) { setError(marketingErrorText(cause, "Couldn’t activate the invitation. Try again.")); } finally { setClaiming(false); }
    }}>{claiming ? "Activating…" : "Activate Marketing access"}</Button>
  </AccessState>;
  return <AccessState title="Marketing access required"><p>{access.email} does not have Marketing access. Ask a system administrator to invite this account.</p></AccessState>;
}

/** No page queries mount until Convex authentication and the Marketing grant are both ready. */
export function MarketingAccessGate({ children }: { children: ReactNode }) {
  return <AccessBoundary><AccessGate>{children}</AccessGate></AccessBoundary>;
}
