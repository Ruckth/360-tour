/*
 * Stands in for qr-scanner in the browser fixtures (aliased in vite.config.ts), so a spec can
 * "read" a QR code without a camera pointed at one: `window.__qrScanners` lists the scanners
 * started, and `window.__decodeQr(text)` makes the newest one decode `text`.
 */

type Decode = (result: { data: string; cornerPoints: [] }) => void;
type MockScanner = { video: HTMLVideoElement; options: Record<string, unknown>; destroyed: boolean; decode: Decode };

declare global {
  interface Window {
    __qrScanners?: MockScanner[];
    __decodeQr?: (text: string) => void;
  }
}

window.__qrScanners ??= [];
window.__decodeQr = (text) => {
  const scanner = window.__qrScanners?.findLast((entry) => !entry.destroyed);
  if (!scanner) throw new Error("No QR scanner is running");
  scanner.decode({ data: text, cornerPoints: [] });
};

export default class QrScanner {
  private readonly entry: MockScanner;

  constructor(video: HTMLVideoElement, decode: Decode, options: Record<string, unknown>) {
    this.entry = { video, options, destroyed: false, decode };
    window.__qrScanners!.push(this.entry);
  }

  async start() {
    await this.entry.video.play().catch(() => {});
  }

  stop() {}

  destroy() {
    this.entry.destroyed = true;
  }
}
