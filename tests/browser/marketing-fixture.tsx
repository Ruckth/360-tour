import type { Id } from "convex/_generated/dataModel";
import { IntlProvider } from "@/platform/intl";
import { createRoot } from "react-dom/client";
import { BookingSheet } from "@/components/admin/BookingSheet";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { AnalyticsConsent } from "@/components/global/AnalyticsConsent";
import { HomeQuickBooking } from "@/components/home/HomeQuickBooking";
import { AnalyticsChoice } from "@/components/legal/AnalyticsChoice";
import en from "../../messages/en.json";
import th from "../../messages/th.json";
import "@/app.css";

/*
 * Release 3a capture UI on fixture data.
 *   mode=consent   the home booking controls with their in-flow measurement choice
 *   mode=choice    add the privacy page's measurement control for checks across open tabs
 *   mode=source    the admin booking sheet; its Source row shows the link snapshot from convex-mock (`marketing=1`)
 *   locale=th      Thai consent copy
 *   theme=dark     dark app theme (light otherwise)
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const locale = params.get("locale") === "th" ? "th" : "en";

function GuestPage() {
  return (
    <main className="mx-auto max-w-5xl py-16 text-foreground">
      <h1 className="px-5 font-serif text-4xl font-semibold md:px-8">Auralis Cove Retreat</h1>
      <HomeQuickBooking />
      <section className="px-5 md:px-8">
        {Array.from({ length: 6 }, (_, index) => (
          <p key={index} className="mt-4 leading-relaxed text-muted-foreground">
            Private pool villas above the bay, a short walk from the beach. Book direct for the best rate and a welcome drink on arrival.
          </p>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <IntlProvider locale={locale} timeZone="Asia/Bangkok" messages={locale === "th" ? th : en}>
    {params.get("mode") === "source" ? (
      <ConfirmProvider>
        <BookingSheet bookingId={"booking-id" as Id<"bookings">} properties={[]} onClose={() => {}} />
      </ConfirmProvider>
    ) : (
      <div className="min-h-dvh bg-background">
        <GuestPage />
        {params.get("mode") === "choice" ? (
          <section className="mx-auto max-w-3xl px-5 pb-40 text-muted-foreground">
            <AnalyticsChoice />
          </section>
        ) : null}
        <AnalyticsConsent />
      </div>
    )}
  </IntlProvider>,
);
