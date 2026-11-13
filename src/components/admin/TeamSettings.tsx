"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { CashierRules } from "convex/lib/staffTypes";
import { Check, UserPlus } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { personLabel } from "./person-label";
import { ROLE_LABELS } from "./staff-access";
import { TONES } from "./status-tones";

type Person = FunctionReturnType<typeof api.staffAccess.listPeople>[number];
type StaffRole = "manager" | "cashier";
/** Stored Marketing roles. "manager" is shown as Lead; the stored value is unchanged. */
type MarketingRole = "manager" | "marketer" | "finance" | "viewer";
type Permission = CashierRules["voidPaidSale"];
type RuleKey = "refund" | "voidPaidSale" | "customPrice" | "paymentFix";

const RULES: { key: RuleKey; label: string }[] = [
  { key: "refund", label: "Refund" },
  { key: "voidPaidSale", label: "Void" },
  { key: "customPrice", label: "Custom price" },
  { key: "paymentFix", label: "Correct payment" },
];
const DESK_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: "manager", label: ROLE_LABELS.manager },
  { value: "cashier", label: ROLE_LABELS.cashier },
];
export const MARKETING_ROLE_LABELS: Record<MarketingRole, string> = { manager: "Lead", marketer: "Marketer", finance: "Finance", viewer: "Viewer" };
const MARKETING_OPTIONS = (Object.keys(MARKETING_ROLE_LABELS) as MarketingRole[]).map((value) => ({ value, label: MARKETING_ROLE_LABELS[value] }));

/** A native select: reliable on iPad and phones, themed for dark mode. */
const SELECT = "h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground disabled:opacity-60 dark:[color-scheme:dark] pointer-coarse:min-h-11";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where an invited person signs in: /admin asks them to sign in, then to activate the invite. */
export function staffSignInLink(origin = window.location.origin) {
  return `${origin}/admin`;
}
/** Marketing invites are activated on the Marketing page. */
export function marketingSignInLink(origin = window.location.origin) {
  return `${origin}/admin/marketing`;
}

async function copyText(text: string) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Settings › Team: everyone with a Desk or Marketing role, plus what cashiers may do without a manager. */
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

const ROLES_TIP = (
  <span className="grid gap-1 text-left">
    <span><strong>Desk.</strong> Owner: everything. Manager: the desk and approvals. Cashier: Checkout, within the rules below.</span>
    <span><strong>Marketing.</strong> Lead: draft, publish, spend and partners. Marketer: drafts. Finance: spend and credits. Viewer: read only.</span>
  </span>
);

function PeoplePanel({ people }: { people: Person[] | undefined }) {
  const setStaffGrant = useMutation(api.staffAccess.setGrant);
  const updateInvitation = useMutation(api.staffAccess.updateInvitation);
  const setMarketingGrant = useMutation(api.marketingAccess.setGrant);
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

  async function setDesk(person: Person, role: StaffRole | null) {
    const name = personLabel(person.email);
    if (role === null) {
      if (!(await confirm({ title: `Remove ${name} from the desk?`, description: "Their desk access ends now. Marketing access, if any, stays.", confirmLabel: "Remove", cancelLabel: "Keep access", destructive: true }))) return;
      await save(person.email, () => setStaffGrant({ email: person.email, role: null }), `Removed ${name} from the desk.`);
      return;
    }
    const done = person.staffGrant ? `${name} is now ${ROLE_LABELS[role]}.` : `Invited ${name} to the desk as ${ROLE_LABELS[role]}.`;
    await save(person.email, () => setStaffGrant({ email: person.email, role }), done);
  }

  async function setMarketing(person: Person, role: MarketingRole | null) {
    const name = personLabel(person.email);
    if (role === null) {
      if (!(await confirm({ title: `Remove ${name} from Marketing?`, description: "Their Marketing access ends now. Desk access, if any, stays.", confirmLabel: "Remove", cancelLabel: "Keep access", destructive: true }))) return;
      await save(person.email, () => setMarketingGrant({ email: person.email, role: null }), `Removed ${name} from Marketing.`);
      return;
    }
    const label = MARKETING_ROLE_LABELS[role];
    const done = person.marketingGrant ? `${name} is now Marketing ${label}.` : `Invited ${name} to Marketing as ${label}.`;
    await save(person.email, () => setMarketingGrant({ email: person.email, role }), done);
  }

  return (
    <Section
      title="People"
      label="People"
      tip={ROLES_TIP}
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
          onInvite={async (email, desk, marketing) => {
            const ok = await save(
              email,
              async () => {
                if (desk) await setStaffGrant({ email, role: desk });
                if (marketing) await setMarketingGrant({ email, role: marketing });
              },
              `Invited ${personLabel(email)}. They sign in with ${email} to activate it.`,
            );
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
              key={`${person.email}:${person.staffGrant?.role ?? ""}:${person.marketingGrant?.role ?? ""}`}
              person={person}
              busy={busy !== null}
              onDesk={(role) => void setDesk(person, role)}
              onMarketing={(role) => void setMarketing(person, role)}
              onRenew={() => {
                const staff = person.staffGrant && !person.staffGrant.claimed ? person.staffGrant : null;
                const marketing = person.marketingGrant && !person.marketingGrant.claimed ? person.marketingGrant : null;
                // Renewing only extends the invite's deadline; no email is sent. Saving an unclaimed
                // Marketing invite with its own role renews it.
                void save(
                  person.email,
                  async () => {
                    if (staff) await updateInvitation({ grantId: staff.id as Id<"staffGrants">, action: "resend" });
                    if (marketing) await setMarketingGrant({ email: person.email, role: marketing.role as MarketingRole });
                  },
                  `Invite renewed for ${personLabel(person.email)}.`,
                );
              }}
              onCopyLink={async () => {
                const staffPending = person.staffGrant && !person.staffGrant.claimed;
                const link = staffPending ? staffSignInLink() : marketingSignInLink();
                setMessage(
                  (await copyText(link))
                    ? { text: `Sign-in link copied. ${personLabel(person.email)} signs in there with ${person.email} to activate the invite.` }
                    : { text: `Couldn’t copy. Send ${personLabel(person.email)} this sign-in link: ${link}`, error: true },
                );
              }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function InviteForm({ busy, onInvite, onCancel }: {
  busy: boolean;
  onInvite: (email: string, desk: StaffRole | null, marketing: MarketingRole | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [desk, setDesk] = useState<StaffRole | "">("cashier");
  const [marketing, setMarketing] = useState<MarketingRole | "">("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) {
      setError("Enter a valid email.");
      return;
    }
    if (!desk && !marketing) {
      setError("Pick a Desk or Marketing role.");
      return;
    }
    setError("");
    if (await onInvite(address, desk || null, marketing || null)) setEmail("");
  }
  return (
    <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" aria-label="Invite">
      <div className="grid min-w-0 gap-1.5 sm:col-span-3">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input id={`${id}-email`} type="email" required maxLength={254} autoFocus value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-invalid={error ? true : undefined} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-desk`}>Desk</Label>
        <select id={`${id}-desk`} className={SELECT} value={desk} disabled={busy} onChange={(e) => setDesk(e.target.value as StaffRole | "")}>
          {DESK_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          <option value="">No desk access</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-marketing`}>Marketing</Label>
        <select id={`${id}-marketing`} className={SELECT} value={marketing} disabled={busy} onChange={(e) => setMarketing(e.target.value as MarketingRole | "")}>
          <option value="">No Marketing access</option>
          {MARKETING_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="flex gap-2 sm:justify-end">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || !email.trim()}>Send invite</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-3">{error}</p> : null}
    </form>
  );
}

type Grant = NonNullable<Person["staffGrant"]>;
function inviteState(grant: Grant | null, prefix = "") {
  if (!grant || grant.claimed) return null;
  if (grant.expired) return `${prefix}Invite expired`;
  return grant.expiresAt ? `${prefix}Invited · expires ${staffDate(grant.expiresAt)}` : `${prefix}Invited`;
}

/** "Cashier · Marketing Viewer": a person's roles as one line of text. */
function rolesText(person: Person) {
  const desk = person.staffGrant ? ROLE_LABELS[person.staffGrant.role as StaffRole] : null;
  const marketing = person.marketingGrant ? `Marketing ${MARKETING_ROLE_LABELS[person.marketingGrant.role as MarketingRole]}` : null;
  return [desk, marketing].filter(Boolean).join(" · ") || "No access";
}

function PersonRow({ person, busy, onDesk, onMarketing, onRenew, onCopyLink }: {
  person: Person;
  busy: boolean;
  onDesk: (role: StaffRole | null) => void;
  onMarketing: (role: MarketingRole | null) => void;
  onRenew: () => void;
  onCopyLink: () => Promise<void>;
}) {
  const id = useId();
  // The row remounts after a role change (its key holds the roles), so the selects close on their own.
  const [changing, setChanging] = useState(false);
  const grant = person.staffGrant;
  const marketing = person.marketingGrant;
  const owner = person.role === "owner";
  const name = personLabel(person.email);
  const pending = [grant, marketing].filter((row): row is Grant => Boolean(row && !row.claimed));
  const states = owner ? [] : [inviteState(grant), inviteState(marketing, "Marketing: ")].filter(Boolean);
  const linkWorks = pending.some((row) => !row.expired);
  const allExpired = pending.length > 0 && !linkWorks;
  return (
    <li className="grid gap-2 py-3 first:pt-0 last:pb-0" data-testid="team-person">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold uppercase text-muted-foreground">{name[0]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="text-xs break-all text-muted-foreground">{person.email}</p>
          <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span data-testid="team-roles">{owner ? "Owner · all access" : rolesText(person)}</span>
            {states.map((state) => <span key={state}>{state}</span>)}
          </p>
        </div>
        {owner ? null : (
          <div className="flex shrink-0 items-center gap-1">
            {/* An expired invite only works again once renewed, so Renew is the row's one action. */}
            {allExpired ? <Button size="sm" variant="outline" disabled={busy} onClick={onRenew}>Renew</Button> : null}
            <Button size="sm" variant="outline" aria-expanded={changing} aria-controls={`${id}-roles`} aria-label={`Change roles for ${name}`} disabled={busy} onClick={() => setChanging(!changing)}>
              Change
            </Button>
            <MoreMenu
              label={`More for ${name}`}
              disabled={busy}
              items={[
                { label: "Copy sign-in link", onSelect: () => void onCopyLink(), hidden: !linkWorks },
                { label: "Renew invite", onSelect: onRenew, hidden: !linkWorks },
              ]}
            />
          </div>
        )}
      </div>
      {changing && !owner ? (
        <div id={`${id}-roles`} className="flex flex-wrap gap-2 pl-12">
          <div className="grid gap-1">
            <Label htmlFor={`${id}-desk`} className="text-xs font-normal text-muted-foreground">Desk</Label>
            <select
              id={`${id}-desk`}
              aria-label={`Desk role for ${name}`}
              className={SELECT}
              value={grant?.role ?? ""}
              disabled={busy}
              onChange={(e) => onDesk((e.target.value || null) as StaffRole | null)}
            >
              {DESK_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              <option value="">None</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-marketing`} className="text-xs font-normal text-muted-foreground">Marketing</Label>
            <select
              id={`${id}-marketing`}
              aria-label={`Marketing role for ${name}`}
              className={SELECT}
              value={marketing?.role ?? ""}
              disabled={busy}
              onChange={(e) => onMarketing((e.target.value || null) as MarketingRole | null)}
            >
              {MARKETING_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              <option value="">None</option>
            </select>
          </div>
        </div>
      ) : null}
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
const draftOf = (rules: CashierRules): Draft => ({ limit: String(rules.discountLimitPercent), refund: rules.refund ?? "manager", voidPaidSale: rules.voidPaidSale, customPrice: rules.customPrice, paymentFix: rules.paymentFix });
const sameDraft = (a: Draft, b: Draft) => Number(a.limit) === Number(b.limit) && a.limit.trim() !== "" && RULES.every(({ key }) => a[key] === b[key]);

function CashierRulesPanel({ hasCashiers }: { hasCashiers: boolean | undefined }) {
  const rules = useQuery(api.staffAccess.getCashierRules, {});
  return (
    <Section
      title="Rules for all cashiers"
      label="Rules for all cashiers"
      tip={<>Cashiers can always sell, take payment and apply valid coupons. Anything that needs a manager becomes a request.</>}
      action={hasCashiers === false ? <Badge variant="muted">No cashiers</Badge> : null}
    >
      {rules === undefined ? <div className="grid place-items-center py-8"><Spinner label="Loading cashier rules" /></div> : <RulesForm rules={rules} />}
    </Section>
  );
}

/** An on/off switch: on means the action needs a manager. */
function NeedsManagerSwitch({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label} needs manager`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        // A 44px touch target without moving the layout.
        "after:absolute after:-inset-2 after:content-['']",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span aria-hidden className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function RulesForm({ rules }: { rules: CashierRules }) {
  const id = useId();
  const update = useMutation(api.staffAccess.updateCashierRules);
  const [revision, setRevision] = useState(rules.revision);
  const [base, setBase] = useState<Draft>(() => draftOf(rules));
  const [draft, setDraft] = useState<Draft>(() => draftOf(rules));
  const [state, setState] = useState<{ saving: boolean; saved: boolean; error: string; notice: string }>({ saving: false, saved: false, error: "", notice: "" });
  const lock = useRef(false);
  const [reload, setReload] = useState(false);
  const load = (next: CashierRules) => {
    setRevision(next.revision);
    setBase(draftOf(next));
    setDraft(draftOf(next));
  };
  if (reload && rules.revision !== revision) {
    setReload(false);
    load(rules);
  }
  const problem = limitProblem(draft.limit);
  const dirty = !sameDraft(draft, base);
  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setState((current) => ({ ...current, saved: false, notice: "" }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || problem || !dirty) return;
    lock.current = true;
    setState({ saving: true, saved: false, error: "", notice: "" });
    try {
      const saved = await update({
        expectedRevision: revision,
        discountLimitPercent: Number(draft.limit),
        voidPaidSale: draft.voidPaidSale,
        customPrice: draft.customPrice,
        paymentFix: draft.paymentFix,
        refund: draft.refund,
      });
      load(saved);
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
    <form onSubmit={submit} noValidate className="grid" aria-label="Rules for all cashiers">
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
      <p aria-hidden className="pt-3 pb-1 text-right text-xs font-medium text-muted-foreground">Needs manager</p>
      {RULES.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-3 border-b border-border py-2.5">
          <Label htmlFor={`${id}-${key}`}>{label}</Label>
          <NeedsManagerSwitch
            id={`${id}-${key}`}
            label={label}
            checked={draft[key] === "manager"}
            disabled={state.saving}
            onChange={(on) => set({ [key]: on ? "manager" : "cashier" } as Partial<Draft>)}
          />
        </div>
      ))}
      {state.error ? <p role="alert" className="pt-2 text-sm text-destructive">{state.error}</p> : null}
      {/* Sticky, so Save stays in reach on a phone; above the phone tab bar in the admin shell. */}
      <div className="sticky bottom-[var(--admin-tab-bar,0px)] z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur" data-testid="rules-save-bar">
        <span role="status" className="text-sm text-muted-foreground">
          {state.notice ? state.notice : state.saved ? <span className={cn("inline-flex items-center gap-1", TONES.success.text)}><Check aria-hidden className="size-4" /> Saved</span> : rules.revision > revision ? <>Changed on another device. <Button type="button" variant="link" className="h-auto p-0" onClick={() => load(rules)}>Load latest</Button></> : ""}
        </span>
        <Button type="submit" disabled={state.saving || Boolean(problem) || !dirty}>
          {state.saving ? <Spinner label="Saving" className="text-current" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
