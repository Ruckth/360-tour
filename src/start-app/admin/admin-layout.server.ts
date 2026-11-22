import type { AbstractIntlMessages } from "@/platform/intl";
import type { Locale } from "@/i18n/routing";
import { designFixturesEnabled } from "@/lib/design-fixtures";
import { isServerFnRpcRequest } from "./admin-route";

export type StartAdminLayoutData =
  | { clerkConfigured: false }
  | { clerkConfigured: true; locale: Locale };

/**
 * Commerce copy (messages/commerce/<locale>.json) for checkout, receipts and the header's Approvals,
 * which signed-in admin views use. Kept on the server so the active locale travels
 * only in an authenticated response and no commerce dictionary enters client JS chunks.
 */
const COMMERCE_MESSAGES: Record<Locale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import("../../../messages/commerce/en.json"),
  th: () => import("../../../messages/commerce/th.json"),
  "zh-CN": () => import("../../../messages/commerce/zh-CN.json"),
  ja: () => import("../../../messages/commerce/ja.json"),
  ko: () => import("../../../messages/commerce/ko.json"),
  fr: () => import("../../../messages/commerce/fr.json"),
  de: () => import("../../../messages/commerce/de.json"),
  es: () => import("../../../messages/commerce/es.json"),
  ru: () => import("../../../messages/commerce/ru.json"),
  it: () => import("../../../messages/commerce/it.json"),
  hi: () => import("../../../messages/commerce/hi.json"),
};

export type AdminClerkEnv = Record<string, string | undefined>;

export function isStartClerkConfigured(env: AdminClerkEnv = process.env): boolean {
  const publishableKey =
    env.VITE_CLERK_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;

  return Boolean(publishableKey) && !publishableKey?.includes("placeholder") && Boolean(secretKey);
}

export async function loadCommerceMessages(locale: Locale): Promise<AbstractIntlMessages> {
  return (await COMMERCE_MESSAGES[locale]()).default;
}

export function loadStartAdminLayoutData(
  input: { locale: Locale },
  env: AdminClerkEnv = process.env,
): StartAdminLayoutData {
  if (!isStartClerkConfigured(env)) {
    return { clerkConfigured: false };
  }
  return { clerkConfigured: true, locale: input.locale };
}

export async function loadStartAdminCommerceData(
  input: { locale: Locale },
  deps: {
    getAuth: () => Promise<{ userId: string | null; sessionId: string | null }>;
    setResponseHeader: (name: string, value: string) => void;
  },
): Promise<AbstractIntlMessages | null> {
  deps.setResponseHeader("Cache-Control", "private, no-store");
  const { userId, sessionId } = await deps.getAuth();
  if (!userId || !sessionId) return null;
  return loadCommerceMessages(input.locale);
}

export function resolveStartCheckoutPreviewAccess(deps: {
  getRequest: () => Request;
  setResponseStatus: (code: number, text?: string) => void;
  env?: Partial<Record<"NODE_ENV" | "VERCEL_ENV", string>>;
}): { enabled: boolean } {
  const enabled = designFixturesEnabled(deps.env ?? process.env);
  if (!enabled && !isServerFnRpcRequest(deps.getRequest())) {
    deps.setResponseStatus(404, "Not Found");
  }
  return { enabled };
}
