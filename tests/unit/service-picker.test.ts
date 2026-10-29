import { describe, expect, it } from "vitest";
import { groupServices, matchServiceSearch } from "@/lib/service-picker";

const service = (name: string, category: string) => ({ name, category });

describe("groupServices", () => {
  it("groups by category and sorts both groups and names", () => {
    const groups = groupServices([
      service("Sunrise Yoga", "Wellness"),
      service("Island Day Tour", "Excursions"),
      service("Aromatherapy Oil Massage", "Wellness"),
      service("Mystery", "  "),
    ]);
    expect(groups.map(([category, items]) => [category, items.map((s) => s.name)])).toEqual([
      ["Excursions", ["Island Day Tour"]],
      ["Other", ["Mystery"]],
      ["Wellness", ["Aromatherapy Oil Massage", "Sunrise Yoga"]],
    ]);
  });
});

describe("matchServiceSearch", () => {
  it("matches names and categories without treating storage IDs as search text", () => {
    expect(matchServiceSearch("massage-id", " MASSAGE ", ["Thai Massage", "Wellness"])).toBe(1);
    expect(matchServiceSearch("massage-id", "well", ["Yoga", "Wellness"])).toBe(1);
    expect(matchServiceSearch("massage-id", "massage", ["Yoga", "Wellness"])).toBe(0);
    expect(matchServiceSearch("id", "other", ["Mystery", "Other"])).toBe(1);
    expect(matchServiceSearch("id", "   ")).toBe(1);
  });
});
