"use client";

import { basisPointsToPercent, percentToBasisPoints } from 'convex/shared/money';

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { CashierRules } from "convex/lib/staffTypes";
import { Check, UserPlus } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { adminMarketingPath } from "./admin-routes";
import { ROLE_LABELS } from "./staff-access";
import { TONES } from "./status-tones";

type Person = FunctionReturnType<typeof api.staffAccess.listPeople>[number];
type StaffRole = "manager" | "cashier";
type Permission = CashierRules["voidPaidSale"];
type RuleKey = "refund" | "voidPaidSale" | "customPrice" | "paymentFix";

const RULES: { key: RuleKey; label: string }[] = [
  { key: "refund", label: "Refunds" },
  { key: "voidPaidSale", label: "Void a paid sale" },
  { key: "customPrice", label: "Custom price" },
  { key: "paymentFix", label: "Fix a payment" },
];
const MARKETING_ROLES: Record<string, string> = { admin: "Admin", manager: "Manager", marketer: "Marketer", finance: "Finance", viewer: "Viewer" };

/** A native select, as Marketing access uses: reliable on iPad and phones, themed for dark mode. */
const SELECT = "h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground disabled:opacity-60 dark:[color-scheme:dark] pointer-coarse:min-h-11";

/** Settings › Team: who has access and their role, plus what cashiers may do without a manager. */
export function TeamSettings() {
  const people = useQuery(api.staffAccess.listPeople, {});
  return (
    <>
      <PeoplePanel people={people} />
      <CashierRulesPanel hasCashiers={people === undefined ? undefined : people.some((person) => person.role === "cashier")} />
    </>
  );
}

function Section({ title, tip, action, children, label }: { title: string; tip: ReactNode; action?: ReactNode; children: ReactNode; label: string }) {
  return (
    <section className="border border-border bg-card" aria-label={label}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          {title}
          <InfoTip label={`About ${title.toLowerCase()}`}>{tip}</InfoTip>
        </h2>
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PeoplePanel({ people }: { people: Person[] | undefined }) {
  const setGrant = useMutation(api.staffAccess.setGrant);
  const updateInvitation = useMutation(api.staffAccess.updateInvitation);
  const confirm = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function save(email: string, task: () => Promise<unknown>, done: string) {
    if (busy) return false;
    setBusy(email);
    setMessage(null);
    try {
      await task();
      setMessage({ text: done });
      return true;
    } catch (err) {
      setMessage({ text: errorText(err, "Couldn’t save. Try again."), error: true });
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="People"
      label="People"
      tip={<>Owner: everything, including Settings. Manager: the desk and approvals. Cashier: Checkout, within the rules below.</>}
      action={
        <Button size="sm" variant="outline" aria-expanded={inviting} onClick={() => setInviting(!inviting)}>
          <UserPlus aria-hidden className="size-4" /> Invite
        </Button>
      }
    >
      {inviting ? (
        <InviteForm
          busy={busy !== null}
          onCancel={() => setInviting(false)}
          onInvite={async (email, role) => {
            const ok = await save(email, () => setGrant({ email, role }), `Invited ${email}. They sign in with this email to activate it.`);
            if (ok) setInviting(false);
            return ok;
          }}
        />
      ) : null}
      {message ? (
        <p role={message.error ? "alert" : "status"} className={cn("mb-3 text-sm", message.error ? "text-destructive" : "text-muted-foreground")}>{message.text}</p>
      ) : null}
      {people === undefined ? (
        <div className="grid place-items-center py-8"><Spinner label="Loading people" /></div>
      ) : (
        <ul className="divide-y divide-border" aria-label="People with access">
          {people.map((person) => (
            <PersonRow
              key={`${person.email}:${person.staffGrant?.role ?? ""}`}
              person={person}
              busy={busy !== null}
              onRole={(role) => save(person.email, () => setGrant({ email: person.email, role }), `${person.email} is now ${ROLE_LABELS[role]}.`)}
              onRevoke={async () => {
                if (!(await confirm({ title: `Remove ${person.email}?`, description: "Their staff access ends now. Marketing access, if any, stays.", confirmLabel: "Remove", destructive: true }))) return;
                await save(person.email, () => setGrant({ email: person.email, role: null }), `Removed ${person.email}.`);
              }}
              onInvitation={(action) => {
                const grant = person.staffGrant;
                if (!grant) return;
                void save(person.email, () => updateInvitation({ grantId: grant.id as Id<"staffGrants">, action }), action === "resend" ? `Invite renewed for ${person.email}.` : `Invite for ${person.email} expired.`);
              }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function InviteForm({ busy, onInvite, onCancel }: { busy: boolean; onInvite: (email: string, role: StaffRole) => Promise<boolean>; onCancel: () => void }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("cashier");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email.");
      return;
    }
    setError("");
    if (await onInvite(address, role)) setEmail("");
  }
  return (
    <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" aria-label="Invite">
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input id={`${id}-email`} type="email" required maxLength={254} autoFocus value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-invalid={error ? true : undefined} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-role`}>Role</Label>
        <select id={`${id}-role`} className={SELECT} value={role} disabled={busy} onChange={(e) => setRole(e.target.value as StaffRole)}>
          <option value="manager">Manager</option>
          <option value="cashier">Cashier</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || !email.trim()}>Send invite</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-3">{error}</p> : null}
    </form>
  );
}

function inviteState(person: Person) {
  const grant = person.staffGrant;
  if (!grant) return null;
  if (grant.claimed) return "Active";
  if (grant.expired) return "Invite expired";
  return grant.expiresAt ? `Invited · expires ${new Date(grant.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Invited";
}

function PersonRow({ person, busy, onRole, onRevoke, onInvitation }: {
  person: Person;
  busy: boolean;
  onRole: (role: StaffRole) => Promise<boolean>;
  onRevoke: () => Promise<void>;
  onInvitation: (action: "resend" | "expire") => void;
}) {
  const grant = person.staffGrant;
  const marketing = person.marketingGrant;
  const owner = person.role === "owner";
  const state = owner ? null : inviteState(person);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid="team-person">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold uppercase text-muted-foreground">{person.email[0]}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium break-all text-foreground">{person.email}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {owner ? <span className="sm:hidden">Owner</span> : null}
            {state ? <span>{state}</span> : null}
            {marketing ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge variant="muted" className="px-2 py-0.5">Marketing · {MARKETING_ROLES[marketing.role] ?? marketing.role}</Badge>
                <Link href={adminMarketingPath("access")} className="underline underline-offset-2 hover:text-foreground">Manage</Link>
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {/* On phones the controls wrap under the email, lined up with it. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 max-sm:w-full max-sm:pl-12 max-sm:justify-start">
        {owner ? (
          <span className="text-sm text-muted-foreground max-sm:hidden">Owner</span>
        ) : grant ? (
          <>
            <select
              aria-label={`Role for ${person.email}`}
              className={SELECT}
              value={grant.role}
              disabled={busy}
              onChange={(e) => void onRole(e.target.value as StaffRole)}
            >
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
            </select>
            {!grant.claimed ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onInvitation("resend")}>Resend</Button>
            ) : null}
            {!grant.claimed && !grant.expired ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onInvitation("expire")}>Expire</Button>
            ) : null}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void onRevoke()}>Revoke</Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

const LIMIT_PROBLEM = "Use 0–100, up to two decimals.";
function limitProblem(text: string) {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text.trim())) return LIMIT_PROBLEM;
  return Number(text) > 100 ? LIMIT_PROBLEM : null;
}
const isStaleRules = (err: unknown) => {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  return Boolean(data && typeof data === "object" && (data as { code?: unknown }).code === "STALE_RULES");
};

type Draft = { limit: string } & Record<RuleKey, Permission>;
const draftOf = (rules: CashierRules): Draft => ({ limit: String(basisPointsToPercent(rules.discountLimitPercent)), refund: rules.refund ?? "manager", voidPaidSale: rules.voidPaidSale, customPrice: rules.customPrice, paymentFix: rules.paymentFix });

function CashierRulesPanel({ hasCashiers }: { hasCashiers: boolean | undefined }) {
  const rules = useQuery(api.settings.cashierRules.getCashierRules, {});
  return (
    <Section
      title="Cashier rules"
      label="Cashier rules"
      tip={<>Cashiers can always sell, take payment and apply valid coupons. Anything set to Manager approves becomes a request.</>}
      action={hasCashiers === false ? <Badge variant="muted">No cashiers</Badge> : null}
    >
      {rules === undefined ? <div className="grid place-items-center py-8"><Spinner label="Loading cashier rules" /></div> : <RulesForm rules={rules} />}
    </Section>
  );
}

function RulesForm({ rules }: { rules: CashierRules }) {
  const id = useId();
  const update = useMutation(api.settings.cashierRules.updateCashierRules);
  const [revision, setRevision] = useState(rules.revision);
  const [draft, setDraft] = useState<Draft>(() => draftOf(rules));
  const [state, setState] = useState<{ saving: boolean; saved: boolean; error: string; notice: string }>({ saving: false, saved: false, error: "", notice: "" });
  const lock = useRef(false);
  const [reload, setReload] = useState(false);
  if (reload && rules.revision !== revision) {
    setReload(false);
    setRevision(rules.revision);
    setDraft(draftOf(rules));
  }
  const problem = limitProblem(draft.limit);
  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setState((current) => ({ ...current, saved: false, notice: "" }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || problem) return;
    lock.current = true;
    setState({ saving: true, saved: false, error: "", notice: "" });
    try {
      const saved = await update({
        expectedRevision: revision,
        discountLimitPercent: percentToBasisPoints(Number(draft.limit)),
        voidPaidSale: draft.voidPaidSale,
        customPrice: draft.customPrice,
        paymentFix: draft.paymentFix,
        refund: draft.refund,
      });
      setRevision(saved.revision);
      setDraft(draftOf(saved));
      setState({ saving: false, saved: true, error: "", notice: "" });
    } catch (err) {
      if (isStaleRules(err)) {
        // Someone else saved first: show theirs (as soon as they arrive), so nothing is overwritten unseen.
        setReload(true);
        setState({ saving: false, saved: false, error: "", notice: "Rules changed on another device. Reloaded." });
      } else setState({ saving: false, saved: false, error: errorText(err, "Couldn’t save the rules."), notice: "" });
    } finally {
      lock.current = false;
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-1" aria-label="Cashier rules">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5">
        <Label htmlFor={`${id}-limit`}>Discount without approval</Label>
        <span className="flex items-center gap-1.5">
          <Input
            id={`${id}-limit`}
            inputMode="decimal"
            className={cn("h-10 w-24 text-right tabular-nums", problem && "border-destructive")}
            value={draft.limit}
            disabled={state.saving}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-limit-error` : undefined}
            onChange={(e) => set({ limit: e.target.value.replace(/[^\d.]/g, "") })}
          />
          <span aria-hidden className="text-sm text-muted-foreground">%</span>
        </span>
        {problem ? <p id={`${id}-limit-error`} className="w-full text-right text-xs text-destructive">{problem}</p> : null}
      </div>
      {RULES.map(({ key, label }) => (
        <div key={key} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5">
          <Label htmlFor={`${id}-${key}`}>{label}</Label>
          <select id={`${id}-${key}`} className={SELECT} value={draft[key]} disabled={state.saving} onChange={(e) => set({ [key]: e.target.value as Permission } as Partial<Draft>)}>
            <option value="manager">Manager approves</option>
            <option value="cashier">Cashier can</option>
          </select>
        </div>
      ))}
      {state.error ? <p role="alert" className="pt-2 text-sm text-destructive">{state.error}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-3">
        <span role="status" className="text-sm text-muted-foreground">
          {state.notice ? state.notice : state.saved ? <span className={cn("inline-flex items-center gap-1", TONES.success.text)}><Check aria-hidden className="size-4" /> Saved</span> : rules.revision > revision ? <>Changed on another device. <Button type="button" variant="link" className="h-auto p-0" onClick={() => { setRevision(rules.revision); setDraft(draftOf(rules)); }}>Load latest</Button></> : ""}
        </span>
        <Button type="submit" disabled={state.saving || Boolean(problem)}>
          {state.saving ? <Spinner label="Saving" className="text-current" /> : null}
          Save rules
        </Button>
      </div>
    </form>
  );
}
