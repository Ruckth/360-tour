import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  aggregate,
  CATEGORIES,
  formatScore,
  krippendorffAlpha,
  lintFlow,
  scorecardRows,
  severityCap,
  validateAudit,
} from "../../../scripts/ui-loop/scoring.ts";
import type {
  Audit,
  Category,
  Issue,
} from "../../../scripts/ui-loop/scoring.ts";
const schema = JSON.parse(
  readFileSync(
    new URL("../../../scripts/ui-loop/schema.json", import.meta.url),
    "utf8",
  ),
);
const file = "chats-ipad-l-default.png";
const issue = (
  severity = 1,
  category: Category = "typography",
  id = "I1",
  feature_gap = false,
): Issue => ({
  id,
  category,
  severity,
  screenshot: file,
  where: "'Guest', list header",
  observation: "A label differs from its peers.",
  fix: "Use the shared label treatment.",
  feature_gap,
});
const audit = (score = 10, issues: Issue[] = []): Audit => ({
  schema_version: "ui-score/1",
  screen: "chats",
  device: "ipad-l",
  observed_states: ["default"],
  issues,
  categories: CATEGORIES.map((id) => ({
    id,
    score,
    evidence: "Title and supporting labels are visible.",
    screenshots: [file],
    blocking_issue_ids: issues
      .filter((i) => i.category === id)
      .map((i) => i.id),
  })),
  page_specific: [],
  feature_gaps: [],
  not_observed: ["long", "error"],
});
describe("severity caps", () => {
  it.each([
    [[], 10],
    [[1], 9],
    [[1, 1], 9],
    [[1, 1, 1], 8],
    [[2], 8],
    [[2, 2], 7],
    [[3], 6],
    [[3, 3], 4],
    [[4], 4],
  ] as [number[], number][])("caps severities %j at %s", (severities, cap) =>
    expect(
      severityCap(severities.map((s, i) => issue(s, "typography", `I${i}`))),
    ).toBe(cap),
  );
  it("excludes feature gaps", () =>
    expect(severityCap([issue(4, "typography", "I1", true)])).toBe(10));
});
describe("aggregation", () => {
  it("logs per-run clamps without double-penalizing another category", () => {
    const a = aggregate([audit(10, [issue(3)])], true);
    expect(a.category_means.typography).toBe(6);
    expect(a.category_means.hierarchy).toBe(10);
    expect(a.clamp_log).toEqual([
      { run: 1, category: "typography", from: 10, to: 6 },
    ]);
    expect(a.gate).toEqual({
      overall: true,
      floor: false,
      majors: false,
      checks: true,
    });
  });
  it("uses equal category weights and arithmetic means", () => {
    const r = aggregate([audit(8), audit(9), audit(10)], true);
    expect(r.overall).toBe(9);
    expect(r.category_means.typography).toBe(9);
    expect(r.run_spread).toBe(2);
    expect(r.needs_more_runs).toBe(true);
  });
  it("escalates a category spread even if overall spread is small", () => {
    const runs = [audit(9), audit(9), audit(9)];
    runs[2].categories[0].score = 6;
    const r = aggregate(runs, true);
    expect(r.run_spread).toBeLessThan(0.6);
    expect(r.needs_more_runs).toBe(true);
  });
  it("uses five-run category medians for unstable cells", () => {
    const r = aggregate(
      [audit(5), audit(9), audit(9), audit(10), audit(10)],
      true,
    );
    expect(r.method).toBe("median");
    expect(r.category_means.clarity).toBe(9);
    expect(r.needs_more_runs).toBe(false);
  });
  it("keeps unconfirmed majors from the majority issue gate but caps their run", () => {
    const r = aggregate([audit(10, [issue(3)]), audit(), audit()], true);
    expect(r.issues[0].confirmed).toBe(false);
    expect(r.gate.majors).toBe(true);
    expect(r.category_means.typography).toBeCloseTo(8.6667);
  });
  it("merges same issues once per run and requires a majority", () => {
    const r = aggregate(
      [
        audit(10, [issue(3)]),
        audit(10, [issue(3, "typography", "different-id")]),
        audit(),
      ],
      true,
    );
    expect(r.open_majors).toBe(1);
    expect(r.issues[0].occurrences).toBe(2);
  });
  it("fails checks independently of scores and excludes feature gaps from gates", () => {
    const r = aggregate(
      [audit(10, [issue(4, "typography", "I1", true)])],
      false,
    );
    expect(r.gate).toEqual({
      overall: true,
      floor: true,
      majors: true,
      checks: false,
    });
  });
  it("flags halo and rejects empty aggregation", () => {
    expect(aggregate([audit()], true).halo_flags[0].flag).toBe(true);
    expect(() => aggregate([], true)).toThrow();
  });
});
describe("strict audit validation", () => {
  it("accepts complete evidence and the keyboard extension", () => {
    const a = audit();
    a.observed_states.push("keyboard");
    expect(
      validateAudit(a, schema, "chats", "ipad-l", [
        file,
        "chats-ipad-l-keyboard.png",
      ]),
    ).toEqual([]);
  });
  it("rejects additional fields, decimals, duplicates, wrong order, and missing evidence", () => {
    expect(
      validateAudit({ ...audit(), overall: 10 }, schema, "chats", "ipad-l", [
        file,
      ]).join(),
    ).toContain("additional");
    const a = audit();
    a.categories[0].score = 9.5;
    expect(
      validateAudit(a, schema, "chats", "ipad-l", [file]).length,
    ).toBeGreaterThan(0);
    a.categories[0].score = 10;
    a.categories[1].id = "typography";
    expect(
      validateAudit(a, schema, "chats", "ipad-l", [file]).join(),
    ).toContain("11 unique");
  });
  it("rejects unknown issue and screenshot references and cell mismatches", () => {
    const a = audit(10, [issue()]);
    a.categories[0].blocking_issue_ids = ["missing"];
    a.issues.push(issue());
    expect(validateAudit(a, schema, "other", "phone", []).join()).toMatch(
      /Duplicate issue IDs/,
    );
    expect(validateAudit(a, schema, "other", "phone", []).join()).toMatch(
      /unknown issue/,
    );
    expect(validateAudit(a, schema, "other", "phone", []).join()).toMatch(
      /Unknown screen screenshot/,
    );
  });
  it("rejects unsupported perfect scores without evidence and non-primary criteria", () => {
    const a = audit();
    a.categories[0].screenshots = [];
    a.device = "phone";
    a.page_specific = [{ id: "C1", score: 10, evidence: "Observed rows" }];
    expect(validateAudit(a, schema, "chats", "phone", [file]).join()).toContain(
      "evidence",
    );
    expect(validateAudit(a, schema, "chats", "phone", [file]).join()).toContain(
      "only on ipad-l",
    );
  });
  it("requires issue references below 10", () =>
    expect(
      validateAudit(audit(9), schema, "chats", "ipad-l", [file]).join(),
    ).toContain("requires blocking issues"));
});
describe("interval agreement", () => {
  it("returns one for perfect agreement", () =>
    expect(
      krippendorffAlpha([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toBe(1));
  it("matches a hand-computed two-rater example", () => {
    // Do=1/3; De=17/15; alpha=12/17.
    expect(
      krippendorffAlpha([
        [1, 1],
        [2, 2],
        [3, 2],
      ]),
    ).toBeCloseTo(12 / 17);
  });
  it("omits missing pairs and handles no variance", () => {
    expect(
      krippendorffAlpha([
        [1, null],
        [null, 2],
      ]),
    ).toBe(null);
    expect(
      krippendorffAlpha([
        [3, 3],
        [3, 3],
      ]),
    ).toBe(1);
  });
});
describe("neutral flows and scorecards", () => {
  it.each([
    "round",
    "Before",
    "after",
    "fix",
    "improved",
    "changed",
    "previous",
    "revised",
    "new version",
  ])("rejects blinding leak %s", (word) =>
    expect(() => lintFlow(`A view ${word}.`)).toThrow(),
  );
  it("permits neutral state descriptions", () =>
    expect(() =>
      lintFlow("chats-phone-default.png: The conversation list is displayed."),
    ).not.toThrow());
  it("formats threshold boundaries with one decimal", () => {
    expect(formatScore(9)).toBe("9.0");
    expect(formatScore(8)).toBe("**8.0**");
    expect(formatScore(7.99)).toBe("**8.0 †**");
    expect(formatScore(undefined)).toBe("");
  });
  it("keeps fixed category order and empty B columns", () => {
    const r = scorecardRows([aggregate([audit(7)], true), undefined]);
    expect(r.split("\n")[0]).toBe("| Typography | **7.0 †** |  |");
    expect(r.split("\n")[10]).toContain("States & safety");
    expect(r.split("\n")[11]).toContain("**Overall**");
  });
});
