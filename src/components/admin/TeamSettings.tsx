"use client";

import { basisPointsToPercent, percentToBasisPoints } from 'convex/shared/money';

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { CashierRules } from "convex/shared/staffTypes";
import { Check, Info, RotateCw, UserPlus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { FieldLabel as Label, Label as RuleLabel } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { errorText } from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { personLabel } from "./person-label";
import { ROLE_LABELS, useStaffAccess } from "./staff-access";
import { StatusBadge } from "./StatusBadge";
import { TONES } from "./status-tones";
import { NumberField } from "./marketing/MarketingBits";
import { BranchMultiSelect, type SelectableBranch } from "./branches/BranchMultiSelect";
import { BranchPill } from "./branches/branch-status";

type Person = FunctionReturnType<typeof api.auth.staffAccess.listPeople>[number];
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

function uniqueBranchIds(ids: readonly Id<"branches">[]): Id<"branches">[] {
  return Array.from(new Set(ids));
}

function sameBranchSelection(a: readonly Id<"branches">[], b: readonly Id<"branches">[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Settings › Team: everyone with a Desk or Marketing role, owners & recovery, and cashier rules. */
export function TeamSettings({ onDirtyChange, confirmDiscard }: { onDirtyChange?: (dirty: boolean) => void; confirmDiscard?: () => Promise<boolean> } = {}) {
  const [inviteDirty, setInviteDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(inviteDirty || rulesDirty); return () => onDirtyChange?.(false); }, [inviteDirty, rulesDirty, onDirtyChange]);
  // The containing settings page owns navigation; standalone uses keep the same guard.
  const localGuard = useUnsavedGuard(!confirmDiscard && (inviteDirty || rulesDirty));
  const people = useQuery(api.auth.staffAccess.listPeople, {});
  const branchRows = useQuery(api.branches.branches.list, {});
  const { branches: accessBranches } = useStaffAccess();

  const { assignableBranches, branchById, defaultBranchIds } = useMemo(() => {
    const all: Array<SelectableBranch & { key: string }> = branchRows
      ? branchRows.map((row) => ({ id: row._id, key: row.key, name: row.name, state: row.state }))
      : accessBranches.map((row) => ({ id: row.id, key: row.key, name: row.name, state: row.state }));
    const assignable = all.filter((branch) => branch.state !== "archived");
    const preferred = assignable.find((branch) => branch.key === "koh-samui") ?? assignable.find((branch) => branch.state === "active") ?? assignable[0];
    return {
      assignableBranches: assignable,
      branchById: new Map(all.map((branch) => [branch.id, branch])),
      defaultBranchIds: preferred ? [preferred.id] : [],
    };
  }, [branchRows, accessBranches]);

  const owners = useMemo(() => people?.filter((person) => person.role === "owner") ?? [], [people]);

  return (
    <div className="grid max-w-4xl gap-4">
      <header className="px-1 pt-1">
        <h2 className="font-serif text-3xl">Team</h2>
        <p className="mt-1 text-pretty text-[13px] text-muted-foreground">Sign-in access, branches and cashier permissions.</p>
      </header>
      <PeoplePanel
        people={people}
        assignableBranches={assignableBranches}
        branchById={branchById}
        defaultBranchIds={defaultBranchIds}
        inviteDirty={inviteDirty}
        onDirtyChange={setInviteDirty}
        confirmDiscard={confirmDiscard ?? localGuard.confirmDiscard}
      />
      <OwnersRecoveryPanel owners={people === undefined ? undefined : owners} />
      <CashierRulesPanel onDirtyChange={setRulesDirty} hasCashiers={people === undefined ? undefined : people.some((person) => person.role === "cashier")} />
    </div>
  );
}

function Section({ title, tip, action, children, label }: { title: string; tip?: ReactNode; action?: ReactNode; children: ReactNode; label: string }) {
  return (
    <Card role="region" aria-label={label}>
      <header className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
          {title}
          {tip ? <InfoTip label={`About ${title.toLowerCase()}`}>{tip}</InfoTip> : null}
        </h2>
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </header>
      <div className="p-4 pt-3 sm:p-5">{children}</div>
    </Card>
  );
}

function OwnersRecoveryPanel({ owners }: { owners: Person[] | undefined }) {
  const count = owners?.length ?? 0;
  return (
    <Section
      title="Owners & recovery"
      label="Owners and recovery"
      action={owners ? <StatusBadge tone="success" label={`${count} company ${count === 1 ? "owner" : "owners"}`} /> : null}
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Company owners open every branch, assign access and run branch setup, activation and suspension. Branch managers can’t invite.
        </p>
        {owners === undefined ? (
          <div className="grid place-items-center py-6"><Spinner label="Loading company owners" /></div>
        ) : owners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No company owners found.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Company owners">
            {owners.map((owner) => (
              <li key={owner.email} data-testid="owner-recovery-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-[15px] font-medium text-foreground">{personLabel(owner.email)}</p>
                  <p className="text-[13px] break-all text-muted-foreground">{owner.email} · Managed by the deployment admin</p>
                </div>
                <StatusBadge tone="success" label="Company owner" />
              </li>
            ))}
          </ul>
        )}
        <p className="flex gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>Recovery is a command for the deployment admin. It grants owner access from the server and has no screen here.</span>
        </p>
      </div>
    </Section>
  );
}

const ROLES_TIP = (
  <span className="grid gap-1 text-left">
    <span><strong>Desk.</strong> Owner: everything. Manager: the desk and approvals. Cashier: Checkout, within the rules below.</span>
    <span><strong>Marketing.</strong> Lead: draft, publish, spend and partners. Editor: drafts. Finance: spend and credits. Viewer: read only.</span>
  </span>
);

function PeoplePanel({
  people,
  assignableBranches,
  branchById,
  defaultBranchIds,
  inviteDirty,
  onDirtyChange,
  confirmDiscard,
}: {
  people: Person[] | undefined;
  assignableBranches: readonly SelectableBranch[];
  branchById: ReadonlyMap<Id<"branches">, SelectableBranch>;
  defaultBranchIds: readonly Id<"branches">[];
  inviteDirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
  confirmDiscard: () => Promise<boolean>;
}) {
  const setStaffGrant = useMutation(api.auth.staffAccess.setGrant);
  const updateInvitation = useMutation(api.auth.staffAccess.updateInvitation);
  const setMarketingGrant = useMutation(api.marketing.access.setGrant);
  const confirm = useConfirm();
  const [inviting, setInviting] = useState(false);
  const peopleList = useRef<HTMLUListElement>(null);
  const inviteButton = useRef<HTMLButtonElement>(null);
  function restoreRoleFocus(email: string) {
    // A removed person's next row (or Invite) remains a useful keyboard destination.
    const index = people?.findIndex((person) => person.email === email) ?? -1;
    const candidates = [email, ...(people?.slice(index + 1).map((person) => person.email) ?? [])];
    requestAnimationFrame(() => {
      const rows = Array.from(peopleList.current?.querySelectorAll<HTMLElement>("[data-person-email]") ?? []);
      const target = candidates.flatMap((candidate) => rows.find((row) => row.dataset.personEmail === candidate)?.querySelector<HTMLButtonElement>("[data-change-role]") ?? [])[0];
      (target ?? inviteButton.current)?.focus();
    });
  }
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

  function inviteExpirySuffix(person: Person): string {
    const grant = person.staffGrant;
    if (!grant || grant.claimed || grant.expired || !grant.expiresAt) return "";
    return ` The invite still expires ${staffDate(grant.expiresAt)}.`;
  }

  function branchNamesFor(branchIds: readonly Id<"branches">[]): string {
    return branchIds.map((id) => branchById.get(id)?.name).filter((name): name is string => Boolean(name)).join(", ");
  }

  async function setDesk(person: Person, role: StaffRole | null) {
    const name = personLabel(person.email);
    if (role === null) {
      const places = branchNamesFor(person.branchIds ?? []);
      const description = `${name} loses desk access${places ? ` at ${places}` : ""} now, on every device. Open sessions lose access within seconds, and unsent work there isn’t submitted. Marketing access, if any, stays.`;
      if (!(await confirm({ title: `Remove ${name} from the desk?`, description, confirmLabel: "Remove", cancelLabel: "Keep access", destructive: true }))) return false;
      return save(person.email, () => setStaffGrant({ email: person.email, role: null, branchIds: [] }), `Removed ${name} from the desk.`);
    }
    const existingIds = (person.branchIds ?? []).filter((id) => {
      const branch = branchById.get(id);
      return branch !== undefined && branch.state !== "archived";
    });
    const branchIds = uniqueBranchIds(person.staffGrant ? (existingIds.length > 0 ? existingIds : [...defaultBranchIds]) : [...defaultBranchIds]);
    if (branchIds.length === 0) {
      setMessage({ text: "Select at least one branch.", error: true, email: person.email });
      return false;
    }
    const baseDone = person.staffGrant ? `${name} is now ${ROLE_LABELS[role]}.` : `Invited ${name} to the desk as ${ROLE_LABELS[role]}.`;
    const done = `${baseDone}${person.staffGrant ? inviteExpirySuffix(person) : ""}`;
    return save(person.email, () => setStaffGrant({ email: person.email, role, branchIds }), done);
  }

  async function setBranches(person: Person, branchIds: Id<"branches">[]) {
    if (!person.staffGrant || person.staffGrant.role === "owner") return false;
    const role = person.staffGrant.role;
    const unique = uniqueBranchIds(branchIds);
    if (unique.length === 0) {
      setMessage({ text: "Select at least one branch.", error: true, email: person.email });
      return false;
    }
    const name = personLabel(person.email);
    const places = branchNamesFor(unique);
    const done = `${name}’s branches are now ${places || "updated"}.${inviteExpirySuffix(person)}`;
    return save(person.email, () => setStaffGrant({ email: person.email, role, branchIds: unique }), done);
  }

  async function setMarketing(person: Person, role: MarketingRole | null) {
    const name = personLabel(person.email);
    if (role === null) {
      if (!(await confirm({ title: `Remove ${name} from Marketing?`, description: "Their Marketing access ends now. Desk access, if any, stays.", confirmLabel: "Remove", cancelLabel: "Keep access", destructive: true }))) return false;
      return save(person.email, () => setMarketingGrant({ email: person.email, role: null }), `Removed ${name} from Marketing.`);
    }
    const label = MARKETING_ROLE_LABELS[role];
    const done = person.marketingGrant ? `${name} is now Marketing ${label}.` : `Invited ${name} to Marketing as ${label}.`;
    return save(person.email, () => setMarketingGrant({ email: person.email, role }), done);
  }

  return (
    <Section
      title="People"
      label="People"
      tip={ROLES_TIP}
      action={
        <Button ref={inviteButton} size="sm" disabled={busy !== null} aria-expanded={inviting} onClick={() => { void (async () => { if (!inviting || !inviteDirty || await confirmDiscard()) setInviting(!inviting); })(); }}>
          <UserPlus aria-hidden className="size-4" /> Invite
        </Button>
      }
    >
      {inviting ? (
        <InviteForm
          busy={busy !== null}
          assignableBranches={assignableBranches}
          defaultBranchIds={defaultBranchIds}
          onDirtyChange={onDirtyChange}
          onCancel={() => { void (async () => { if (!inviteDirty || await confirmDiscard()) setInviting(false); })(); }}
          onInvite={async (email, desk, marketing, branchIds) => {
            const ok = await save(
              email,
              async () => {
                if (desk) await setStaffGrant({ email, role: desk, branchIds });
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
        <ul ref={peopleList} className="divide-y divide-border" aria-label="People with access">
          {people.map((person) => (
            <PersonRow
              key={person.email}
              person={person}
              assignableBranches={assignableBranches}
              branchById={branchById}
              busy={busy !== null}
              saving={busy === person.email}
              message={message?.email === person.email ? message : null}
              onDesk={(role) => setDesk(person, role)}
              onBranches={(branchIds) => setBranches(person, branchIds)}
              onRoleSaved={() => restoreRoleFocus(person.email)}
              onMarketing={(role) => setMarketing(person, role)}
              onRenew={() => {
                const staff = person.staffGrant && !person.staffGrant.claimed ? person.staffGrant : null;
                const marketing = person.marketingGrant && !person.marketingGrant.claimed ? person.marketingGrant : null;
                // Renewing only extends the invite's deadline; no email is sent. Saving an unclaimed
                // Marketing invite with its own role renews it.
                void save(
                  person.email,
                  async () => {
                    if (staff) await updateInvitation({ grantId: staff.id, action: "resend" });
                    if (marketing) await setMarketingGrant({ email: person.email, role: marketing.role });
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

function InviteForm({
  busy,
  assignableBranches,
  defaultBranchIds,
  onInvite,
  onCancel,
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  busy: boolean;
  assignableBranches: readonly SelectableBranch[];
  defaultBranchIds: readonly Id<"branches">[];
  onInvite: (email: string, desk: StaffRole | null, marketing: MarketingRole | null, branchIds: Id<"branches">[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [desk, setDesk] = useState<StaffRole | "">("cashier");
  const [marketing, setMarketing] = useState<MarketingRole | "">("");
  const [selectedBranches, setSelectedBranches] = useState<Id<"branches">[] | null>(null);
  const [error, setError] = useState("");

  const effectiveBranchIds = useMemo(
    () => (selectedBranches === null ? [...defaultBranchIds] : selectedBranches),
    [selectedBranches, defaultBranchIds],
  );
  const branchesChanged = selectedBranches !== null && !sameBranchSelection(selectedBranches, defaultBranchIds);
  const dirty = Boolean(email || desk !== "cashier" || marketing || branchesChanged);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);

  function toggleBranch(branchId: Id<"branches">) {
    setError("");
    setSelectedBranches((current) => {
      const base = current === null ? [...defaultBranchIds] : current;
      return base.includes(branchId) ? base.filter((entry) => entry !== branchId) : [...base, branchId];
    });
  }

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
    const branchIds = desk ? uniqueBranchIds(effectiveBranchIds) : [];
    if (desk && branchIds.length === 0) {
      setError("Select at least one branch.");
      return;
    }
    setError("");
    if (await onInvite(address, desk || null, marketing || null, branchIds)) {
      setEmail("");
      setSelectedBranches(null);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" aria-label="Invite">
      <div className="grid min-w-0 gap-1.5 sm:col-span-3">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input id={`${id}-email`} type="email" required maxLength={254} autoFocus value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-invalid={error ? true : undefined} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-desk`}>Desk</Label>
        <RoleSelect id={`${id}-desk`} value={desk} disabled={busy} onChange={(next) => { setDesk(next); setError(""); }} options={DESK_OPTIONS} empty="No desk access" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-marketing`}>Marketing</Label>
        <RoleSelect id={`${id}-marketing`} value={marketing} disabled={busy} onChange={(next) => { setMarketing(next); setError(""); }} options={MARKETING_OPTIONS} empty="No Marketing access" />
      </div>
      {desk ? (
        <div className="sm:col-span-3">
          <BranchMultiSelect
            branches={assignableBranches}
            selectedIds={effectiveBranchIds}
            disabled={busy}
            onToggle={toggleBranch}
          />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground sm:col-span-3">
        They sign in with this email to activate it. The invite expires in 14 days; editing its role or branches doesn’t change that.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-3">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-3 sm:justify-end">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || !email.trim()}>Send invite</Button>
      </div>
    </form>
  );
}

type Grant = NonNullable<Person["staffGrant"] | Person["marketingGrant"]>;
function inviteState(grant: Grant | null, prefix = "") {
  if (!grant || grant.claimed) return null;
  if (grant.expired) return `${prefix}Invite expired`;
  return grant.expiresAt ? `${prefix}Invited · expires ${staffDate(grant.expiresAt)}` : `${prefix}Invited`;
}

/** "Cashier · Marketing Viewer": a person's roles as one line of text. */
function rolesText(person: Person) {
  const desk = person.staffGrant ? ROLE_LABELS[person.staffGrant.role] : null;
  const marketing = person.marketingGrant ? `Marketing ${MARKETING_ROLE_LABELS[person.marketingGrant.role]}` : null;
  return [desk, marketing].filter(Boolean).join(" · ") || "No access";
}

function PersonRow({
  person,
  assignableBranches,
  branchById,
  busy,
  saving,
  message,
  onDesk,
  onBranches,
  onMarketing,
  onRoleSaved,
  onRenew,
  onCopyLink,
}: {
  person: Person;
  assignableBranches: readonly SelectableBranch[];
  branchById: ReadonlyMap<Id<"branches">, SelectableBranch>;
  busy: boolean;
  saving: boolean;
  message: { text: string; error?: boolean } | null;
  onDesk: (role: StaffRole | null) => Promise<boolean>;
  onBranches: (branchIds: Id<"branches">[]) => Promise<boolean>;
  onMarketing: (role: MarketingRole | null) => Promise<boolean>;
  onRoleSaved: () => void;
  onRenew: () => void;
  onCopyLink: () => Promise<void>;
}) {
  const id = useId();
  async function changeRole(task: () => Promise<boolean>) {
    if (await task()) {
      setChanging(false);
      onRoleSaved();
    }
  }
  const [changing, setChanging] = useState(false);
  const [branchError, setBranchError] = useState("");
  const grant = person.staffGrant;
  const marketing = person.marketingGrant;
  const owner = person.role === "owner";
  const name = personLabel(person.email);
  const pending = [grant, marketing].filter((row): row is Grant => Boolean(row && !row.claimed));
  const states = owner ? [] : [inviteState(grant), inviteState(marketing, "Marketing: ")].filter(Boolean);
  const linkWorks = pending.some((row) => !row.expired);
  const allExpired = pending.length > 0 && !linkWorks;
  const personBranchIds = person.branchIds ?? [];

  async function toggleAssignedBranch(branchId: Id<"branches">) {
    setBranchError("");
    const current = personBranchIds;
    const next = current.includes(branchId)
      ? current.filter((entry) => entry !== branchId)
      : [...current, branchId];
    if (next.length === 0) {
      setBranchError("Select at least one branch.");
      return;
    }
    await onBranches(next);
  }

  return (
    <li className="grid gap-2 py-2 first:pt-0 last:pb-0" data-testid="team-person" data-person-email={person.email}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">{name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] break-all text-muted-foreground">
              {person.email}
              {owner ? " · Managed by the deployment admin" : ""}
            </p>
            {states.map((state) => {
              const tone = state?.includes("Invite expired") ? TONES.danger : TONES.warning;
              return <Badge key={state} variant="muted" className={cn("rounded-full text-xs font-medium", tone.bg, tone.text, tone.border)}>{state}</Badge>;
            })}
          </div>
          {owner || personBranchIds.length > 0 || marketing ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="person-branch-chips">
              {owner ? (
                <BranchPill name="Company" company />
              ) : (
                <>
                  {personBranchIds.map((branchId) => (
                    <BranchPill key={branchId} name={branchById.get(branchId)?.name ?? branchId} />
                  ))}
                  {!grant && marketing ? <BranchPill name="Company" company /> : null}
                </>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex min-h-11 flex-wrap items-center gap-2 max-sm:col-span-2">
          <Badge variant="muted" className="max-sm:mr-auto max-w-full rounded-full text-xs font-medium" data-testid="team-roles">{owner ? "Owner · Company" : rolesText(person)}</Badge>
          {owner ? <span aria-hidden className="h-11 w-32 shrink-0" /> : (
            <div className="flex w-32 shrink-0 flex-nowrap items-center justify-end gap-1">
              <Button size="sm" variant="ghost" data-change-role className="font-medium text-muted-foreground hover:text-foreground" aria-expanded={changing} aria-controls={`${id}-roles`} aria-label={`Change roles for ${name}`} disabled={busy} onClick={() => { setBranchError(""); setChanging(!changing); }}>
                {saving ? <Spinner label="Saving role" className="text-current" /> : null}Change
              </Button>
              {allExpired ? <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0" aria-label={`Renew invitation for ${name}`} disabled={busy} onClick={onRenew}>
                    <RotateCw aria-hidden className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Renew invitation</TooltipContent>
              </Tooltip></TooltipProvider> : linkWorks ? <MoreMenu
                label={`More for ${name}`}
                disabled={busy}
                items={[
                  { label: "Copy sign-in link", onSelect: () => void onCopyLink(), hidden: !linkWorks },
                  { label: "Renew invite", onSelect: onRenew, hidden: !linkWorks },
                ]}
              /> : <span aria-hidden className="size-11" />}
            </div>
          )}
        </div>

      </div>
      {message ? <p role={message.error ? "alert" : "status"} className={cn("text-[13px]", message.error ? "text-destructive" : "text-muted-foreground")}>{message.text}</p> : null}
      {changing && !owner ? (
        <div id={`${id}-roles`} className="flex flex-wrap gap-3 rounded-lg bg-muted/40 p-3">
          <p className="w-full text-[13px] text-muted-foreground">Role and branch changes apply immediately.</p>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-desk`} className="text-xs font-normal text-muted-foreground">Desk</Label>
            <RoleSelect id={`${id}-desk`} label={`Desk role for ${name}`} value={(grant?.role ?? "") as StaffRole | ""} disabled={busy} onChange={(value) => void changeRole(() => onDesk(value || null))} options={DESK_OPTIONS} empty="None" />
          </div>
          {grant && grant.role !== "owner" ? (
            <BranchMultiSelect
              branches={assignableBranches}
              selectedIds={personBranchIds}
              disabled={busy}
              error={branchError}
              onToggle={(branchId) => void toggleAssignedBranch(branchId)}
            />
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor={`${id}-marketing`} className="text-xs font-normal text-muted-foreground">Marketing</Label>
            <RoleSelect id={`${id}-marketing`} label={`Marketing role for ${name}`} value={(marketing?.role ?? "") as MarketingRole | ""} disabled={busy} onChange={(value) => void changeRole(() => onMarketing(value || null))} options={MARKETING_OPTIONS} empty="None" />
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
const draftOf = (rules: CashierRules): Draft => ({ limit: String(basisPointsToPercent(rules.discountLimitPercent)), refund: rules.refund ?? "manager", voidPaidSale: rules.voidPaidSale, customPrice: rules.customPrice, paymentFix: rules.paymentFix });
const sameDraft = (a: Draft, b: Draft) => Number(a.limit) === Number(b.limit) && a.limit.trim() !== "" && RULES.every(({ key }) => a[key] === b[key]);

function CashierRulesPanel({ hasCashiers, onDirtyChange }: { hasCashiers: boolean | undefined; onDirtyChange?: (dirty: boolean) => void }) {
  const rules = useQuery(api.settings.cashierRules.getCashierRules, {});
  return (
    <Section
      title="Rules for all cashiers"
      label="Rules for all cashiers"
      tip={<>Cashiers can always sell, take payment and apply valid coupons. Anything that needs a manager becomes a request.</>}
      action={hasCashiers === false ? <Badge variant="muted" className="rounded-full">No cashiers</Badge> : <Badge variant="muted" className="rounded-full">Every branch</Badge>}
    >
      {rules === undefined ? <div className="grid place-items-center py-8"><Spinner label="Loading cashier rules" /></div> : <RulesForm rules={rules} onDirtyChange={onDirtyChange} />}
    </Section>
  );
}

function RulesForm({ rules, onDirtyChange }: { rules: CashierRules; onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId();
  const update = useMutation(api.settings.cashierRules.updateCashierRules);
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
        discountLimitPercent: percentToBasisPoints(Number(draft.limit)),
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
    <form onSubmit={(event) => void submit(event)} noValidate className={cn("grid", dirty && "pb-20")} aria-label="Rules for all cashiers">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-2.5">
        <RuleLabel htmlFor={`${id}-limit`} className="whitespace-nowrap text-sm font-normal text-foreground">Discount without approval</RuleLabel>
        <div className="w-28">
          <NumberField
            id={`${id}-limit`}
            inputMode="decimal"
            suffix="%"
            className={cn("h-10 min-w-0 text-right", problem && "border-destructive")}
            value={draft.limit}
            disabled={state.saving}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-limit-error` : undefined}
            onChange={(e) => set({ limit: e.target.value.replace(/[^\d.]/g, "") })}
          />
        </div>
        {problem ? <p id={`${id}-limit-error`} className="col-span-2 text-right text-xs text-destructive">{problem}</p> : null}
      </div>
      <p className="pt-5 pb-1 text-xs font-medium text-muted-foreground">Who can do this without asking</p>
      {RULES.map(({ key, label }) => (
        <div key={key} className={cn("grid grid-cols-1 items-center gap-2 border-border py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3", key !== RULES.at(-1)?.key && "border-b")}>
          <span id={`${id}-${key}-label`} className="text-sm text-foreground">{label}</span>
          <ToggleGroup id={`${id}-${key}`} variant="segmented" tone="subtle" className="w-full sm:w-64" value={draft[key]} onValueChange={(value: Permission) => set({ [key]: value })} aria-label={`${label} permission`} disabled={state.saving}>
            <ToggleGroupItem value="cashier">Any cashier</ToggleGroupItem><ToggleGroupItem value="manager">Manager only</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ))}
      {state.error ? <p role="alert" className="pt-2 text-sm text-destructive">{state.error}</p> : null}
      {stale || rules.revision > revision || state.saved ? <div role="status" className="pt-3 text-sm text-muted-foreground">
        {stale || rules.revision > revision ? <>Rules changed on another device. Review latest before saving. <Button type="button" variant="outline" size="sm" disabled={state.saving || stale && rules.revision <= revision} onClick={() => { load(rules); setState({ saving: false, saved: false, error: "" }); }}>Reload latest</Button></> : state.saved ? <span className={cn("inline-flex items-center gap-1", TONES.success.text)}><Check aria-hidden className="size-4" /> Saved</span> : ""}
      </div> : null}
      {dirty ? (
        <StickyActionBar className="mt-3 justify-end" data-testid="rules-save-bar">
          <span className="mr-auto text-[13px] text-muted-foreground">Unsaved changes</span>
          <Button type="button" variant="ghost" disabled={state.saving} onClick={() => { setDraft(base); setState({ saving: false, saved: false, error: "" }); }}>Discard</Button>
          <Button type="submit" disabled={state.saving || Boolean(problem) || !dirty || stale || rules.revision > revision}>
            {state.saving ? <Spinner label="Saving" className="text-current" /> : null}
            Save
          </Button>
        </StickyActionBar>
      ) : null}
    </form>
  );
}
