// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { NextIntlClientProvider } from "next-intl";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { scanProblem } from "@/components/checkout/CouponScanDialog";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";

/*
 * The camera coupon scanner at checkout, with qr-scanner and the camera mocked: what it decodes goes
 * through the coupon field like a pasted link, each camera problem is explained in a closable
 * dialog, and the camera stops whenever the dialog goes away.
 */

type Decode = (result: { data: string }) => void;
const scanners = vi.hoisted(() => {
  const list: { video: HTMLVideoElement; decode: Decode; options: Record<string, unknown>; start: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  return list;
});
vi.mock("qr-scanner", () => ({
  default: class FakeQrScanner {
    start = vi.fn(async () => {});
    destroy = vi.fn();
    constructor(video: HTMLVideoElement, decode: Decode, options: Record<string, unknown>) {
      scanners.push({ video, decode, options, start: this.start, destroy: this.destroy });
    }
  },
}));

const text = messages.PosCouponScan;
const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;

function fakeStream() {
  const track = { kind: "video", stop: vi.fn() };
  // A real (happy-dom) MediaStream, which video.srcObject insists on, holding a track we can watch.
  const stream = new MediaStream();
  stream.getTracks = () => [track as unknown as MediaStreamTrack];
  return { track, stream };
}
function cameraApi(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const spy = vi.fn(getUserMedia);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: spy } });
  return spy;
}
function secure(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}

function Page({ start }: { start: OrderId | null }) {
  const [orderId, setOrderId] = useState<OrderId | null>(start);
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const show = (backend: CheckoutBackend, start: OrderId) =>
  act(async () =>
    root.render(createElement(NextIntlClientProvider, intl, createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Page, { start })))),
  );
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400); });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const addCoupon = () => [...panel().querySelectorAll("button")].find((el) => el.textContent?.startsWith("Add coupon"));
const scanButton = () => panel().querySelector<HTMLButtonElement>(`button[aria-label="${text.scanLabel}"]`);
const field = () => panel().querySelector<HTMLInputElement>('form[aria-label="Add coupon"] input')!;
const dialog = () => document.querySelector<HTMLElement>('[data-testid="coupon-scan-dialog"]');
const dialogButton = (name: string) => [...(dialog()?.querySelectorAll("button") ?? [])].find((el) => el.textContent?.trim() === name);
const problem = () => dialog()?.querySelector('[data-testid="coupon-scan-problem"]')?.textContent;

const service = (n: number) => ({ kind: "service" as const, serviceId: `fxsvc${String(n).padStart(6, "0")}` as Id<"services"> });
/** Thai massage 60 ฿1,200 + Foot spa 45 ฿600 + Breakfast basket ฿450, as in pos-coupon-ui. */
async function spaOrder(backend: CheckoutBackend) {
  const actions = backend.useActions();
  const first = actions.addItem({ item: service(1) });
  await vi.advanceTimersByTimeAsync(200);
  const { orderId } = await first;
  const rest = Promise.all([actions.addItem({ orderId, item: service(7) }), actions.addItem({ orderId, item: { kind: "extra", name: "Breakfast basket", price: 450 } })]);
  await vi.advanceTimersByTimeAsync(400);
  await rest;
  return orderId;
}

/** The spa order open at checkout, with the coupon field showing; returns its applyOrderCoupon spy. */
async function couponField() {
  const backend = createFixtureBackend();
  const orderId = await spaOrder(backend);
  const apply = vi.spyOn(backend.useActions(), "applyOrderCoupon");
  await show(backend, orderId);
  await click(addCoupon());
  return { orderId, apply };
}
/** Presses Scan and waits for the lazily loaded dialog and the camera start. */
async function openScanner() {
  await click(scanButton());
  await settle();
  expect(dialog()).not.toBeNull();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  scanners.length = 0;
  secure(true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(window, "isSecureContext");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("scanning a coupon with the camera", () => {
  it("isn't offered when the browser has no camera API", async () => {
    await couponField();
    expect(field()).toBeDefined();
    expect(scanButton()).toBeNull();
  });

  it("applies a decoded offer link through the coupon field, as a pasted link does, and stops the camera", async () => {
    const { track, stream } = fakeStream();
    const getUserMedia = cameraApi(async () => stream);
    const { orderId, apply } = await couponField();
    await openScanner();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: "environment" } } });
    expect(scanners).toHaveLength(1);
    expect(scanners[0].options.preferredCamera).toBe("environment");
    expect(scanners[0].video.srcObject).toBe(stream);
    expect(scanners[0].start).toHaveBeenCalled();
    expect(dialog()?.textContent).toContain(text.scanning);

    await act(async () => scanners[0].decode({ data: ` ${window.location.origin}/q1 ` }));
    expect(dialog()).toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(scanners[0].destroy).toHaveBeenCalled();
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith({ orderId, slug: "q1" });
    expect(panel().querySelector('[data-testid="order-coupon"]')?.textContent).toContain("DCNT-SPA-500");
  });

  it("leaves what it read in the field with the same message a paste gets when it doesn't apply", async () => {
    const { stream } = fakeStream();
    cameraApi(async () => stream);
    const { orderId, apply } = await couponField();

    await openScanner();
    await act(async () => scanners[0].decode({ data: "https://elsewhere.example/q1" }));
    await settle();
    expect(field().value).toBe("https://elsewhere.example/q1");
    expect(panel().textContent).toContain("Only offer links from this site can be used.");
    expect(apply).not.toHaveBeenCalled();

    await openScanner();
    await act(async () => scanners[1].decode({ data: "DCNT-NOPE" }));
    await settle();
    expect(apply).toHaveBeenLastCalledWith({ orderId, code: "DCNT-NOPE" });
    expect(field().value).toBe("DCNT-NOPE");
    expect(panel().textContent).toContain("No coupon has this code. Check the spelling.");
  });

  it("explains a refused camera, can try again, and still closes with Escape", async () => {
    let refuse = true;
    const { stream } = fakeStream();
    const getUserMedia = cameraApi(async () => {
      if (refuse) throw new DOMException("Permission denied", "NotAllowedError");
      return stream;
    });
    await couponField();
    await openScanner();
    expect(problem()).toBe(text.denied);
    expect(dialog()?.querySelector('[role="alert"]')).not.toBeNull();
    expect(scanners).toHaveLength(0);

    refuse = false;
    await click(dialogButton(text.tryAgain));
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(problem()).toBeUndefined();
    expect(dialog()?.textContent).toContain(text.scanning);

    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(field()).toBeDefined();
  });

  it("says when there is no camera, and Cancel closes it", async () => {
    cameraApi(async () => {
      throw new DOMException("Requested device not found", "NotFoundError");
    });
    await couponField();
    await openScanner();
    expect(problem()).toBe(text.noCamera);
    expect(dialogButton(text.tryAgain)).toBeUndefined();
    await click(dialogButton(text.cancel));
    expect(dialog()).toBeNull();
  });

  it("is offered on a plain-http page and explains that the camera needs https", async () => {
    // Browsers leave navigator.mediaDevices out of insecure pages.
    secure(false);
    await couponField();
    await openScanner();
    expect(problem()).toBe(text.insecure);
    expect(scanners).toHaveLength(0);
    await click(dialogButton(text.cancel));
    expect(dialog()).toBeNull();
  });

  it("stops the camera when cancelled, when the checkout goes away, and when it arrives after closing", async () => {
    const first = fakeStream();
    cameraApi(async () => first.stream);
    await couponField();
    await openScanner();
    await click(dialogButton(text.cancel));
    expect(dialog()).toBeNull();
    expect(first.track.stop).toHaveBeenCalled();
    expect(scanners[0].destroy).toHaveBeenCalled();

    const second = fakeStream();
    cameraApi(async () => second.stream);
    await openScanner();
    expect(second.track.stop).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(second.track.stop).toHaveBeenCalled();
    expect(scanners[1].destroy).toHaveBeenCalled();
  });

  it("stops a camera that only starts after the dialog was closed", async () => {
    const late = fakeStream();
    let grant: (stream: MediaStream) => void = () => {};
    cameraApi(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    await couponField();
    await openScanner();
    expect(dialog()?.textContent).toContain(text.starting);
    await click(dialogButton(text.cancel));
    await act(async () => grant(late.stream));
    expect(late.track.stop).toHaveBeenCalled();
    expect(scanners).toHaveLength(0);
  });
});

describe("camera problems", () => {
  it.each([
    [new DOMException("", "NotAllowedError"), "denied"],
    [new DOMException("", "SecurityError"), "denied"],
    [new DOMException("", "NotFoundError"), "noCamera"],
    [new DOMException("", "OverconstrainedError"), "noCamera"],
    ["Camera not found.", "noCamera"],
    [new DOMException("", "NotReadableError"), "inUse"],
    [new Error("boom"), "failed"],
    [undefined, "failed"],
  ])("sorts %s as %s", (error, expected) => {
    expect(scanProblem(error)).toBe(expected);
  });
});
