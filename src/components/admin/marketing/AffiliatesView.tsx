"use client";

import { useState, type ReactNode } from "react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { AffiliateRow, CreditRow } from "convex/marketingAffiliates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  Callout,
  CopyButton,
  EditorSheet,
  NoticeBar,
  SheetForm,
  useEditorForm,
  useEditorSheet,
  useNotice,
} from "./MarketingBits";
import { useConfirm } from "../ConfirmDialog";
import { marketingErrorText } from "./marketing-format";
import type { CampaignRow, CouponRow, MarketingProperty } from "./types";

type SavePartner = FunctionArgs<typeof api.marketingAffiliates.saveAffiliate>;
type Decision = FunctionArgs<typeof api.marketingAffiliates.reviewCredit>;
export type CreditDetail = FunctionReturnType<
  typeof api.marketingAffiliates.getCredit
>;
export type AffiliateActions = {
  save: (args: SavePartner) => Promise<unknown>;
  status: (
    args: FunctionArgs<typeof api.marketingAffiliates.setAffiliateStatus>,
  ) => Promise<unknown>;
  coupon: (
    args: FunctionArgs<typeof api.marketingAffiliates.assignCoupon>,
  ) => Promise<unknown>;
};
const money = (amount: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "THB" }).format(
    amount,
  );
const fieldClass =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const flagLabels: Record<string, string> = {
  affiliate_conflict: "Link and coupon name different partners",
  referral_claimed_slug: "Partner slug claimed without a recorded visit",
  self_referral: "Guest matches partner contact",
  staff_referral: "Staff-created referral",
  staff_order: "Staff-created referral",
};
function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function AffiliatesView({
  partners,
  partial,
  campaigns,
  coupons,
  properties,
  canManage,
  actions,
  onSelectPartner,
  selectedPartner,
  origin,
  children,
}: {
  partners: AffiliateRow[] | undefined;
  partial: boolean;
  campaigns: CampaignRow[] | undefined;
  coupons: CouponRow[] | undefined;
  properties: MarketingProperty[] | undefined;
  canManage: boolean;
  actions: AffiliateActions;
  origin: string;
  selectedPartner: string;
  onSelectPartner: (id: string) => void;
  children: ReactNode;
}) {
  const confirm = useConfirm();
  const sheet = useEditorSheet<{ partner?: AffiliateRow }>();
  const { notice, show, clear } = useNotice();
  const [busy, setBusy] = useState<string | null>(null);
  async function change(partner: AffiliateRow, status: AffiliateRow["status"]) {
    if (
      status === "archived" &&
      !(await confirm({
        title: `Archive ${partner.name}?`,
        description:
          "This permanently closes the partner to future referrals and disables partner aliases. Saved referral history stays available.",
        confirmLabel: "Archive partner",
        destructive: true,
      }))
    )
      return;
    setBusy(partner._id);
    try {
      await actions.status({ affiliateId: partner._id, status });
      show(`Partner ${status}`);
    } catch (error) {
      show(
        marketingErrorText(error, "Couldn’t change partner status."),
        "danger",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-5 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-60 flex-1">
          <h2 className="text-lg font-semibold">Referral partners</h2>
          <p className="text-sm text-muted-foreground">
            Track referrals and manually approve credit. Amounts show net
            collections attributed to a partner; no commissions or payouts are
            calculated.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => sheet.open({})} disabled={!campaigns?.length}>
            New partner
          </Button>
        )}
      </div>
      <NoticeBar notice={notice} onClose={clear} />
      {partial && (
        <Callout tone="warning">
          Partner results are limited. Counts and totals may be incomplete.
        </Callout>
      )}
      {campaigns?.length === 0 && (
        <Callout>Create a campaign before adding a partner.</Callout>
      )}
      {partners === undefined ? (
        <p role="status">Loading partners…</p>
      ) : partners.length === 0 ? (
        <Callout title="No partners yet">
          Create a partner with a named link such as /r/anna. Only future
          referrals are tracked.
        </Callout>
      ) : (
        <ul className="grid min-w-0 gap-3 md:grid-cols-2">
          {partners.map((partner) => (
            <li
              key={partner._id}
              className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{partner.name}</h3>
                  <div className="flex items-center gap-1">
                    <span className="break-all font-mono text-sm">
                      {partner.canonicalPath}
                    </span>
                    <CopyButton
                      text={`${origin}${partner.canonicalPath}`}
                      label={`Copy ${partner.canonicalPath}`}
                    />
                  </div>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">
                  {partner.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {partner.campaignName} · Link{" "}
                {partner.linkStatus ?? "unavailable"}
              </p>
              <p className="text-sm">
                {partner.summary.pending} pending · {partner.summary.approved}{" "}
                approved · {partner.summary.rejected} rejected ·{" "}
                {partner.summary.reversed} reversed
              </p>
              <p className="text-sm">
                Approved net collections:{" "}
                <strong>{money(partner.summary.approvedNet)}</strong>
                {partner.summary.partial ? " (partial)" : ""}
              </p>
              <p className="break-words text-xs text-muted-foreground">
                Coupons:{" "}
                {partner.coupons.map((c) => c.code).join(", ") || "None"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectPartner(partner._id)}
                >
                  View referrals
                </Button>
                {canManage && partner.status !== "archived" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => sheet.open({ partner })}
                    >
                      Edit {partner.name}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === partner._id}
                      onClick={() =>
                        void change(
                          partner,
                          partner.status === "active" ? "paused" : "active",
                        )
                      }
                    >
                      {partner.status === "active" ? "Pause" : "Activate"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === partner._id}
                      onClick={() => void change(partner, "archived")}
                    >
                      Archive {partner.name}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="affiliate-filter">Referral partner</Label>
        <select
          id="affiliate-filter"
          className={fieldClass}
          value={selectedPartner}
          onChange={(e) => onSelectPartner(e.target.value)}
        >
          <option value="all">All partners</option>
          {partners?.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {children}
      <EditorSheet
        open={sheet.editing !== null}
        onClose={() => void sheet.close()}
        header={
          <>
            <SheetTitle>
              {sheet.editing?.partner
                ? `Edit ${sheet.editing.partner.name}`
                : "New partner"}
            </SheetTitle>
            <SheetDescription>
              Names and scope affect future referrals. The named link stays
              permanent. No messages are sent to the contact.
            </SheetDescription>
          </>
        }
      >
        {sheet.editing && campaigns && coupons && properties && (
          <PartnerEditor
            key={sheet.editing.key}
            partner={
              partners?.find((p) => p._id === sheet.editing?.partner?._id) ??
              sheet.editing.partner
            }
            campaigns={campaigns}
            coupons={coupons}
            properties={properties}
            actions={actions}
            onDirtyChange={sheet.setDirty}
            onCancel={() => void sheet.close()}
            onDone={() => {
              sheet.done();
              show("Partner saved");
            }}
          />
        )}
      </EditorSheet>
    </div>
  );
}

function PartnerEditor({
  partner,
  campaigns,
  coupons,
  properties,
  actions,
  onDirtyChange,
  onCancel,
  onDone,
}: {
  partner?: AffiliateRow;
  campaigns: CampaignRow[];
  coupons: CouponRow[];
  properties: MarketingProperty[];
  actions: AffiliateActions;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const editor = useEditorForm(
    () => ({
      name: partner?.name ?? "",
      slug: partner?.slug ?? "",
      campaignId: partner?.campaignId ?? campaigns[0]?._id ?? "",
      contactEmail: partner?.contactEmail ?? "",
      startsOn: partner?.startsOn ?? "",
      endsOn: partner?.endsOn ?? "",
      notes: partner?.notes ?? "",
      propertySlugs: partner?.propertySlugs ?? [],
    }),
    onDirtyChange,
  );
  const { form, set } = editor;
  const validation = !form.name.trim()
    ? "Enter a partner name."
    : !/^[a-z0-9][a-z0-9-]{0,29}$/.test(form.slug)
      ? "Enter a link name using 1–30 lowercase letters, numbers or hyphens."
      : !form.campaignId
        ? "Choose a campaign."
        : form.startsOn && form.endsOn && form.startsOn > form.endsOn
          ? "The end date must be on or after the start date."
          : "";
  const [coupon, setCoupon] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");
  async function assign(couponId: Id<"coupons"> | null) {
    if (!partner) return;
    setCouponBusy(true);
    setCouponError("");
    try {
      await actions.coupon({ affiliateId: partner._id, couponId });
      setCoupon("");
    } catch (error) {
      setCouponError(
        marketingErrorText(error, "Couldn’t change coupon assignment."),
      );
    } finally {
      setCouponBusy(false);
    }
  }
  return (
    <SheetForm
      saving={editor.saving}
      error={editor.saveError}
      submitLabel="Save partner"
      onCancel={onCancel}
      onSubmit={(event) =>
        void editor.submit(
          event,
          !form.name.trim()
            ? "partner-name"
            : !/^[a-z0-9][a-z0-9-]{0,29}$/.test(form.slug)
              ? "partner-slug"
              : !form.campaignId
                ? "partner-campaign"
                : form.startsOn && form.endsOn && form.startsOn > form.endsOn
                  ? "partner-end"
                  : undefined,
          async () => {
            await actions.save({
              ...form,
              id: partner?._id,
              campaignId: form.campaignId as Id<"marketingCampaigns">,
              contactEmail: form.contactEmail || undefined,
              startsOn: form.startsOn || undefined,
              endsOn: form.endsOn || undefined,
              notes: form.notes || undefined,
            });
            onDone();
          },
          "Couldn’t save partner.",
        )
      }
    >
      {editor.submitted && validation && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      <Field label="Partner name" id="partner-name">
        <Input
          id="partner-name"
          required
          maxLength={120}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <Field label="Permanent link name" id="partner-slug">
        <Input
          id="partner-slug"
          required
          pattern="[a-z0-9][a-z0-9-]{0,29}"
          disabled={!!partner}
          value={form.slug}
          onChange={(e) => set("slug", e.target.value.toLowerCase())}
        />
        <p className="text-xs text-muted-foreground">
          /r/{form.slug || "anna"} · 1–30 lowercase letters, numbers or hyphens.
        </p>
      </Field>
      <Field label="Campaign" id="partner-campaign">
        <select
          id="partner-campaign"
          className={fieldClass}
          value={form.campaignId}
          onChange={(e) =>
            set("campaignId", e.target.value as Id<"marketingCampaigns">)
          }
        >
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contact email (optional)" id="partner-email">
        <Input
          id="partner-email"
          type="email"
          value={form.contactEmail}
          onChange={(e) => set("contactEmail", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Used to flag possible self-referrals for manual review.
        </p>
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">
          Eligible properties
        </legend>
        <p className="text-xs text-muted-foreground">
          Leave all unchecked to allow every property.
        </p>
        {properties.map((p) => (
          <label key={p._id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.propertySlugs.includes(p.slug)}
              onChange={(e) =>
                set(
                  "propertySlugs",
                  e.target.checked
                    ? [...form.propertySlugs, p.slug]
                    : form.propertySlugs.filter((s) => s !== p.slug),
                )
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts on (optional)" id="partner-start">
          <Input
            id="partner-start"
            type="date"
            value={form.startsOn}
            onChange={(e) => set("startsOn", e.target.value)}
          />
        </Field>
        <Field label="Ends on (optional)" id="partner-end">
          <Input
            id="partner-end"
            type="date"
            value={form.endsOn}
            onChange={(e) => set("endsOn", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes" id="partner-notes">
        <textarea
          id="partner-notes"
          maxLength={4000}
          className={fieldClass}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      {partner && (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Unique partner coupons</h3>
          <p className="text-xs text-muted-foreground">
            Assigned codes:{" "}
            {partner.coupons.map((c) => c.code).join(", ") || "None"}.
            Assignments apply to future sales and do not change saved referral
            history.
          </p>
          <select
            aria-label="Coupon to assign"
            className={fieldClass}
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
          >
            <option value="">Choose a coupon</option>
            {coupons
              .filter((c) => !c.affiliateId || c.affiliateId === partner._id)
              .map((c) => (
                <option key={c._id} value={c._id}>
                  {c.code}
                </option>
              ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!coupon || couponBusy}
              onClick={() => void assign(coupon as Id<"coupons">)}
            >
              Assign coupon
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!partner.coupons.length || couponBusy}
              onClick={() => void assign(null)}
            >
              Remove all coupon assignments
            </Button>
          </div>
          {couponError && (
            <p role="alert" className="text-sm text-destructive">
              {couponError}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Coupon assignment is saved immediately.
          </p>
        </div>
      )}
    </SheetForm>
  );
}

export function CreditList({
  credits,
  partial,
  state,
  onState,
  onOpen,
}: {
  credits: CreditRow[] | undefined;
  partial: boolean;
  state: string;
  onState: (value: string) => void;
  onOpen: (credit: CreditRow) => void;
}) {
  return (
    <section className="grid gap-3" aria-label="Referral credit review">
      <h2 className="text-lg font-semibold">Referral credit review</h2>
      <select
        className={fieldClass}
        aria-label="Credit status"
        value={state}
        onChange={(e) => onState(e.target.value)}
      >
        {["all", "pending", "approved", "rejected", "reversed"].map((s) => (
          <option key={s} value={s}>
            {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
      {partial && (
        <Callout tone="warning">
          This queue is limited. Filter by partner and status to narrow the
          results.
        </Callout>
      )}
      {credits === undefined ? (
        <p role="status">Loading credits…</p>
      ) : credits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No referrals match these filters. Existing sales are not backfilled.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {credits.map((c) => (
            <li
              key={c._id}
              className="flex min-w-0 flex-wrap items-center gap-3 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.ref} · {c.label}
                </p>
                <p className="text-sm text-muted-foreground">
                  {c.affiliateName ?? "Partner needs review"} · {c.state} ·{" "}
                  {c.eligible ? "Eligible" : "Not eligible for approval"}
                </p>
                {c.flags.length > 0 && (
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    {c.flags
                      .map((f) => flagLabels[f] ?? f.replaceAll("_", " "))
                      .join(" · ")}
                  </p>
                )}
              </div>
              <span className="text-sm tabular-nums">
                Net {money(c.eligibleNet)}
              </span>
              <Button size="sm" variant="outline" onClick={() => onOpen(c)}>
                Review {c.ref}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CreditReview({
  detail,
  canReview,
  onReview,
  onRefresh,
  onClose,
}: {
  detail: CreditDetail | undefined;
  canReview: boolean;
  onReview: (args: Decision) => Promise<unknown>;
  onRefresh: (creditId: Id<"affiliateCredits">) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const credit = detail?.credit;
  async function decide(decision: "approved" | "rejected") {
    if (!credit) return;
    setBusy(true);
    setError("");
    try {
      await onReview({
        creditId: credit._id,
        decision,
        reason,
        expectedRevision: credit.revision,
        affiliateId: candidate
          ? (candidate as Id<"marketingAffiliates">)
          : undefined,
      });
      setReason("");
    } catch (e) {
      setError(
        marketingErrorText(
          e,
          "Couldn’t review this credit. Refresh and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <EditorSheet
      open
      onClose={onClose}
      header={
        <>
          <SheetTitle>
            {credit ? `Referral ${credit.ref}` : "Referral detail"}
          </SheetTitle>
          <SheetDescription>
            Review the frozen referral candidates and current collections.
            Decisions are recorded in the history.
          </SheetDescription>
        </>
      }
    >
      <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
        {detail === undefined ? (
          <p role="status">Loading referral…</p>
        ) : !credit ? (
          <p>Referral no longer available.</p>
        ) : (
          <>
            <p>
              {credit.label} ·{" "}
              <strong className="capitalize">{credit.state}</strong> · Revision{" "}
              {credit.revision}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>Eligible net collections</dt>
              <dd>{money(credit.eligibleNet)}</dd>
              <dt>Approved net collections</dt>
              <dd>{money(credit.approvedNet)}</dd>
            </dl>
            {!credit.eligible && (
              <Callout tone="warning">
                This sale is unpaid, not settled, cancelled, refunded, or
                otherwise ineligible. Approval is unavailable.
              </Callout>
            )}
            {credit.flags.length > 0 && (
              <Callout tone="warning" title="Review flags">
                {credit.flags
                  .map((f) => flagLabels[f] ?? f.replaceAll("_", " "))
                  .join(" · ")}
              </Callout>
            )}
            <div className="grid gap-2">
              <h3 className="font-semibold">Saved candidates</h3>
              {credit.candidates.map((c, i) => (
                <p className="text-sm" key={`${c.affiliateId}-${i}`}>
                  {c.name} · /r/{c.slug} · {c.origin} ·{" "}
                  {c.eligible
                    ? "eligible when captured"
                    : (c.reason ?? "ineligible when captured")}
                </p>
              ))}
            </div>
            {(credit.reasonHidden || credit.reason) && (
              <p className="text-sm">Last decision: {credit.reasonHidden ? "Reason hidden" : credit.reason}</p>
            )}
            {canReview && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onRefresh(credit._id);
                  } catch (e) {
                    setError(marketingErrorText(e, "Couldn’t refresh credit."));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Refresh eligibility
              </Button>
            )}
            {canReview && credit.state === "pending" && (
              <>
                <Field label="Partner to credit" id="credit-candidate">
                  <select
                    id="credit-candidate"
                    className={fieldClass}
                    value={candidate}
                    onChange={(e) => setCandidate(e.target.value)}
                  >
                    <option value="">
                      {credit.flags.includes("affiliate_conflict")
                        ? "Choose a partner to resolve conflict"
                        : "Use saved partner"}
                    </option>
                    {credit.candidates
                      .filter((c) => c.eligible)
                      .map((c, i) => (
                        <option
                          key={`${c.affiliateId}-${i}`}
                          value={c.affiliateId}
                        >
                          {c.name} ({c.origin})
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Decision reason" id="credit-reason">
                  <textarea
                    id="credit-reason"
                    className={fieldClass}
                    maxLength={1000}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      busy ||
                      !credit.eligible ||
                      !reason.trim() ||
                      (credit.flags.includes("affiliate_conflict") &&
                        !candidate)
                    }
                    onClick={() => void decide("approved")}
                  >
                    Approve referral credit
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !reason.trim()}
                    onClick={() => void decide("rejected")}
                  >
                    Reject referral credit
                  </Button>
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <h3 className="font-semibold">Credit history</h3>
            {detail?.partial && (
              <Callout tone="warning">
                Only the most recent history entries are shown.
              </Callout>
            )}
            <ol className="grid gap-3">
              {detail?.history.map((h) => (
                <li
                  key={h._id}
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  <p>
                    Revision {h.revision} · {h.kind.replaceAll("_", " ")} ·{" "}
                    {h.state}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.recordedAt).toLocaleString("en-GB", {
                      timeZone: "Asia/Bangkok",
                    })}{" "}
                    (Bangkok) · {h.actor}
                  </p>
                  <p>
                    Net {money(h.eligibleNet)} · Approved {money(h.approvedNet)}
                  </p>
                  {(h.reasonHidden || h.reason) && <p>{h.reasonHidden ? "Reason hidden" : h.reason}</p>}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </EditorSheet>
  );
}
