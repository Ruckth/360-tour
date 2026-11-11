"use client";

import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "../ConfirmDialog";
import { useMarketingAccess, type MarketingRole } from "./MarketingAccess";
import { marketingErrorText } from "./marketing-format";

type GrantRole = Exclude<MarketingRole, "admin">;
type Grant = { _id: string; email: string; role: GrantRole; tokenIdentifier?: string; expiresAt: number | null; expired: boolean };
const listGrants = makeFunctionReference<"query", Record<string, never>, Grant[]>("marketingAccess:listGrants");
const setGrant = makeFunctionReference<"mutation", { email: string; role: GrantRole | null }, null>("marketingAccess:setGrant");
const ROLES: { role: GrantRole; label: string; description: string }[] = [
  { role: "manager", label: "Manager", description: "Draft, publish, spend and manage affiliate partners." },
  { role: "marketer", label: "Marketer", description: "Create and edit drafts. Cannot publish, edit live records or manage spend." },
  { role: "finance", label: "Finance", description: "Read Marketing, manage spend and review affiliate credits." },
  { role: "viewer", label: "Viewer", description: "Read Marketing reports, campaigns, links, coupons and affiliates." },
];

export function MarketingAccessScreen() {
  const { capabilities } = useMarketingAccess();
  if (!capabilities.manageAccess) return <div className="mx-auto max-w-3xl p-6"><h2 className="text-xl font-semibold">Access is managed by system administrators</h2><p className="mt-2 text-sm text-muted-foreground">Your Marketing role does not allow invitations or role changes.</p></div>;
  return <AccessManager />;
}

function RoleSelect({ value, onChange, disabled, label }: { value: GrantRole; onChange: (value: GrantRole) => void; disabled: boolean; label: string }) {
  return <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value as GrantRole)} className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm dark:[color-scheme:dark]">
    {ROLES.map(item => <option key={item.role} value={item.role}>{item.label}</option>)}
  </select>;
}

function GrantRow({ grant, busy, change }: { grant: Grant; busy: boolean; change: (email: string, role: GrantRole | null) => Promise<boolean> }) {
  const [role, setRole] = useState(grant.role);
  const confirm = useConfirm();
  return <li className="grid min-w-0 gap-3 border-t border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="min-w-0"><p className="break-all text-sm font-medium">{grant.email}</p><p className="text-xs text-muted-foreground">{grant.tokenIdentifier ? "Access activated" : grant.expired ? "Expired" : "Invitation awaiting activation"}</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <RoleSelect label={`Role for ${grant.email}`} value={role} onChange={setRole} disabled={busy} />
      {!grant.tokenIdentifier ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void change(grant.email, grant.role)}>Renew invitation</Button> : null}
      <Button size="sm" variant="outline" disabled={busy || role === grant.role} onClick={() => void change(grant.email, role)}>Save role</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
        if (await confirm({ title: `Revoke access for ${grant.email}?`, description: "Marketing access ends immediately. A new invitation can be created later.", confirmLabel: "Revoke access", destructive: true })) await change(grant.email, null);
      }}>Revoke</Button>
    </div>
  </li>;
}

function AccessManager() {
  const grants = useQuery(listGrants, {});
  const save = useMutation(setGrant);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GrantRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  async function change(address: string, nextRole: GrantRole | null) {
    if (busy) return false;
    setBusy(true); setMessage(null);
    try { await save({ email: address.trim().toLowerCase(), role: nextRole }); setMessage({ text: nextRole ? `Marketing access saved for ${address}.` : `Marketing access revoked for ${address}.` }); return true; }
    catch (cause) { setMessage({ text: marketingErrorText(cause, "Couldn’t update Marketing access. Try again."), error: true }); return false; }
    finally { setBusy(false); }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage({ text: "Enter a valid email address.", error: true }); return; }
    if (await change(email, role)) setEmail("");
  }
  return <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 sm:px-6">
    <header><h2 className="text-xl font-semibold">Marketing access</h2><p className="mt-1 text-sm text-muted-foreground">System administrators invite people and manage roles. Marketing access does not grant access to other admin areas.</p></header>
    <section className="grid gap-3 border border-border bg-card p-4" aria-labelledby="marketing-invite">
      <h3 id="marketing-invite" className="font-semibold">Invite an account</h3>
      <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-0 flex-1 gap-1.5"><Label htmlFor="marketing-invite-email">Email address</Label><Input id="marketing-invite-email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="colleague@example.com" /></div>
        <div className="grid gap-1.5"><span className="text-sm font-medium">Role</span><RoleSelect label="Invitation role" value={role} onChange={setRole} disabled={busy} /></div>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create invitation"}</Button>
      </form>
      <p className="text-xs text-muted-foreground">No email is sent. Share the Marketing page address with your colleague. They must sign in with this email and activate the invitation.</p>
      <p className="text-xs text-muted-foreground">{ROLES.find(item => item.role === role)?.description}</p>
    </section>
    {message ? <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p> : null}
    <section className="border border-border bg-card" aria-labelledby="marketing-grants"><h3 id="marketing-grants" className="p-4 font-semibold">Invitations and roles</h3>
      {grants === undefined ? <div className="p-4"><Spinner label="Loading invitations" /></div> : grants.length ? <ul>{grants.map(grant => <GrantRow key={`${grant._id}:${grant.role}`} grant={grant} busy={busy} change={change} />)}</ul> : <p className="border-t border-border p-4 text-sm text-muted-foreground">No Marketing invitations yet. System administrators already have full access.</p>}
      {grants?.length === 500 ? <p className="p-4 text-xs text-muted-foreground">Showing the first 500 grants.</p> : null}
    </section>
    <dl className="grid gap-3 sm:grid-cols-2">{ROLES.map(item => <div key={item.role}><dt className="text-sm font-semibold">{item.label}</dt><dd className="text-sm text-muted-foreground">{item.description}</dd></div>)}</dl>
  </div>;
}
