"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { formatMoney } from "@/components/admin/labels";
import type { CommerceCopy } from "./backend";
import { formatResort } from "./checkout-ui";

/**
 * Commerce copy this lane sent as a key patch (docs/commerce/copy-patches/commerce-w1-l4-screens.json).
 * Read only while messages/commerce/<locale>.json lacks the key, so screens never show a raw key;
 * once the patch lands in all locales these entries are dead and can go.
 */
export const PENDING_COMMERCE_COPY: Record<string, string> = {
  "receipt.voucherTender": "Gift voucher {code}",
  "receipt.goodwill": "Goodwill credit",
  "receipt.sessionUsed": "Session used · was {price}",
  "receipt.notTaxInvoice": "Voucher sale · not a tax invoice",
  "receipt.payment": "Payment",
  "receipt.attempt.collecting": "In progress",
  "receipt.attempt.settled": "Paid",
  "receipt.attempt.refused": "Money taken · sale not saved",
  "receipt.attempt.recovering": "Being sorted out",
  "receipt.attempt.resolved": "Sorted out",
  "receipt.attempt.cancelled": "Cancelled",
  "receipt.attemptBy": "{till} · {staff}",
  "history.showStaff": "Staff view",
  "history.close": "Close",
  "edits.notYet": "Editing opens in a later update. History is up to date.",
  "approvals.stale": "Changed since asked",
  "approvals.staleHelp": "The item changed after this was asked. A new request is needed.",
  "approvals.revision": "Expected revision {expected}, now {current}",
  "approvals.returnItems": "asks to return items · {amount}",
  "approvals.edit": "asks to {what} · {target}",
  "approvals.notYet": "Decide this once returns and edits open at checkout.",
  "approvals.targets.product": "Product",
  "approvals.targets.variant": "Product option",
  "approvals.targets.package": "Package",
  "approvals.targets.voucherTemplate": "Voucher design",
  "approvals.targets.service": "Service",
  "approvals.targets.property": "Room rate",
  "approvals.targets.voucher": "Gift voucher",
  "approvals.targets.grant": "Package sessions",
  "approvals.targets.stock": "Stock",
  "approvals.targets.handover": "Room charge",
  "approvals.targets.order": "Receipt",
  "approvals.targets.settings": "Checkout rules",
  "approvals.what.publish": "publish for future sales",
  "approvals.what.editCatalogue": "edit for future sales",
  "approvals.what.extend": "extend",
  "approvals.what.pause": "pause",
  "approvals.what.resume": "resume",
  "approvals.what.addGoodwill": "add goodwill",
  "approvals.what.removeGoodwill": "remove goodwill",
  "approvals.what.rename": "fix the name",
  "approvals.what.reissue": "reissue the code",
  "approvals.what.disable": "disable the voucher",
  "approvals.what.transfer": "pass sessions on",
  "approvals.what.addService": "add a service that counts",
  "approvals.what.substituteService": "swap a service",
  "approvals.what.narrowServices": "narrow the services",
  "approvals.what.shorten": "shorten the date",
  "approvals.what.adjustStock": "adjust stock",
  "approvals.what.takeBack": "take back",
  "approvals.what.moveRoomCharge": "move to another room",
  "approvals.what.amendPayment": "correct the payment",
  "approvals.what.updateSettings": "change checkout rules",
};

const fill = (text: string, values?: Record<string, string | number>) =>
  values ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match)) : text;

/** The Commerce translator with the till's money and Bangkok dates (refusalText, guestFactText and the receipt use it). */
export function useCommerceCopy(): CommerceCopy {
  const t = useTranslations("Commerce");
  return useMemo(() => ({
    t: (key, values) => (t.has(key) ? t(key, values) : fill(PENDING_COMMERCE_COPY[key] ?? key, values)),
    money: (satang) => formatMoney(satang),
    date: (at) => formatResort(at, "d MMM yyyy"),
  }), [t]);
}
