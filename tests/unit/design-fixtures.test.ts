import { describe, expect, it } from "vitest";
import { designFixturesEnabled } from "@/lib/design-fixtures";

describe("design fixture routes", () => {
  it("render in next dev and on Vercel Preview only", () => {
    expect(designFixturesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(designFixturesEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(designFixturesEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    expect(designFixturesEnabled({ NODE_ENV: "production" })).toBe(false);
  });
});
