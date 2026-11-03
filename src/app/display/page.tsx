import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { CustomerDisplay } from "@/components/display/CustomerDisplay";
// English only for now; add messages/display/<locale>.json to translate. Kept out of messages/<locale>.json
// so public pages don't ship display strings and the locale-parity tests stay about the public site.
import messages from "../../../messages/display/en.json";

export const metadata: Metadata = {
  title: messages.Display.title,
  robots: { index: false, follow: false },
};

export default function DisplayPage() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <CustomerDisplay />
    </NextIntlClientProvider>
  );
}
