import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { CheckoutPreview } from "@/components/checkout/CheckoutPreview";
import { commerceDesignStates, type CommerceDesignState } from "@/components/checkout/fixture-backend";
import en from "../../messages/en.json";
import "@/app.css";

/*
 * The checkout Preview (src/components/checkout/CheckoutPreview.tsx) on one commerce design state,
 * for layout checks of the reader screens. Query parameters:
 *   commerce=<state>  one of commerceDesignStates (dark is what production ships: every switch Off)
 *   receipt=1         open the commerce receipt (every row kind and tender) instead of checkout
 *   theme=dark        dark app theme
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const requested = params.get("commerce");
const commerce = commerceDesignStates.find((key) => key === requested) as CommerceDesignState | undefined;

createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
    <div data-fixture-ready="">
      <CheckoutPreview initial={{ commerce, receipt: params.get("receipt") === "1" }} />
    </div>
  </NextIntlClientProvider>,
);
