import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { args, json, root, str } from "./common.ts";
import { DEVICES, SCREENS, SECTIONS } from "./config.ts";
import {
  CATEGORIES,
  formatScore,
  issueKey,
  krippendorffAlpha,
  SCORE_COLUMNS,
  scorecardRows,
} from "./scoring.ts";
import type { AuditRecord } from "./audit.ts";
import type { CaptureRecord, Manifest } from "./types.ts";
const judged = DEVICES.filter((d) => d.judged);
const safe = (s: unknown) =>
  String(s ?? "")
    .replaceAll("|", "\\|")
    .replace(/\s+/g, " ")
    .trim();
const html = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
async function records(dir: string): Promise<AuditRecord[]> {
  const results: AuditRecord[] = [];
  for (const auditor of ["A", "B"]) {
    const folder = path.join(dir, `audit-${auditor}`);
    if (!existsSync(folder)) continue;
    for (const f of await readdir(folder)) {
      if (
        !f.endsWith(".json") ||
        f.includes("-run") ||
        f.startsWith("calibration") ||
        f === "prepared.json"
      )
        continue;
      const r = await json<AuditRecord>(path.join(folder, f));
      if (r.status === "valid") results.push(r);
    }
  }
  return results;
}
function failures(captures: CaptureRecord[]) {
  return [
    ...new Set(
      captures.flatMap((c) =>
        c.error
          ? ["capture"]
          : (c.checks?.filter((x) => !x.pass).map((x) => x.id) ?? [
              "checks_missing",
            ]),
      ),
    ),
  ];
}
function result(cells: (AuditRecord | undefined)[], captures: CaptureRecord[]) {
  const failed = failures(
    captures.filter((c) => judged.some((d) => d.id === c.device)),
  );
  if (failed.length) return `BLOCKED by checks: ${failed.join(", ")}`;
  if (
    judged.some(
      (d) =>
        !captures.some(
          (c) => c.device === d.id && c.state === "default" && !c.error,
        ),
    )
  )
    return "FAIL: missing default captures";
  const auditors = cells.some((c) => c?.auditor === "B") ? ["A", "B"] : ["A"];
  if (cells.filter(Boolean).length < judged.length * auditors.length)
    return "FAIL: audit coverage incomplete";
  for (const c of cells) {
    if (!c) continue;
    const gates = Object.entries(c.gate)
      .filter(([, pass]) => !pass)
      .map(([key]) => key);
    if (gates.length)
      return `FAIL: ${c.device} · ${c.auditor} (${gates.join(", ")})`;
    if (c.needs_more_runs)
      return `FAIL: unstable ${c.device} · ${c.auditor}, additional runs required`;
    if (!c.calibrated)
      return `FAIL: ${c.device} · ${c.auditor}, calibration ${c.calibration}`;
  }
  if (cells.some((c) => c && c.runs < 3))
    return "FAIL: three runs required for a gate";
  return "PASS → confirm";
}
function rollup(
  screens: typeof SCREENS,
  all: AuditRecord[],
  manifest: Manifest,
) {
  const lines = [
    "| Screen | Phone | iPad P | ★ iPad L | Desktop | Lowest | Status |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const s of screens) {
    const cells = judged.flatMap((d) =>
      ["A", "B"].map((a) =>
        all.find(
          (r) => r.screen === s.id && r.device === d.id && r.auditor === a,
        ),
      ),
    );
    const observed = cells
      .filter((c): c is AuditRecord => !!c)
      .sort((a, b) => a.overall - b.overall);
    const lowest = observed[0];
    const why = lowest
      ? `${lowest.overall.toFixed(1)}: ${lowest.device} · ${lowest.auditor}; floor ${Math.min(...Object.values(lowest.category_means)).toFixed(1)}; ${lowest.open_majors} major`
      : "not audited";
    lines.push(
      `| ${s.title} | ${judged.map((d) => ["A", "B"].map((a) => formatScore(all.find((r) => r.screen === s.id && r.device === d.id && r.auditor === a)?.overall) || "—").join(" / ")).join(" | ")} | ${why} | ${result(
        cells,
        manifest.captures.filter((c) => c.screen === s.id),
      )} |`,
    );
  }
  return lines.join("\n");
}
export async function report(section: string, round: string) {
  const dir = root(section, round),
    manifest = await json<Manifest>(path.join(dir, "manifest.json")),
    all = await records(dir),
    screens = SCREENS.filter((s) => s.section === section);
  const lines = [
    `# ${section} · round ${round} · rubric v1`,
    "",
    "Scores are means of integer judgments; unstable five-run cells use category medians. Differences under 0.3 are noise. No confirmation pass is established by this report.",
    "",
  ];
  const agreement: (number | null)[][] = [];
  for (const s of screens) {
    const cells = judged.flatMap((d) =>
        ["A", "B"].map((a) =>
          all.find(
            (r) => r.screen === s.id && r.device === d.id && r.auditor === a,
          ),
        ),
      ),
      captures = manifest.captures.filter((c) => c.screen === s.id);
    lines.push(
      `## ${s.title}`,
      "",
      `| Category | ${SCORE_COLUMNS.join(" | ")} |`,
      `|---|${SCORE_COLUMNS.map(() => "---").join("|")}|`,
      scorecardRows(cells),
    );
    const row = (label: string, fn: (r: AuditRecord) => string) =>
      `| ${label} | ${cells.map((c) => (c ? fn(c) : "")).join(" | ")} |`;
    lines.push(
      row("Checks (§4)", (r) =>
        r.gate.checks ? "pass" : r.failing_checks.join(", "),
      ),
      row("Open major issues", (r) => String(r.open_majors)),
      row("Run spread (Overall)", (r) => r.run_spread.toFixed(1)),
      "",
      `**Result: ${result(cells, captures)}.**`,
    );
    const primary = cells.filter((c) => c?.device === "ipad-l");
    lines.push(
      `**Page-specific (ipad-l):** ${primary.map((c) => `${c!.auditor}: ${c!.page_specific.map((p) => `${p.id} ${p.score.toFixed(1)}`).join(" · ") || "not observed"}`).join("; ") || "not audited"}.`,
    );
    const gaps = [
      ...new Set(
        cells.flatMap((c) => c?.feature_gaps.map((g) => g.pattern) ?? []),
      ),
    ];
    lines.push(`**Feature gaps:** ${gaps.join("; ") || "none reported"}.`);
    const pending = [
      ...new Set([
        ...s.pendingStates,
        ...cells.flatMap((c) => c?.not_observed ?? []),
      ]),
    ];
    lines.push(`**Not observed:** ${pending.join("; ")}.`, "");
    const merged = new Map<
      string,
      {
        issue: AuditRecord["issues"][number];
        devices: Set<string>;
        auditors: Set<string>;
        weakest: number;
      }
    >();
    for (const c of cells)
      for (const i of c?.issues ?? []) {
        const key = issueKey({
          ...i,
          screenshot: i.screenshot.replace(`-${c!.device}-`, "-device-"),
        });
        const item = merged.get(key) ?? {
          issue: i,
          devices: new Set<string>(),
          auditors: new Set<string>(),
          weakest: c!.overall,
        };
        item.devices.add(c!.device);
        item.auditors.add(c!.auditor);
        item.weakest = Math.min(item.weakest, c!.overall);
        if (i.severity > item.issue.severity) item.issue = i;
        merged.set(key, item);
      }
    for (const { issue: i, devices, auditors } of [...merged.values()]
      .sort(
        (a, b) => b.issue.severity - a.issue.severity || a.weakest - b.weakest,
      )
      .slice(0, 10))
      lines.push(
        `- **${i.id} · ${[...devices].join(", ")} · sev ${i.severity} · ${i.category}** (${[...auditors].join("/")}${i.feature_gap ? "; feature gap" : i.confirmed ? "" : "; unconfirmed"}). ${safe(i.where)} — ${safe(i.observation)} Suggested action: ${safe(i.fix)}`,
      );
    lines.push("");
    for (const d of judged)
      for (const cat of CATEGORIES) {
        const a = all.find(
            (r) => r.screen === s.id && r.device === d.id && r.auditor === "A",
          ),
          b = all.find(
            (r) => r.screen === s.id && r.device === d.id && r.auditor === "B",
          );
        agreement.push([
          a?.category_means[cat] ?? null,
          b?.category_means[cat] ?? null,
        ]);
      }
  }
  lines.push("## Section roll-up", "", rollup(screens, all, manifest), "");
  const alpha = krippendorffAlpha(agreement),
    exemptions = manifest.captures.flatMap((c) =>
      (c.checks ?? []).flatMap((ch) =>
        ch.exempted.map(
          (e) => `${c.screen}/${c.device}/${c.state} ${ch.id}: ${e.detail}`,
        ),
      ),
    ),
    blocked = manifest.captures.reduce((n, c) => n + c.blocked.length, 0);
  lines.push(
    `Auditor agreement α = ${alpha === null ? "not available" : alpha.toFixed(3)}${alpha !== null && alpha < 0.667 ? " (user spot check required for a pass)" : ""} · calibration: ${[...new Set(all.map((r) => `${r.auditor} ${r.device}: ${r.calibration}`))].join("; ") || "not run"} · pairwise: not run · exemptions: ${exemptions.length} · feature gaps: ${new Set(all.flatMap((r) => r.feature_gaps.map((g) => g.pattern))).size} · blocked mutations/actions: ${blocked}.`,
    "",
    "## Deterministic checks",
    "",
  );
  const ids = [
    "axe",
    "contrast",
    "targets",
    "overflow",
    "font_min",
    "input_16",
    "truncation",
    "cls",
    "focus",
  ];
  lines.push(
    `| Screen | Device | States | ${ids.join(" | ")} |`,
    `|---|---|---|${ids.map(() => "---").join("|")}|`,
  );
  for (const s of screens)
    for (const d of DEVICES) {
      const captures = manifest.captures.filter(
        (c) => c.screen === s.id && c.device === d.id,
      );
      if (!captures.length) continue;
      lines.push(
        `| ${s.title} | ${d.id}${d.judged ? "" : " (report-only)"} | ${captures.length} | ${ids
          .map((id) => {
            const checks = captures.flatMap(
              (c) => c.checks?.filter((ch) => ch.id === id) ?? [],
            );
            if (checks.length < captures.length) return "missing";
            const count = checks.reduce((sum, ch) => sum + ch.total, 0);
            return `${checks.every((c) => c.pass) ? "pass" : "FAIL"} (${count}${id === "cls" ? `; max ${Math.max(...checks.map((c) => (typeof c.value === "number" ? c.value : 0))).toFixed(3)}` : ""})`;
          })
          .join(" | ")} |`,
      );
    }
  lines.push("", "## Exemptions", "", ...exemptions.map((e) => "- " + safe(e)));
  if (!exemptions.length) lines.push("None.");
  const failed = manifest.captures.filter((c) => c.error);
  lines.push(
    "",
    "## Capture failures",
    "",
    ...failed.map(
      (c) => `- ${c.screen}/${c.device}/${c.state}: ${safe(c.error)}`,
    ),
  );
  if (!failed.length) lines.push("None.");
  await writeFile(path.join(dir, "report.md"), lines.join("\n") + "\n");
  await timeline(section);
  return rollup(screens, all, manifest);
}
async function timeline(section: string) {
  const base = path.resolve("output/ui-loop", section),
    rounds = (await readdir(base))
      .filter((f) => /^round-\d+$/.test(f))
      .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  const series = new Map<string, { round: number; value: number }[]>();
  for (const r of rounds) {
    const all = await records(path.join(base, r));
    for (const s of SCREENS.filter((s) => s.section === section))
      for (const a of ["A", "B"]) {
        const cells = all.filter((c) => c.screen === s.id && c.auditor === a);
        if (!cells.length) continue;
        const key = `${s.title} · ${a}`,
          data = series.get(key) ?? [];
        data.push({
          round: Number(r.slice(6)),
          value: Math.min(...cells.map((c) => c.overall)),
        });
        series.set(key, data);
      }
  }
  const maxRound = Math.max(1, ...rounds.map((r) => Number(r.slice(6)))),
    x = (r: number) => 65 + (r / maxRound) * 850,
    y = (v: number) => 355 - (v / 10) * 300;
  const colors = [
    "#2563eb",
    "#dc2626",
    "#059669",
    "#9333ea",
    "#ea580c",
    "#0891b2",
    "#be185d",
    "#4f46e5",
    "#4d7c0f",
    "#a16207",
    "#0f766e",
    "#7c3aed",
  ];
  const svg = [
    `<svg viewBox="0 0 1050 ${440 + series.size * 24}" role="img" aria-label="Lowest device Overall per screen and auditor across rounds">`,
  ];
  for (let v = 0; v <= 10; v += 2)
    svg.push(
      `<path d="M65 ${y(v)}H915" stroke="#ddd"/><text x="25" y="${y(v) + 4}">${v}</text>`,
    );
  for (const r of rounds)
    svg.push(
      `<text x="${x(Number(r.slice(6)))}" y="385" text-anchor="middle">${html(r)}</text>`,
    );
  let i = 0;
  for (const [name, points] of series) {
    const color = colors[i % colors.length];
    svg.push(
      `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points.map((p) => `${x(p.round)},${y(p.value)}`).join(" ")}"/>`,
    );
    for (const p of points)
      svg.push(
        `<circle cx="${x(p.round)}" cy="${y(p.value)}" r="5" fill="${color}"><title>${html(name)}: ${p.value.toFixed(2)} · ${p.round}</title></circle>`,
      );
    svg.push(
      `<text x="65" y="${430 + i * 24}" fill="${color}">${html(name)}</text>`,
    );
    i++;
  }
  svg.push("</svg>");
  await writeFile(
    path.join(base, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(section)} UI timeline</title><style>body{font:16px system-ui;margin:32px;color:#172033;background:#fafafa}svg{width:100%;max-width:1100px}text{font:14px system-ui}</style><h1>${html(section)} · lowest device Overall</h1><p>Independent auditor series. Hover a point for its value. Missing audits are omitted.</p>${svg.join("")}`,
  );
}
if (import.meta.main) {
  const { values: v } = args();
  const round = str(v.round, "0");
  if (v.all) {
    const sections: string[] = [];
    for (const section of SECTIONS) {
      if (existsSync(path.join(root(section, round), "manifest.json")))
        sections.push(`## ${section}\n\n${await report(section, round)}`);
    }
    await mkdir("output/ui-loop", { recursive: true });
    await writeFile(
      `output/ui-loop/rollup-round-${round}.md`,
      `# Admin roll-up · round ${round}\n\n${sections.join("\n\n")}\n`,
    );
  } else await report(str(v.section, "1-daily"), round);
}
