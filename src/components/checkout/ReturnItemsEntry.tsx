"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { lastUsableAt } from "convex/shared/commerce/validity";
import { cn } from "@/lib/utils";
import { useReturnsDesk, type OrderLine, type OrderView, type ReturnRecord } from "./backend";
import { voucherMasks } from "./checkout-ui";
import { useCommerceCopy } from "./commerce-copy";
import { rowReturnable } from "./returnable-parts";

/*
 * The receipt's way into Return items. Only this light part loads with checkout: the sheet, the
 * payout and their copy (ReturnItemsSheet) load when staff open Return items on a commerce row or
 * open a return already in progress. Pre-commerce receipts never load them.
 */
const ReturnItemsSheet = lazy(() => import("./ReturnItemsSheet"));

/** Return items on a receipt that now routes its refunds there (RefundForm after USE_RETURN_ITEMS). */
export function MovedToReturns({ view, line, code }: { view: OrderView; line: OrderLine; code: string }) {
  const { t } = useCommerceCopy();
  const desk = useReturnsDesk();
  const [open, setOpen] = useState(false);
  return (
    <>
      <p role="alert" className="text-sm text-destructive">{t(code === "USE_RETURN_ITEMS" ? "returns.refusals.useReturnItems" : "refusals.returnInProgress")}</p>
      {desk ? <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>{t("buttons.returnItems")}</Button> : null}
      {open ? <LazyReturnItemsSheet view={view} lineId={line._id} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The sheet, loaded on first open. */
export function LazyReturnItemsSheet(props: { view: OrderView; lineId: Id<"orderLines"> | null; onClose: () => void; onCompleted?: (message: string) => void }) {
  return (
    <Suspense fallback={<span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Spinner label="Loading" /></span>}>
      <ReturnItemsSheet {...props} />
    </Suspense>
  );
}

/** Return items on one receipt row, as Refund sits on rows today. Nothing on pre-commerce receipts. */
export function ReturnItemsAction({ view, line, onCompleted }: { view: OrderView; line: OrderLine; onCompleted?: (message: string) => void }) {
  const desk = useReturnsDesk();
  const eligible = useMemo(() => Boolean(desk) && rowReturnable(view, line._id), [desk, view, line._id]);
  const [open, setOpen] = useState(false);
  if (!eligible && !open) return null;
  return <ReturnItemsButton view={view} line={line} eligible={eligible} open={open} onOpenChange={setOpen} onCompleted={onCompleted} />;
}

/** Only rows that can return read the Commerce copy (pre-commerce receipts render without it). */
function ReturnItemsButton({ view, line, eligible, open, onOpenChange: setOpen, onCompleted }: { view: OrderView; line: OrderLine; eligible: boolean; open: boolean; onOpenChange: (open: boolean) => void; onCompleted?: (message: string) => void }) {
  const { t } = useCommerceCopy();
  return (
    <div data-screen-only="" className="mt-1 flex flex-wrap items-center gap-2 font-sans print:hidden">
      {eligible ? (
        <Button type="button" variant="ghost" size="sm" data-return-trigger={line._id} aria-label={`${t("buttons.returnItems")} · ${line.name}`}
          onClick={() => setOpen(true)} className="h-11 px-3 font-sans text-sm text-foreground">
          {t("buttons.returnItems")}
        </Button>
      ) : null}
      {open ? <LazyReturnItemsSheet view={view} lineId={line._id} onClose={() => setOpen(false)} onCompleted={onCompleted} /> : null}
    </div>
  );
}

/**
 * Replacement vouchers from the receipt's latest completed return (D8), so a reload or another till
 * still shows the codes the guest was given. Only receipts whose completed return issued gift slips
 * read it, whether or not any cash was refunded (a voucher-only return refunds none).
 */
export function ReplacementVouchers({ view }: { view: OrderView }) {
  const desk = useReturnsDesk();
  if (!desk || view.activeReturn || !view.commerce?.hasReplacementSlips) return null;
  return <ReplacementSlips view={view} />;
}

function ReplacementSlips({ view }: { view: OrderView }) {
  const record = useReturnsDesk()!.useReturn({ orderId: view.order._id, completed: true });
  if (!record?.giftSlips.length) return null;
  return <ReplacementSlipList slips={record.giftSlips} view={view} onReceipt />;
}

/**
 * Each replacement voucher the guest is handed: its full code, value and last usable day, and the
 * masked code of the voucher it replaces, so two equal ฿500 slips go to the right guests (D8).
 */
export function ReplacementSlipList({ slips, view, codes, onReceipt = false }: {
  slips: ReturnRecord["giftSlips"]; view: OrderView; codes?: ReadonlyMap<string, string>; onReceipt?: boolean;
}) {
  const { t, money, date } = useCommerceCopy();
  const masks = voucherMasks(view, codes);
  return (
    <section data-screen-only={onReceipt ? "" : undefined} data-replacement-vouchers="" aria-label={t("returns.replacementVouchers")}
      className={cn("grid gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 font-sans text-sm", onReceipt && "print:hidden")}>
      <h3 className="font-semibold">{t("returns.replacementVouchers")}</h3>
      <ul className="grid gap-2">
        {slips.map((slip) => {
          const original = masks.get(slip.replaces);
          return (
            <li key={slip.voucherId} data-gift-slip="" className="grid gap-0.5 [overflow-wrap:anywhere]">
              <span data-gift-slip-voucher="">
                {slip.expiresAt === null
                  ? t("returns.newVoucherNoExpiry", { code: slip.code, amount: money(slip.amount) })
                  : t("returns.newVoucher", { code: slip.code, amount: money(slip.amount), date: date(lastUsableAt(slip.expiresAt)) })}
              </span>
              {original ? <span data-gift-slip-replaces="" className="text-xs text-muted-foreground">{t("returns.slipReplaces", { code: original })}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Return in progress · Open the return" on a receipt whose return is still open. */
export function ReturnInProgressNotice({ view, onCompleted }: { view: OrderView; onCompleted?: (message: string) => void }) {
  const desk = useReturnsDesk();
  const [open, setOpen] = useState(false);
  if (!desk || (!view.activeReturn && !open)) return null;
  return <OpenReturn view={view} open={open} onOpenChange={setOpen} onCompleted={onCompleted} />;
}

function OpenReturn({ view, open, onOpenChange: setOpen, onCompleted }: { view: OrderView; open: boolean; onOpenChange: (open: boolean) => void; onCompleted?: (message: string) => void }) {
  const { t } = useCommerceCopy();
  return (
    <div data-screen-only="" role="status" data-return-notice="" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 font-sans text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200 print:hidden">
      {view.activeReturn ? <span className="font-semibold">{t("returns.inProgress")}</span> : <span />}
      <Button type="button" size="sm" variant="outline" className="h-11" onClick={() => setOpen(true)}>{t("returns.openReturn")}</Button>
      {open ? <LazyReturnItemsSheet view={view} lineId={null} onClose={() => setOpen(false)} onCompleted={onCompleted} /> : null}
    </div>
  );
}
