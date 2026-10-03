"use client";

import { useMessages } from "next-intl";
import type { PublicMessages } from "@/lib/i18n/public-content";

/**
 * The ACTIVE locale's message dictionary for client components, typed as `PublicMessages`.
 * The root layout already hands the active locale's full messages to NextIntlClientProvider
 * (`getMessages()`), so reading them here is free — it adds no locale JSON to the client
 * bundle, unlike the old `getPublicMessages(locale)` path which pulled in all 11 dictionaries.
 */
export function usePublicMessages(): PublicMessages {
  return useMessages() as unknown as PublicMessages;
}
