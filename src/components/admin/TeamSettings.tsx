"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { CashierRules } from "convex/lib/staffTypes";
import { Check, UserPlus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { FieldLabel as Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
export const MARKETING_ROLE_LABELS: Record<MarketingRole, string> = { manager: "Lead", marketer: "Editor", finance: "Finance", viewer: "Viewer" };
const MARKETING_OPTIONS = (Object.keys(MARKETING_ROLE_LABELS) as MarketingRole[]).map((value) => ({ value, label: MARKETING_ROLE_LABELS[value] }));

function RoleSelect<T extends string>({ id, label, value, disabled, onChange, options, empty }: { id: string; label?: string; value: T | ""; disabled: boolean; onChange: (value: T | "") => void; options: { value: T; label: string }[]; empty: string }) {
  return <Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next as T)} disabled={disabled}>
    <SelectTrigger id={id} aria-label={label} className="min-w-40 font-normal"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}<SelectItem value="none">{empty}</SelectItem></SelectContent>
  </Select>;
}
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
export function TeamSettings({ onDirtyChange, confirmDiscard }: { onDirtyChange?: (dirty: boolean) => void; confirmDiscard?: () => Promise<boolean> } = {}) {
  const [inviteDirty, setInviteDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(inviteDirty || rulesDirty); return () => onDirtyChange?.(false); }, [inviteDirty, rulesDirty, onDirtyChange]);
  // The containing settings page owns navigation; standalone uses keep the same guard.
  const localGuard = useUnsavedGuard(!confirmDiscard && (inviteDirty || rulesDirty));
  const people = useQuery(api.staffAccess.listPeople, {});
  return (
    <>
      <header className="px-1 pt-1"><h2 className="font-serif text-3xl">Team</h2></header>
      <PeoplePanel people={people} inviteDirty={inviteDirty} onDirtyChange={setInviteDirty} confirmDiscard={confirmDiscard ?? localGuard.confirmDiscard} />
      <CashierRulesPanel onDirtyChange={setRulesDirty} hasCashiers={people === undefined ? undefined : people.some((person) => person.role === "cashier")} />
    </>
  );
}

function Section({ title, tip, action, children, label }: { title: string; tip: ReactNode; action?: ReactNode; children: ReactNode; label: string }) {
  return (
    <Card role="region" aria-label={label}>
      <header className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
          {title}
          <InfoTip label={`About ${title.toLowerCase()}`}>{tip}</InfoTip>
        </h2>
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </header>
      <div className="p-4 pt-3 sm:p-5">{children}</div>
    </Card>
  );
}

const ROLES_TIP = (
  <span className="grid gap-1 text-left">
    <span><strong>Desk.</strong> Owner: everything. Manager: the desk and approvals. Cashier: Checkout, within the rules below.</span>
    <span><strong>Marketing.</strong> Lead: draft, publish, spend and partners. Editor: drafts. Finance: spend and credits. Viewer: read only.</span>
  </span>
);

function PeoplePanel({ people, inviteDirty, onDirtyChange, confirmDiscard }: { people: Person[] | undefined; inviteDirty: boolean; onDirtyChange: (dirty: boolean) => void; confirmDiscard: () => Promise<boolean> }) {
  const setStaffGrant = useMutation(api.staffAccess.setGrant);
  const updateInvitation = useMutation(api.staffAccess.updateInvitation);
  const setMarketingGrant = useMutation(api.marketingAccess.setGrant);
  const confirm = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean; email: string } | null>(null);

  async function save(email: string, task: () => Promise<unknown>, done: string) {
    if (busy) return false;
    setBusy(email);
    setMessage(null);
    try {
      await task();
      setMessage({ text: done, email });
      return true;
    } catch (err) {
      setMessage({ text: errorText(err, "Couldn’t save. Try again."), error: true, email });
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
        <Button size="sm" disabled={busy !== null} aria-expanded={inviting} onClick={async () => { if (!inviting || !inviteDirty || await confirmDiscard()) setInviting(!inviting); }}>
          <UserPlus aria-hidden className="size-4" /> Invite
        </Button>
      }
    >
      {inviting ? (
        <InviteForm
          busy={busy !== null}
          onDirtyChange={onDirtyChange}
          onCancel={async () => { if (!inviteDirty || await confirmDiscard()) setInviting(false); }}
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
      {message && !people?.some((person) => person.email === message.email) ? (
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
              saving={busy === person.email}
              message={message?.email === person.email ? message : null}
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
                    ? { email: person.email, text: `Sign-in link copied. ${personLabel(person.email)} signs in there with ${person.email} to activate the invite.` }
                    : { email: person.email, text: `Couldn’t copy. Send ${personLabel(person.email)} this sign-in link: ${link}`, error: true },
                );
              }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function InviteForm({ busy, onInvite, onCancel, onDirtyChange }: {
  onDirtyChange: (dirty: boolean) => void;
  busy: boolean;
  onInvite: (email: string, desk: StaffRole | null, marketing: MarketingRole | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [desk, setDesk] = useState<StaffRole | "">("cashier");
  const [marketing, setMarketing] = useState<MarketingRole | "">("");
  const [error, setError] = useState("");
  const dirty = Boolean(email || desk !== "cashier" || marketing);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
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
        <RoleSelect id={`${id}-desk`} value={desk} disabled={busy} onChange={setDesk} options={DESK_OPTIONS} empty="No desk access" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-marketing`}>Marketing</Label>
        <RoleSelect id={`${id}-marketing`} value={marketing} disabled={busy} onChange={setMarketing} options={MARKETING_OPTIONS} empty="No Marketing access" />
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
  return grant.expiresAt ? `${prefix}Invited · until ${staffDate(grant.expiresAt)}` : `${prefix}Invited`;
}

/** "Cashier · Marketing Viewer": a person's roles as one line of text. */
function rolesText(person: Person) {
  const desk = person.staffGrant ? ROLE_LABELS[person.staffGrant.role as StaffRole] : null;
  const marketing = person.marketingGrant ? `Marketing ${MARKETING_ROLE_LABELS[person.marketingGrant.role as MarketingRole]}` : null;
  return [desk, marketing].filter(Boolean).join(" · ") || "No access";
}

function PersonRow({ person, busy, saving, message, onDesk, onMarketing, onRenew, onCopyLink }: {
  person: Person;
  busy: boolean;
  saving: boolean;
  message: { text: string; error?: boolean } | null;
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
    <li className="grid gap-2 py-1.5 first:pt-0 last:pb-0" data-testid="team-person">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">{name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-[13px] break-all text-muted-foreground">{person.email}</p>{states.map((state) => <Badge key={state} variant="muted" className={cn("rounded-full text-xs font-medium", state?.includes("Invite expired") && [TONES.danger.bg, TONES.danger.text, TONES.danger.border])}>{state}</Badge>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:col-span-2">
          <Badge variant="muted" className="mr-auto max-w-full rounded-full text-xs" data-testid="team-roles">{owner ? "Owner · all access" : rolesText(person)}</Badge>
          {owner ? <span aria-hidden className="w-[7.25rem] max-sm:hidden" /> : (
            <div className="flex shrink-0 items-center gap-1">
              {/* An expired invite only works again once renewed, so Renew is the row's one action. */}
              {allExpired ? <Button size="sm" variant="outline" disabled={busy} onClick={onRenew}>Renew</Button> : null}
              <Button size="sm" variant="outline" aria-expanded={changing} aria-controls={`${id}-roles`} aria-label={`Change roles for ${name}`} disabled={busy} onClick={() => setChanging(!changing)}>
                {saving ? <Spinner label="Saving role" className="text-current" /> : null}Change
              </Button>
              {linkWorks ? <MoreMenu
                label={`More for ${name}`}
                disabled={busy}
                items={[
                  { label: "Copy sign-in link", onSelect: () => void onCopyLink(), hidden: !linkWorks },
                  { label: "Renew invite", onSelect: onRenew, hidden: !linkWorks },
                ]}
              /> : <span aria-hidden className="size-11 max-sm:hidden" />}
            </div>
          )}
        </div>

      </div>
      {message ? <p role={message.error ? "alert" : "status"} className={cn("text-[13px]", message.error ? "text-destructive" : "text-muted-foreground")}>{message.text}</p> : null}
      {changing && !owner ? (
        <div id={`${id}-roles`} className="flex flex-wrap gap-3 rounded-lg bg-muted/40 p-3">
          <p className="w-full text-[13px] text-muted-foreground">Role changes apply immediately.</p>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-desk`} className="text-xs font-normal text-muted-foreground">Desk</Label>
            <RoleSelect id={`${id}-desk`} label={`Desk role for ${name}`} value={(grant?.role ?? "") as StaffRole | ""} disabled={busy} onChange={(value) => onDesk(value || null)} options={DESK_OPTIONS} empty="None" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-marketing`} className="text-xs font-normal text-muted-foreground">Marketing</Label>
            <RoleSelect id={`${id}-marketing`} label={`Marketing role for ${name}`} value={(marketing?.role ?? "") as MarketingRole | ""} disabled={busy} onChange={(value) => onMarketing(value || null)} options={MARKETING_OPTIONS} empty="None" />
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

function CashierRulesPanel({ hasCashiers, onDirtyChange }: { hasCashiers: boolean | undefined; onDirtyChange?: (dirty: boolean) => void }) {
  const rules = useQuery(api.staffAccess.getCashierRules, {});
  return (
    <Section
      title="Rules for all cashiers"
      label="Rules for all cashiers"
      tip={<>Cashiers can always sell, take payment and apply valid coupons. Anything that needs a manager becomes a request.</>}
      action={hasCashiers === false ? <Badge variant="muted" className="rounded-full">No cashiers</Badge> : null}
    >
      {rules === undefined ? <div className="grid place-items-center py-8"><Spinner label="Loading cashier rules" /></div> : <RulesForm rules={rules} onDirtyChange={onDirtyChange} />}
    </Section>
  );
}

function RulesForm({ rules, onDirtyChange }: { rules: CashierRules; onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId();
  const update = useMutation(api.staffAccess.updateCashierRules);
  const [revision, setRevision] = useState(rules.revision);
  const [base, setBase] = useState<Draft>(() => draftOf(rules));
  const [draft, setDraft] = useState<Draft>(() => draftOf(rules));
  const [state, setState] = useState<{ saving: boolean; saved: boolean; error: string }>({ saving: false, saved: false, error: "" });
  const lock = useRef(false);
  const [stale, setStale] = useState(false);
  const load = (next: CashierRules) => {
    setStale(false);
    setRevision(next.revision);
    setBase(draftOf(next));
    setDraft(draftOf(next));
  };
  const problem = limitProblem(draft.limit);
  const dirty = !sameDraft(draft, base);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setState((current) => ({ ...current, saved: false }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || problem || !dirty || stale || rules.revision > revision) return;
    lock.current = true;
    setState({ saving: true, saved: false, error: "" });
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
      setState({ saving: false, saved: true, error: "" });
    } catch (err) {
      if (isStaleRules(err)) {
        // Keep the local draft until the owner explicitly reviews the latest revision.
        setStale(true);
        setState({ saving: false, saved: false, error: "" });
      } else setState({ saving: false, saved: false, error: errorText(err, "Couldn’t save the rules.") });
    } finally {
      lock.current = false;
    }
  }

  return (
    <form onSubmit={submit} noValidate className={cn("grid", dirty && "pb-20")} aria-label="Rules for all cashiers">
      <div className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3 border-b border-border py-2.5">
        <Label htmlFor={`${id}-limit`}>Discount without approval</Label>
        <span className="flex w-44 items-center gap-1.5">
          <Input
            id={`${id}-limit`}
            inputMode="decimal"
            className={cn("h-10 min-w-0 flex-1 text-right tabular-nums", problem && "border-destructive")}
            value={draft.limit}
            disabled={state.saving}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-limit-error` : undefined}
            onChange={(e) => set({ limit: e.target.value.replace(/[^\d.]/g, "") })}
          />
          <span aria-hidden className="text-sm text-muted-foreground">%</span>
        </span>
        {problem ? <p id={`${id}-limit-error`} className="col-span-2 text-right text-xs text-destructive">{problem}</p> : null}
      </div>
      <p className="pt-4 pb-1 text-[13px] font-medium text-foreground">Without approval</p>
      {RULES.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-3 border-b border-border py-2.5">
          <Label htmlFor={`${id}-${key}`}>{label}</Label>
          <ToggleGroup id={`${id}-${key}`} variant="segmented" tone="subtle" className="w-44 shrink-0" value={draft[key]} onValueChange={(value: Permission) => set({ [key]: value })} aria-label={`${label} permission`} disabled={state.saving}>
            <ToggleGroupItem value="cashier">Cashier</ToggleGroupItem><ToggleGroupItem value="manager">Manager</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ))}
      {state.error ? <p role="alert" className="pt-2 text-sm text-destructive">{state.error}</p> : null}
      <div role="status" className="pt-3 text-sm text-muted-foreground">
        {stale || rules.revision > revision ? <>Rules changed on another device. Review latest before saving. <Button type="button" variant="outline" size="sm" disabled={state.saving || stale && rules.revision <= revision} onClick={() => { load(rules); setState({ saving: false, saved: false, error: "" }); }}>Reload latest</Button></> : state.saved ? <span className={cn("inline-flex items-center gap-1", TONES.success.text)}><Check aria-hidden className="size-4" /> Saved</span> : ""}
      </div>
      {dirty ? (
        <div className="sticky bottom-[var(--admin-tab-bar,0px)] z-10 mt-3 rounded-xl flex flex-wrap items-center justify-end gap-3 border border-border bg-card/95 px-4 py-3 backdrop-blur" data-testid="rules-save-bar">
          <span className="mr-auto text-[13px] text-muted-foreground">Unsaved changes</span>
          <Button type="button" variant="ghost" disabled={state.saving} onClick={() => { setDraft(base); setState({ saving: false, saved: false, error: "" }); }}>Discard</Button>
          <Button type="submit" disabled={state.saving || Boolean(problem) || !dirty || stale || rules.revision > revision}>
            {state.saving ? <Spinner label="Saving" className="text-current" /> : null}
            Save
          </Button>
        </div>
      ) : null}
    </form>
  );
}
