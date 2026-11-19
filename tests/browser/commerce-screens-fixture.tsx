import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";
import { commerceReceipt } from "@/components/checkout/design/commerce-receipt";
import { commerceDesignStates, type CommerceDesignState } from "@/components/checkout/fixture-backend";
import en from "../../messages/en.json";
import "@/app.css";

/*
 * The checkout Preview (src/components/checkout/CheckoutPreview.tsx) on one commerce design state,
 * for layout checks of the reader screens. Query parameters:
 *   commerce=<state>  one of commerceDesignStates (dark is what production ships: every switch Off)
 *   receipt=1         open the issuance receipt (packages, products, a gift voucher, a covered visit) instead of checkout
 *   receipt=redemption  open the redemption receipt (goodwill credit and voucher spend) instead
 *   theme=dark        dark app theme
 *   typed=<text>      append <text> (e.g. a full voucher code) to the issuance receipt's row names,
 *                     as staff might type it into a custom item
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const requested = params.get("commerce");
const commerce = commerceDesignStates.find((key) => key === requested) as CommerceDesignState | undefined;
const typed = params.get("typed");
if (typed) commerceReceipt.lines = commerceReceipt.lines.map((line) => ({ ...line, name: `${line.name} ${typed}` }));

createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
    <div data-fixture-ready="">
      <CheckoutPreview initial={{ commerce, receipt: params.get("receipt") === "redemption" ? "redemption" : params.get("receipt") === "1" }} />
    </div>
  </NextIntlClientProvider>,
);
