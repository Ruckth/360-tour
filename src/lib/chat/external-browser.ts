export const CHAT_EXTERNAL_BROWSER_PARAM = "external";
export const CHAT_CONTINUE_IN_APP_PARAM = "continueInApp";
export const CHAT_HANDOFF_PARAM = "handoff";

export type InAppBrowserKind =
  | "facebook"
  | "instagram"
  | "line"
  | "tiktok"
  | "wechat"
  | "android-webview";

export type ChatInAppBrowserDetection = {
  isMobile: boolean;
  isInAppBrowser: boolean;
  kind: InAppBrowserKind | null;
  platform: "android" | "ios" | "other";
};

export type ExternalBrowserTarget = {
  platform: "android" | "ios" | "other";
  url: string;
};

const MOBILE_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;
const ANDROID_WEBVIEW_PATTERN = /;\s?wv\)|Version\/[\d.]+.*Chrome\/[\d.]+.*Mobile Safari/i;

export function detectChatInAppBrowser(userAgent: string): ChatInAppBrowserDetection {
  const isMobile = MOBILE_PATTERN.test(userAgent);
  const platform = /Android/i.test(userAgent)
    ? "android"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "ios"
      : "other";

  if (!isMobile) {
    return { isMobile, isInAppBrowser: false, kind: null, platform };
  }

  const kind =
    /Instagram/i.test(userAgent)
      ? "instagram"
      : /FBAN|FBAV|FB_IAB|FB4A|FBIOS|Messenger/i.test(userAgent)
        ? "facebook"
        : /Line\//i.test(userAgent)
          ? "line"
          : /TikTok|Bytedance|musical_ly/i.test(userAgent)
            ? "tiktok"
            : /MicroMessenger/i.test(userAgent)
              ? "wechat"
              : /Android/i.test(userAgent) && ANDROID_WEBVIEW_PATTERN.test(userAgent)
                ? "android-webview"
                : null;

  return {
    isMobile,
    isInAppBrowser: Boolean(kind),
    kind,
    platform,
  };
}

export function shouldBypassChatBrowserGate(searchParams: Pick<URLSearchParams, "get">) {
  return (
    searchParams.get(CHAT_EXTERNAL_BROWSER_PARAM) === "1" ||
    searchParams.get(CHAT_CONTINUE_IN_APP_PARAM) === "1"
  );
}

export function appendChatExternalParams(
  href: string,
  { handoffToken }: { handoffToken?: string } = {},
) {
  const url = new URL(href);
  url.searchParams.set(CHAT_EXTERNAL_BROWSER_PARAM, "1");
  if (handoffToken) url.searchParams.set(CHAT_HANDOFF_PARAM, handoffToken);
  return url.toString();
}

export function stripChatHandoffParam(pathWithSearch: string) {
  const url = new URL(pathWithSearch, "https://example.test");
  url.searchParams.delete(CHAT_HANDOFF_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildExternalBrowserTarget(
  href: string,
  userAgent: string,
): ExternalBrowserTarget {
  const detection = detectChatInAppBrowser(userAgent);
  const url = new URL(href);

  if (detection.platform === "android") {
    const scheme = url.protocol.replace(":", "");
    return {
      platform: "android",
      url: `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.toString())};end`,
    };
  }

  if (detection.platform === "ios") {
    const chromeScheme = url.protocol === "https:" ? "googlechromes:" : "googlechrome:";
    return {
      platform: "ios",
      url: `${chromeScheme}//${url.host}${url.pathname}${url.search}${url.hash}`,
    };
  }

  return {
    platform: "other",
    url: url.toString(),
  };
}
