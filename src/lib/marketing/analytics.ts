import type { BeforeSendFn, PostHog } from "posthog-js";
import { stripLocalePrefix } from "@/i18n/routing";
import { consentGeneration, isUntrackedPath, mayCapture, onConsentTransition } from "./capture";

/**
 * PostHog page views and guest performance timings under the shared measurement choice (see capture.ts). Client only.
 *
 * The SDK is loaded and started only while the answer is Yes, and every event checks the consent
 * generation it started in, after the SDK has loaded too. A withdrawal heard in any tab resets the SDK's
 * identity and then opts it out (reset() clears an opt-out, so the order matters); the opt-out is saved
 * by PostHog. A later Yes starts a fresh identity and opts back in explicitly, without PostHog's own
 * `$opt_in` event. The tab where the guest said Yes sends one page view for the page they are on; other
 * tabs send theirs on the next navigation.
 */

export type AnalyticsConfig = { key: string; host: string };
type TourTiming = {
  metric: "tour_ready";
  entry: "direct" | "tap" | "reopen";
  renderer: "three" | "pannellum";
  durationMs: number;
};
type HomeCalendarTiming = {
  metric: "home_calendar_open";
  trigger: "check_in" | "check_out";
  durationMs: number;
};
type BookingTiming = {
  metric: "booking_villa_selected" | "booking_dates_ready";
  durationMs: number;
};
type GuestPerformanceTiming = TourTiming | HomeCalendarTiming | BookingTiming;
type ClockTiming = Omit<HomeCalendarTiming, "durationMs"> | Omit<BookingTiming, "durationMs">;
const PERFORMANCE_EVENT = "guest_performance";

function performanceProperties(properties: Record<string, unknown>) {
  const { metric, duration_ms: duration, entry, renderer, trigger } = properties;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 120_000) return null;
  const duration_ms = Math.round(duration);
  if (metric === "tour_ready" && (entry === "direct" || entry === "tap" || entry === "reopen")
      && (renderer === "three" || renderer === "pannellum")) {
    return { metric, duration_ms, entry, renderer };
  }
  if (metric === "home_calendar_open" && (trigger === "check_in" || trigger === "check_out")) {
    return { metric, duration_ms, trigger };
  }
  if (metric === "booking_villa_selected" || metric === "booking_dates_ready") {
    return { metric, duration_ms };
  }
  return null;
}

// The SDK adds location and referrer details by default. Keep only the timing and ingestion fields.
const stripPerformanceContext: BeforeSendFn = (event) => {
  if (event?.event !== PERFORMANCE_EVENT) return event;
  const properties = event.properties;
  const timing = properties && performanceProperties(properties);
  if (!properties || !timing) return null;
  return {
    event: event.event,
    timestamp: event.timestamp,
    uuid: event.uuid,
    properties: {
      token: properties.token,
      distinct_id: properties.distinct_id,
      // PostHog processes person profiles by default when this ingestion flag is absent.
      $process_person_profile: properties.$process_person_profile === true,
      ...timing,
    },
  };
};

type Route = { path: string; config: AnalyticsConfig | null };
let route: Route | null = null;
// The started SDK; null until the first event under Yes.
let sdk: PostHog | null = null;
// The guest said Yes on this page: the next use of the SDK starts a fresh identity and opts in.
let freshStart = false;
// The last page view sent, so one page is never counted twice for the same answer.
let sent: { generation: number; path: string } | null = null;

const OPTIONS = {
  capture_pageview: false,
  autocapture: false,
  disable_session_recording: true,
  // Resetting consent must not start flag or extension requests.
  advanced_disable_flags: true,
  disable_external_dependency_loading: true,
  disable_surveys: true,
  disable_conversations: true,
  disable_product_tours: true,
  person_profiles: "identified_only",
  before_send: stripPerformanceContext,
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

// The SDK module, loaded once and shared by every event waiting for it.
let loading: Promise<PostHog> | null = null;

function loadSdk(): Promise<PostHog> {
  const load = (loading ??= import("posthog-js").then((module) => module.default));
  // A failed load (offline, blocked) can be tried again by a later page view.
  void load.catch(() => {
    if (loading === load) loading = null;
  });
  return load;
}

function initializeSdk(posthog: PostHog, config: AnalyticsConfig) {
  if (!sdk) {
    posthog.init(config.key, { ...OPTIONS, api_host: config.host });
    sdk = posthog;
  }
  // An opt-out saved from the previous visit is lifted only once consent authorizes capture.
  if (freshStart || posthog.has_opted_out_capturing()) restart(posthog);
}

export function startGuestPerformanceClock() {
  const consent = consentGeneration();
  return mayCapture(consent) ? { consent, start: performance.now() } : null;
}

export function finishGuestPerformanceClock(clock: ReturnType<typeof startGuestPerformanceClock>, timing: ClockTiming) {
  if (clock) void captureGuestPerformance({ ...timing, durationMs: performance.now() - clock.start }, clock.consent);
}

export async function captureGuestPerformance(timing: GuestPerformanceTiming, startedIn: number) {
  const current = route;
  if (!current?.config || !mayCapture(startedIn)) return;
  const pathname = stripLocalePrefix(current.path);
  if (timing.metric === "home_calendar_open" && pathname !== "/") return;
  if (timing.metric === "tour_ready" && pathname !== "/" && !pathname.startsWith("/rooms/")) return;
  if ((timing.metric === "booking_villa_selected" || timing.metric === "booking_dates_ready") && pathname !== "/booking") return;
  const properties = performanceProperties({ ...timing, duration_ms: timing.durationMs });
  if (!properties) return;

  try {
    const posthog = await loadSdk();
    if (route !== current || !mayCapture(startedIn)) return;
    initializeSdk(posthog, current.config);
    // Send while this consent is current instead of leaving timings in the SDK's batch queue.
    posthog.capture(PERFORMANCE_EVENT, properties, { send_instantly: true, transport: "sendBeacon" });
  } catch {
    // Measurements must never delay or break a guest action.
  }
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
    initializeSdk(posthog, current.config);
    sent = { generation, path: current.path };
    posthog.capture("$pageview");
  } catch {
    // Analytics must never break the page.
  }
}
