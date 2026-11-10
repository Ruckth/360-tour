import type { PostHog } from "posthog-js";
import { consentGeneration, isUntrackedPath, mayCapture, onConsentTransition } from "./capture";

/**
 * PostHog page views under the shared measurement choice (see capture.ts). Client only.
 *
 * The SDK is loaded and started only while the answer is Yes, and every page view checks the consent
 * generation it started in, after the SDK has loaded too. A withdrawal heard in any tab resets the SDK's
 * identity and then opts it out (reset() clears an opt-out, so the order matters); the opt-out is saved
 * by PostHog. A later Yes starts a fresh identity and opts back in explicitly, without PostHog's own
 * `$opt_in` event. The tab where the guest said Yes sends one page view for the page they are on; other
 * tabs send theirs on the next navigation.
 */

export type AnalyticsConfig = { key: string; host: string };

type Route = { path: string; config: AnalyticsConfig | null };
let route: Route | null = null;
// The started SDK; null until the first page view under Yes.
let sdk: PostHog | null = null;
// The guest said Yes on this page: the next use of the SDK starts a fresh identity and opts in.
let freshStart = false;
// The last page view sent, so one page is never counted twice for the same answer.
let sent: { generation: number; path: string } | null = null;

const OPTIONS = {
  capture_pageview: false,
  autocapture: false,
  disable_session_recording: true,
  // Only page views are used here. Resetting consent must not start flag or extension requests.
  advanced_disable_flags: true,
  disable_external_dependency_loading: true,
  disable_surveys: true,
  disable_conversations: true,
  disable_product_tours: true,
  person_profiles: "identified_only",
} as const;

function restart(posthog: PostHog) {
  // Reset first: it clears the SDK's consent, so opting in after it is what sticks.
  posthog.reset();
  posthog.opt_in_capturing({ captureEventName: false });
  freshStart = false;
}

onConsentTransition(({ granted, local }) => {
  try {
    if (!granted) {
      freshStart = false;
      if (sdk) {
        sdk.reset();
        sdk.opt_out_capturing();
      }
      return;
    }
    freshStart = true;
    if (sdk) restart(sdk);
  } catch {
    // Analytics must never break the page.
  }
  if (granted && local) void sendPageview();
});

/** Called on every route (staff ones too, which are never measured), with null when there is no PostHog key. */
export function analyticsRoute(path: string, config: AnalyticsConfig | null) {
  route = { path, config };
  void sendPageview();
}

// The SDK module, loaded once and shared by every page view waiting for it.
let loading: Promise<PostHog> | null = null;

function loadSdk(): Promise<PostHog> {
  const load = (loading ??= import("posthog-js").then((module) => module.default));
  // A failed load (offline, blocked) can be tried again by a later page view.
  load.catch(() => {
    if (loading === load) loading = null;
  });
  return load;
}

const alreadySent = (generation: number, path: string) => sent?.generation === generation && sent.path === path;

async function sendPageview() {
  const current = route;
  if (!current?.config || isUntrackedPath(current.path)) return;
  const generation = consentGeneration();
  if (!mayCapture(generation) || alreadySent(generation, current.path)) return;
  let posthog: PostHog;
  try {
    posthog = await loadSdk();
  } catch {
    return;
  }
  // Anything may have changed while the SDK loaded: the answer, the page, or another call sent this view.
  if (route !== current || !mayCapture(generation) || alreadySent(generation, current.path)) return;
  try {
    if (!sdk) {
      posthog.init(current.config.key, { ...OPTIONS, api_host: current.config.host });
      sdk = posthog;
    }
    // An opt-out PostHog saved when the guest last said No isn't lifted by starting up.
    if (freshStart || posthog.has_opted_out_capturing()) restart(posthog);
    sent = { generation, path: current.path };
    posthog.capture("$pageview");
  } catch {
    // Analytics must never break the page.
  }
}
