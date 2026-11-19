"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { formatMoney } from "@/components/admin/labels";
import type { CommerceCopy } from "./backend";
import { formatResort } from "./checkout-ui";

/** The Commerce translator with the till's money and Bangkok dates (refusalText, guestFactText and the receipt use it). */
export function useCommerceCopy(): CommerceCopy {
  const t = useTranslations("Commerce");
  return useMemo(() => ({
    t: (key, values) => t(key, values),
    money: (satang) => formatMoney(satang),
    date: (at) => formatResort(at, "d MMM yyyy"),
  }), [t]);
}
