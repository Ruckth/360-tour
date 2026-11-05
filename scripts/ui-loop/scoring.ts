export const CATEGORIES = [
  "typography",
  "hierarchy",
  "spacing_density",
  "color_contrast",
  "iconography",
  "consistency_polish",
  "clarity",
  "layout_responsive",
  "navigation",
  "status_glance",
  "states_safety",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const LABELS = [
  "Typography",
  "Hierarchy",
  "Spacing & density",
  "Color & contrast",
  "Iconography",
  "Consistency & polish",
  "Clarity",
  "Layout & responsiveness",
  "Navigation",
  "Status at a glance",
  "States & safety",
];
export type Issue = {
  id: string;
  category: Category;
  severity: number;
  screenshot: string;
  where: string;
  observation: string;
  fix: string;
  feature_gap: boolean;
};
export type CategoryScore = {
  id: Category;
  score: number;
  evidence: string;
  screenshots: string[];
  blocking_issue_ids: string[];
};
export type Audit = {
  schema_version: "ui-score/1";
  screen: string;
  device: string;
  observed_states: string[];
  issues: Issue[];
  categories: CategoryScore[];
  page_specific: { id: string; score: number; evidence: string }[];
  feature_gaps: {
    pattern: string;
    missing_backend: string;
    screenshot: string;
  }[];
  not_observed: string[];
};
export type Clamp = {
  run: number;
  category: Category;
  from: number;
  to: number;
};
export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[Math.floor(s.length / 2)]
    : mean(s.slice(s.length / 2 - 1, s.length / 2 + 1));
};
export function severityCap(issues: Issue[]) {
  const open = issues.filter((i) => !i.feature_gap),
    count = (n: number) => open.filter((i) => i.severity === n).length;
  if (count(4) || count(3) >= 2) return 4;
  if (count(3)) return 6;
  if (count(2) >= 2) return 7;
  if (count(2) || count(1) >= 3) return 8;
  if (count(1)) return 9;
  return 10;
}
export function lintFlow(text: string) {
  const match = text.match(
    /round|before|after|fix|improv|changed|previous|revised|new\s+version/i,
  );
  if (match) throw new Error(`Blinding violation in flow.md: ${match[0]}`);
}
export function flowLine(file: string, description: string) {
  const segment = /-seg(\d+)\.png$/.exec(file)?.[1];
  return `${file}: ${description}${segment ? ` The content region is scrolled to viewport segment ${segment}.` : ""}`;
}
/** A small strict JSON-schema validator for the schema subset used by rubric v1. */
export function validateSchema(
  value: unknown,
  schema: Record<string, unknown>,
  document = schema,
  at = "$",
): string[] {
  if (schema.$ref) {
    const ref = String(schema.$ref);
    let target: unknown = document;
    for (const part of ref.replace(/^#\//, "").split("/"))
      target = (target as Record<string, unknown>)[part];
    return validateSchema(
      value,
      target as Record<string, unknown>,
      document,
      at,
    );
  }
  const errors: string[] = [];
  if (schema.enum && !(schema.enum as unknown[]).includes(value))
    errors.push(`${at}: invalid enum value`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return [`${at}: expected object`];
    const obj = value as Record<string, unknown>,
      props = schema.properties as Record<string, Record<string, unknown>>;
    for (const key of (schema.required as string[]) ?? [])
      if (!(key in obj)) errors.push(`${at}.${key}: required`);
    for (const [key, v] of Object.entries(obj)) {
      if (!props?.[key]) {
        if (schema.additionalProperties === false)
          errors.push(`${at}.${key}: additional property`);
      } else
        errors.push(...validateSchema(v, props[key], document, `${at}.${key}`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) errors.push(`${at}: expected array`);
    else
      value.forEach((v, i) =>
        errors.push(
          ...validateSchema(
            v,
            schema.items as Record<string, unknown>,
            document,
            `${at}[${i}]`,
          ),
        ),
      );
  } else if (schema.type === "integer" && !Number.isInteger(value))
    errors.push(`${at}: expected integer`);
  else if (schema.type === "string" && typeof value !== "string")
    errors.push(`${at}: expected string`);
  else if (schema.type === "boolean" && typeof value !== "boolean")
    errors.push(`${at}: expected boolean`);
  return errors;
}
export function validateAudit(
  value: unknown,
  schema: Record<string, unknown>,
  screen: string,
  device: string,
  files: string[],
): string[] {
  const errors = validateSchema(value, schema);
  if (errors.length) return errors;
  const a = value as Audit;
  if (!a.observed_states.length)
    errors.push("At least one observed state required");
  for (const state of a.observed_states)
    if (
      !files.some(
        (f) =>
          f.startsWith(`${screen}-${device}-${state}.`) ||
          f.startsWith(`${screen}-${device}-${state}-seg`),
      )
    )
      errors.push(`State ${state} has no screen capture`);
  if (a.screen !== screen || a.device !== device)
    errors.push("Screen/device mismatch");
  if (
    a.categories.length !== 11 ||
    a.categories.some((c, i) => c.id !== CATEGORIES[i])
  )
    errors.push("Exactly 11 unique categories in rubric order required");
  const ids = a.issues.map((i) => i.id);
  if (new Set(ids).size !== ids.length) errors.push("Duplicate issue IDs");
  for (const c of a.categories) {
    if (!c.evidence.trim() || !c.screenshots.length)
      errors.push(`${c.id}: evidence and screenshot required`);
    for (const id of c.blocking_issue_ids)
      if (!ids.includes(id)) errors.push(`${c.id}: unknown issue ${id}`);
    if (c.score < 10 && !c.blocking_issue_ids.length)
      errors.push(`${c.id}: score below 10 requires blocking issues`);
    for (const id of c.blocking_issue_ids)
      if (a.issues.find((i) => i.id === id)?.category !== c.id)
        errors.push(`${c.id}: issue has a different primary category`);
  }
  const names = [
    ...a.issues.map((i) => i.screenshot),
    ...a.categories.flatMap((c) => c.screenshots),
    ...a.feature_gaps.map((g) => g.screenshot),
  ];
  for (const name of names)
    if (!files.includes(name) || name.startsWith("reference-"))
      errors.push(`Unknown screen screenshot: ${name}`);
  if (device !== "ipad-l" && a.page_specific.length)
    errors.push("Page-specific criteria only on ipad-l");
  return errors;
}
export const issueKey = (i: Issue) =>
  `${i.category}|${i.screenshot.replace(/-seg\d+(?=\.png)/, "")}|${i.where
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()}`;
export function aggregate(runs: Audit[], checksGreen: boolean) {
  if (!runs.length) throw new Error("Cannot aggregate zero runs");
  const clamps: Clamp[] = [];
  const scores = runs.map((run, r) =>
    run.categories.map((c) => {
      const score = Math.min(
        c.score,
        severityCap(run.issues.filter((i) => i.category === c.id)),
      );
      if (score !== c.score)
        clamps.push({ run: r + 1, category: c.id, from: c.score, to: score });
      return score;
    }),
  );
  const overalls = scores.map(mean),
    spread = range(overalls),
    categoryRanges = CATEGORIES.map((_, i) => range(scores.map((s) => s[i]))),
    unstable =
      runs.length >= 3 && (spread > 0.6 || categoryRanges.some((r) => r > 2));
  const method = runs.length >= 5 && unstable ? "median" : "mean";
  const category_means = Object.fromEntries(
    CATEGORIES.map((id, i) => [
      id,
      (method === "median" ? median : mean)(scores.map((s) => s[i])),
    ]),
  ) as Record<Category, number>;
  const counts = new Map<string, { issue: Issue; runs: Set<number> }>();
  runs.forEach((run, r) => {
    for (const issue of run.issues) {
      const key = issueKey(issue);
      const found = counts.get(key) ?? { issue, runs: new Set<number>() };
      found.runs.add(r);
      if (issue.severity > found.issue.severity) found.issue = issue;
      counts.set(key, found);
    }
  });
  const issues = [...counts.values()].map(({ issue, runs: seen }) => ({
    ...issue,
    occurrences: seen.size,
    confirmed:
      runs.length === 1 || seen.size >= Math.floor(runs.length / 2) + 1,
  }));
  const majors = issues.filter(
    (i) => i.confirmed && !i.feature_gap && i.severity >= 3,
  ).length;
  const overall = mean(Object.values(category_means));
  return {
    runs: runs.length,
    category_means,
    overall,
    clamps: clamps.length,
    clamp_log: clamps,
    run_spread: spread,
    category_ranges: Object.fromEntries(
      CATEGORIES.map((c, i) => [c, categoryRanges[i]]),
    ),
    unstable,
    needs_more_runs: unstable && runs.length === 3,
    method,
    halo_flags: scores.map((s, i) => ({
      run: i + 1,
      flag: Math.sqrt(mean(s.map((v) => (v - mean(s)) ** 2))) < 0.3,
    })),
    issues,
    open_majors: majors,
    feature_gaps: runs.flatMap((r) => r.feature_gaps),
    not_observed: [...new Set(runs.flatMap((r) => r.not_observed))],
    gate: {
      overall: overall >= 9,
      floor: Object.values(category_means).every((v) => v >= 8),
      majors: majors === 0,
      checks: checksGreen,
    },
  };
}
export type Aggregate = ReturnType<typeof aggregate>;
export function formatScore(value: number | undefined) {
  if (value === undefined) return "";
  const text = value.toFixed(1);
  return value < 8 ? `**${text} †**` : value < 9 ? `**${text}**` : text;
}
/** Interval alpha using pairable units; missing pairs are excluded, never imputed. */
export function krippendorffAlpha(
  units: (number | null | undefined)[][],
): number | null {
  const paired = units
    .map((u) =>
      u.filter((x): x is number => typeof x === "number" && Number.isFinite(x)),
    )
    .filter((u) => u.length >= 2);
  const values = paired.flat(),
    n = values.length;
  if (n < 2) return null;
  const observed =
    paired.reduce(
      (sum, u) =>
        sum +
        u.reduce((s, a) => s + u.reduce((t, b) => t + (a - b) ** 2, 0), 0) /
          (u.length - 1),
      0,
    ) / n;
  const expected =
    values.reduce(
      (s, a) => s + values.reduce((t, b) => t + (a - b) ** 2, 0),
      0,
    ) /
    (n * (n - 1));
  return expected === 0 ? (observed === 0 ? 1 : null) : 1 - observed / expected;
}
export const SCORE_COLUMNS = [
  "Phone · A",
  "Phone · B",
  "iPad P · A",
  "iPad P · B",
  "★ iPad L · A",
  "★ iPad L · B",
  "Desktop · A",
  "Desktop · B",
];
export function scorecardRows(cells: (Aggregate | undefined)[]) {
  return (
    CATEGORIES.map(
      (c, i) =>
        `| ${LABELS[i]} | ${cells.map((a) => formatScore(a?.category_means[c])).join(" | ")} |`,
    ).join("\n") +
    `\n| **Overall** | ${cells.map((a) => formatScore(a?.overall)).join(" | ")} |`
  );
}


/** Calibration is specific to one identified evaluator, never transferable across models. */
export function calibrationModelsMatch(...groups: string[][]): boolean {
  const model = groups[0]?.[0];
  return !!model && !model.includes("unspecified") && groups.every(
    (group) => group.length > 0 && group.every((id) => id === model),
  );
}
