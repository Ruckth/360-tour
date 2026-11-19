"use client";

import { NextIntlClientProvider, useLocale, useMessages, type AbstractIntlMessages } from "next-intl";
import { useMemo, type ReactNode } from "react";

/**
 * Adds messages/commerce/<locale>.json (the "Commerce" namespace) to the messages already provided,
 * for the screens below it. The admin layout passes the dictionary from the server, so it travels
 * in the page payload and never in a JavaScript chunk.
 */
export function CommerceMessages({ messages, children }: { messages: AbstractIntlMessages; children: ReactNode }) {
  const parent = useMessages();
  const locale = useLocale();
  const merged = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
  return <NextIntlClientProvider locale={locale} messages={merged}>{children}</NextIntlClientProvider>;
}
