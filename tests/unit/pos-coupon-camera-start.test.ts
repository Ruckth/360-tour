// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import CouponScanDialog from "@/components/checkout/CouponScanDialog";

const decoder = vi.hoisted(() => {
  let release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { ready, release };
});
vi.mock("qr-scanner", async () => {
  await decoder.ready;
  return { default: class { start = vi.fn(async () => {}); destroy = vi.fn(); } };
});

it("stops a granted camera immediately when closing while the decoder is still loading", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  const track = { stop: vi.fn() };
  const stream = new MediaStream();
  stream.getTracks = () => [track as unknown as MediaStreamTrack];
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  try {
    await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(CouponScanDialog, { onDecode: () => {}, onClose: () => {} }))));
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(track.stop).toHaveBeenCalled();
  } finally {
    await act(async () => decoder.release());
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    Reflect.deleteProperty(navigator, "mediaDevices");
    Reflect.deleteProperty(window, "isSecureContext");
    vi.unstubAllGlobals();
  }
});
