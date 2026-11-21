/** Optional probe installed before navigation by the mobile browser benchmark. */
interface TourBenchHook {
  mark(name: string): void;
  frame(yaw: number, roomId: string): void;
}

declare global {
  interface Window {
    __tourBench?: TourBenchHook;
  }
}

export function tourBench(): TourBenchHook | undefined {
  return typeof window === "undefined" ? undefined : window.__tourBench;
}

export function markTourBench(name: string) {
  tourBench()?.mark(name);
}
