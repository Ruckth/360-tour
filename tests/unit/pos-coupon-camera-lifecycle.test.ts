// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import CouponScanDialog from "@/components/checkout/CouponScanDialog";

const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;
let hidden = false;

function fakeStream(label: string) {
  const track = { kind: "video", label, readyState: "live", stop: vi.fn(function (this: { readyState: string }) { this.readyState = "ended"; }) };
  const stream = new MediaStream();
  stream.getTracks = () => [track as unknown as MediaStreamTrack];
  stream.getVideoTracks = () => [track as unknown as MediaStreamTrack];
  stream.removeTrack = () => {};
  return { track, stream };
}

beforeEach(() => {
  hidden = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("BarcodeDetector", class { static async getSupportedFormats() { return ["qr_code"]; } async detect() { return []; } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "hidden");
  Reflect.deleteProperty(window, "isSecureContext");
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("closes on background and never silently restarts the camera when the tab returns", async () => {
  const first = fakeStream("first");
  const getUserMedia = vi.fn(async () => first.stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const onClose = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? createElement(CouponScanDialog, { onDecode: () => {}, onClose: () => { onClose(); setOpen(false); } }) : null;
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(Host))));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.body.textContent).toContain(messages.PosCouponScan.scanning);
  });
  hidden = true;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(first.track.stop).toHaveBeenCalled();
  expect(document.querySelector('[data-testid="coupon-scan-dialog"]')).toBeNull();
  hidden = false;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});
