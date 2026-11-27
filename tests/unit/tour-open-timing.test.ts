// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTourOpenTiming } from "@/lib/tour/use-tour-open-timing";

const { consentGeneration, mayCapture } = vi.hoisted(() => ({
  consentGeneration: vi.fn<() => number>(),
  mayCapture: vi.fn<(generation: number) => boolean>(),
}));

vi.mock("@/lib/marketing/capture", () => ({ consentGeneration, mayCapture }));

let root: Root | undefined;
const report = vi.fn();
const now = vi.fn<() => number>();
const navigation = vi.fn<() => { name: string; startTime: number }[]>();

async function mount(direct: boolean) {
  let timing: ReturnType<typeof useTourOpenTiming> | undefined;
  function Fixture() {
    const controls = useTourOpenTiming(direct, report);
    useEffect(() => { timing = controls; }, [controls]);
    return null;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => { root?.render(createElement(Fixture)); });
  if (!timing) throw new Error("Timing hook did not mount");
  return timing;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("performance", { now, getEntriesByType: navigation });
  consentGeneration.mockReturnValue(1);
  mayCapture.mockImplementation((generation) => generation === consentGeneration());
  now.mockReturnValue(1_000);
  navigation.mockReturnValue([]);
  report.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("guest tour open timing", () => {
  it("reports the ready renderer once and distinguishes a warm reopen", async () => {
    const timing = await mount(false);
    timing.begin();
    now.mockReturnValue(1_750);
    timing.finish("three");
    timing.finish("three");
    timing.begin();
    now.mockReturnValue(1_920);
    timing.finish("pannellum");

    expect(report.mock.calls).toEqual([
      ["tap", "three", 750, 1],
      ["reopen", "pannellum", 170, 1],
    ]);
  });

  it("uses the navigation origin only for a matching direct document", async () => {
    window.history.replaceState(null, "", "/rooms/pool-villa?tour=1");
    navigation.mockReturnValue([{ name: window.location.href, startTime: 0 }]);
    const timing = await mount(true);
    timing.finish("pannellum");
    expect(report).toHaveBeenCalledExactlyOnceWith("direct", "pannellum", 1_000, 1);
  });

  it("does not attribute a soft tour link to the original page navigation", async () => {
    window.history.replaceState(null, "", "/rooms/pool-villa?tour=1");
    navigation.mockReturnValue([{ name: new URL("/", window.location.href).href, startTime: 0 }]);
    const timing = await mount(true);
    timing.finish("three");
    expect(report).not.toHaveBeenCalled();
  });

  it("drops cancelled sessions and work started under a previous consent choice", async () => {
    const timing = await mount(false);
    timing.begin();
    timing.cancel();
    timing.finish("three");
    timing.begin();
    consentGeneration.mockReturnValue(2);
    timing.finish("three");
    expect(report).not.toHaveBeenCalled();
  });
});
