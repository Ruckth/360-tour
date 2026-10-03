import { describe, expect, it } from "vitest";
import { isSlowEffectiveType, shouldLoadHeroVideo } from "@/components/home/hero-video";

describe("shouldLoadHeroVideo", () => {
  it("loads video on a fast, unconstrained connection", () => {
    expect(shouldLoadHeroVideo({ effectiveType: "4g" })).toBe(true);
    expect(shouldLoadHeroVideo({ effectiveType: "3g" })).toBe(true);
    expect(shouldLoadHeroVideo({})).toBe(true);
    expect(shouldLoadHeroVideo()).toBe(true);
  });

  it("shows poster only when the guest prefers reduced motion", () => {
    expect(shouldLoadHeroVideo({ reducedMotion: true, effectiveType: "4g" })).toBe(false);
  });

  it("shows poster only when Save-Data is on", () => {
    expect(shouldLoadHeroVideo({ saveData: true, effectiveType: "4g" })).toBe(false);
  });

  it("shows poster only on a slow effective connection", () => {
    expect(shouldLoadHeroVideo({ effectiveType: "2g" })).toBe(false);
    expect(shouldLoadHeroVideo({ effectiveType: "slow-2g" })).toBe(false);
  });

  it("treats a missing effectiveType as not-slow", () => {
    expect(shouldLoadHeroVideo({ effectiveType: null })).toBe(true);
    expect(shouldLoadHeroVideo({ effectiveType: undefined })).toBe(true);
  });

  it("isSlowEffectiveType recognizes only 2g and slow-2g", () => {
    expect(isSlowEffectiveType("slow-2g")).toBe(true);
    expect(isSlowEffectiveType("2g")).toBe(true);
    expect(isSlowEffectiveType("3g")).toBe(false);
    expect(isSlowEffectiveType("4g")).toBe(false);
    expect(isSlowEffectiveType(null)).toBe(false);
    expect(isSlowEffectiveType(undefined)).toBe(false);
  });
});
