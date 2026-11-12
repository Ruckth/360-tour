"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOptionalConvex } from '@/lib/react/convex';
import { createChatBrowserHandoff } from '@/lib/react/convex-api';
import type { GuestCredentials } from './useGuestSession';
import {
  appendChatExternalParams,
  buildExternalBrowserTarget,
  CHAT_CONTINUE_IN_APP_PARAM,
  CHAT_HANDOFF_PARAM,
  detectChatInAppBrowser,
  shouldBypassChatBrowserGate,
  type ExternalBrowserTarget,
} from "@/lib/chat/external-browser";
export function useChatHandoff(mode: 'page' | 'overlay', hydrated: boolean, ensureSession: () => Promise<GuestCredentials | null>) {
 const router = useRouter();
 const convex = useOptionalConvex();
 const searchParams = useSearchParams();
 const browserHandoffToken = searchParams.get(CHAT_HANDOFF_PARAM);
 const browserGateBypassed = shouldBypassChatBrowserGate(searchParams);
 const browserGateAttemptedRef = useRef(false);
  const [browserGateVisible, setBrowserGateVisible] = useState(false);
  const [browserGateUrl, setBrowserGateUrl] = useState<string | null>(null);
  const [browserGateOpenUrl, setBrowserGateOpenUrl] = useState<string | null>(
    null,
  );
  const [browserGateTargetBrowser, setBrowserGateTargetBrowser] =
    useState<ExternalBrowserTarget["browser"]>("browser");
  const [browserGateCopyStatus, setBrowserGateCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
  useEffect(() => {
    if (mode !== "page" || !hydrated) return;
    if (browserGateBypassed || browserHandoffToken) {
      setBrowserGateVisible(false);
      setBrowserGateTargetBrowser("browser");
      return;
    }

    const detection = detectChatInAppBrowser(navigator.userAgent);
    setBrowserGateVisible(detection.isInAppBrowser);
    if (detection.isInAppBrowser) {
      setBrowserGateTargetBrowser(
        detection.platform === "ios"
          ? "safari"
          : detection.platform === "android"
            ? "chrome"
            : "browser",
      );
    }
    if (!detection.isInAppBrowser) {
      browserGateAttemptedRef.current = false;
      setBrowserGateUrl(null);
      setBrowserGateOpenUrl(null);
      setBrowserGateTargetBrowser("browser");
    }
  }, [browserGateBypassed, browserHandoffToken, hydrated, mode]);

  useEffect(() => {
    if (mode !== "page" || !browserGateVisible || !hydrated) return;
    if (browserGateAttemptedRef.current) return;
    browserGateAttemptedRef.current = true;

    let cancelled = false;
    let fallbackTimeout = 0;

    async function openExternalBrowser() {
      let handoffToken: string | undefined;
      try {
        const credentials = await ensureSession();
        const id = credentials?.sessionId;
        if (cancelled) return;
        if (id && convex) {
          handoffToken = await createChatBrowserHandoff(convex, {
            sessionId: id,
          });
        }
      } catch {
        // The browser link still works without a restorable Convex session.
      }

      if (cancelled) return;

      const browserUrl = appendChatExternalParams(window.location.href, {
        handoffToken,
      });
      const target = buildExternalBrowserTarget(
        browserUrl,
        navigator.userAgent,
      );
      setBrowserGateUrl(browserUrl);
      setBrowserGateOpenUrl(target.url);
      setBrowserGateTargetBrowser(target.browser);

      fallbackTimeout = window.setTimeout(() => {
        setBrowserGateCopyStatus("idle");
      }, 1200);
      window.location.href = target.url;
    }

    void openExternalBrowser();

    return () => {
      cancelled = true;
      if (fallbackTimeout) window.clearTimeout(fallbackTimeout);
    };
  }, [browserGateVisible, convex, ensureSession, hydrated, mode]);

  const continueInAppBrowser = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set(CHAT_CONTINUE_IN_APP_PARAM, "1");
    url.searchParams.delete(CHAT_HANDOFF_PARAM);
    setBrowserGateVisible(false);
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [router]);

  const copyBrowserLink = useCallback(async () => {
    if (!browserGateUrl) return;
    try {
      await navigator.clipboard.writeText(browserGateUrl);
      setBrowserGateCopyStatus("copied");
    } catch {
      setBrowserGateCopyStatus("error");
    }
  }, [browserGateUrl]);

 return { browserGateVisible, browserGateUrl, browserGateOpenUrl, browserGateTargetBrowser, browserGateCopyStatus, continueInAppBrowser, copyBrowserLink };
}
