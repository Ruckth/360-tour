import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  args,
  errorText,
  json,
  list,
  pool,
  root,
  save,
  str,
} from "./common.ts";
import { DEVICES, SCREENS } from "./config.ts";
import {
  aggregate,
  calibrationModelsMatch,
  CATEGORIES,
  lintFlow,
  flowLine,
  validateAudit,
} from "./scoring.ts";
import type { Audit, Aggregate } from "./scoring.ts";
import type { CaptureRecord, Manifest } from "./types.ts";

const assets = path.dirname(fileURLToPath(import.meta.url));
const BOARD =
  process.env.UI_LOOP_REFERENCE_DIR ??
  "/Users/macbook/Development/360-tour/output/competitor-shots";
const KNOWN = [
  "villa/folio charge",
  "⌘K search",
  "per-fact AI switch and gap list",
  "booking-to-cart prefill",
  "messaging-window state",
  "channel health",
];
export type Anchor = {
  id: string;
  device: string;
  screen: string;
  file: string;
  degradedFile: string;
  flaw: string;
  flawCategory: string;
  agreed: null | { overall: number; categories: Record<string, number> };
};
export type AuditRecord = Aggregate & {
  screen: string;
  device: string;
  auditor: string;
  model_id: string;
  model_ids: string[];
  rubric: string;
  status: "valid";
  checks: Record<string, number>;
  failing_checks: string[];
  calibrated: boolean;
  calibration: string;
  pairwise_vs_best: string;
  reclassifications: string[];
  page_specific: Audit["page_specific"];
  raw_runs: string[];
};
type Job = {
  screen: string;
  device: string;
  captures: CaptureRecord[];
  source: string;
  anchor?: Anchor;
  degraded?: boolean;
  label?: string;
};
type Prepared = {
  dir: string;
  screen: string;
  device: string;
  run: number;
  job: Job;
  model_id?: string;
  validation_attempt?: number;
  output: string;
};
type RunResult = {
  audit?: Audit;
  raw_audit?: unknown;
  model: string;
  errors?: string[];
  reclassifications: string[];
};
async function prepare(job: Job, run: number): Promise<Prepared> {
  const dir = await mkdtemp(path.join(tmpdir(), "uiaudit-"));
  const images: string[] = [];
  try {
    for (const c of job.captures.filter((c) => !c.error))
      for (const file of c.files) {
        const name = `${job.screen}-${job.device}-${c.state}${/-seg\d+\.png$/.exec(file)?.[0] ?? ".png"}`;
        await copyFile(path.join(job.source, file), path.join(dir, name));
        images.push(name);
      }
    if (!images.length)
      throw new Error(`No captures for ${job.screen} ${job.device}`);
    const board = await json<{
      images: {
        role: string;
        verdict: string;
        device: string;
        area: string;
        path: string;
      }[];
    }>(path.join(BOARD, "verdicts.json"));
    const deviceClass = job.device.startsWith("ipad") ? "tablet" : job.device;
    const area = SCREENS.find((s) => s.id === job.screen)?.area ?? "shell";
    const references = board.images
      .filter(
        (i) =>
          i.role === "taste" &&
          i.verdict === "accept" &&
          i.device === deviceClass &&
          existsSync(path.join(BOARD, i.path)),
      )
      .sort(
        (a, b) =>
          (b.area === area ? 2 : b.area === "shell" ? 1 : 0) -
          (a.area === area ? 2 : a.area === "shell" ? 1 : 0),
      )
      .slice(0, 3);
    if (references.length < 2)
      throw new Error(
        `Need at least 2 accepted taste references for ${deviceClass}`,
      );
    for (let i = 0; i < references.length; i++)
      await copyFile(
        path.join(BOARD, references[i].path),
        path.join(dir, `reference-${i + 1}.png`),
      );
    for (const name of ["rubric.md", "schema.json"])
      await copyFile(path.join(assets, name), path.join(dir, name));
    const flow = job.captures
      .filter((c) => !c.error)
      .flatMap((c) =>
        images
          .filter((f) => f.startsWith(`${job.screen}-${job.device}-${c.state}`))
          .map((f) => flowLine(f, c.description)),
      )
      .join("\n");
    lintFlow(flow);
    await writeFile(path.join(dir, "flow.md"), flow + "\n");
    const missing = [
      ...new Set([
        "long",
        "error",
        ...job.captures.flatMap((c) => c.pendingStates),
        ...["empty", "dialog"].filter(
          (s) => !job.captures.some((c) => c.state === s && !c.error),
        ),
      ]),
    ];
    await writeFile(
      path.join(dir, "known-gaps.md"),
      `Known backend feature gaps (never deduct):\n${KNOWN.map((g) => "- " + g).join("\n")}\n\nStates not captured: ${missing.join(", ")}. Record these in not_observed.\n`,
    );
    const prompt = (await readFile(path.join(assets, "prompt.md"), "utf8"))
      .replaceAll("{{screen}}", job.screen)
      .replaceAll("{{device}}", job.device)
      .replaceAll("{{images}}", images.join(", "));
    await writeFile(path.join(dir, "TASK.md"), prompt);
    return {
      dir,
      screen: job.screen,
      device: job.device,
      run,
      job,
      output: path.join(dir, "out.json"),
    };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}
async function codex(
  prepared: Prepared,
  model: string,
): Promise<{ ok: boolean; error: string }> {
  const images = (await readdir(prepared.dir))
    .filter((f) => f.endsWith(".png"))
    .sort();
  const params = [
    "exec",
    "-m",
    model,
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "-c",
    "features.shell_tool=false",
    "-C",
    prepared.dir,
    "--output-schema",
    path.join(prepared.dir, "schema.json"),
    "-o",
    prepared.output,
    ...images.flatMap((f) => ["-i", path.join(prepared.dir, f)]),
    "-",
  ];
  const prompt =
    (await readFile(path.join(prepared.dir, "TASK.md"), "utf8")) +
    "\n\n" +
    (
      await Promise.all(
        ["rubric.md", "flow.md", "known-gaps.md"].map(
          async (name) =>
            name +
            "\n" +
            (await readFile(path.join(prepared.dir, name), "utf8")),
        ),
      )
    ).join("\n\n");
  return new Promise((resolve) => {
    const child = spawn("codex", params, {
      cwd: prepared.dir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let log = "";
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      },
      15 * 60 * 1000,
    );
    child.stdout.on("data", (c) => {
      log = (log + c.toString()).slice(-16000);
    });
    child.stderr.on("data", (c) => {
      log = (log + c.toString()).slice(-16000);
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: errorText(e) });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        error: timedOut ? "Auditor timeout (15 min)" : errorText(log),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}
async function reclassify(a: Audit): Promise<string[]> {
  const logs: string[] = [];
  for (const gap of [...a.feature_gaps]) {
    if (
      /^(unused|none|n\/a|not applicable)$/i.test(gap.pattern.trim()) &&
      /^(unused|none|n\/a|not applicable)$/i.test(gap.missing_backend.trim())
    ) {
      a.feature_gaps = a.feature_gaps.filter((g) => g !== gap);
      logs.push(
        `Discarded feature-gap placeholder '${gap.pattern}'; no missing backend capability was named`,
      );
      continue;
    }
    const normalized = (gap.pattern + " " + gap.missing_backend)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const known = KNOWN.find((k) =>
      normalized.includes(k.toLowerCase().replace(/[^a-z0-9]/g, "")),
    );
    if (known) {
      if (/^(unused|none|n\/a|not applicable)$/i.test(gap.pattern.trim()))
        gap.pattern = known;
      continue;
    }
    const terms =
      gap.missing_backend
        .match(/[A-Za-z][A-Za-z0-9_]{4,}/g)
        ?.filter(
          (t) =>
            ![
              "missing",
              "backend",
              "mutation",
              "query",
              "state",
              "there",
              "available",
              "provide",
              "support",
              "field",
            ].includes(t.toLowerCase()),
        ) ?? [];
    if (!terms.length) continue;
    const found = await new Promise<string>((resolve) => {
      const p = spawn(
        "rg",
        [
          "-n",
          "-i",
          "--glob",
          "*.ts",
          "--glob",
          "!_generated/**",
          "--",
          terms.join("|"),
          "convex",
        ],
        { cwd: process.cwd() },
      );
      let out = "";
      p.stdout.on("data", (c) => {
        out += c.toString();
      });
      p.on("close", () => resolve(out));
      p.on("error", () => resolve(""));
    });
    // Exact named function/field occurrences are evidence; generic word matches are only logged for review.
    const exact = terms
      .filter((t) => /[a-z][A-Z]|_/.test(t))
      .find((t) => new RegExp(`\\b${t}\\b`).test(found));
    if (!exact) {
      if (found)
        logs.push(
          `Needs backend review: ${gap.pattern}; lexical matches found, availability not established`,
        );
      continue;
    }
    const matching = a.issues.filter(
      (i) =>
        i.feature_gap &&
        i.screenshot === gap.screenshot &&
        (i.observation.toLowerCase().includes(exact.toLowerCase()) ||
          i.where.toLowerCase().includes(exact.toLowerCase())),
    );
    if (matching.length) {
      for (const i of matching) i.feature_gap = false;
      a.feature_gaps = a.feature_gaps.filter((g) => g !== gap);
      logs.push(
        `Reclassified ${gap.pattern}: backend symbol ${exact} is present; ${matching.map((i) => i.id).join(", ")}`,
      );
    } else
      logs.push(
        `Backend symbol ${exact} is present for ${gap.pattern}; no matching issue to reclassify; manual review required`,
      );
  }
  return logs;
}
async function readRun(p: Prepared, model: string): Promise<RunResult> {
  try {
    const value = await json<unknown>(p.output),
      schema = await json<Record<string, unknown>>(
        path.join(assets, "schema.json"),
      );
    const errors = validateAudit(
      value,
      schema,
      p.screen,
      p.device,
      (await readdir(p.dir)).filter((f) => f.endsWith(".png")),
    );
    if (errors.length)
      return { model, errors, raw_audit: value, reclassifications: [] };
    const audit = value as Audit,
      raw_audit = structuredClone(value),
      reclassifications = await reclassify(audit);
    return { audit, raw_audit, model, reclassifications };
  } catch (e) {
    return { model, errors: [errorText(e)], reclassifications: [] };
  }
}
async function execute(p: Prepared): Promise<RunResult> {
  const model = "gpt-6.1-sol";
  for (let validation = 0; validation < 2; validation++) {
    const outcome = await codex(p, model);
    if (!outcome.ok)
      return { model, errors: [outcome.error], reclassifications: [] };
    const result = await readRun(p, model);
    if (result.audit) return result;
    if (validation === 1) return result;
    await writeFile(
      path.join(p.dir, "TASK.md"),
      (await readFile(path.join(p.dir, "TASK.md"), "utf8")) +
        "\nValidation errors to correct in your JSON: " +
        result.errors?.join("; "),
    );
    await rm(p.output, { force: true });
  }
  throw new Error("Unreachable validation loop");
}
function checkSummary(job: Job) {
  const failed = new Set<string>(),
    values: Record<string, number> = {};
  for (const c of job.captures) {
    if (c.error || !c.checks?.length) failed.add("capture");
    for (const check of c.checks ?? []) {
      if (!check.pass) failed.add(check.id);
      values[check.id] = Math.max(
        values[check.id] ?? 0,
        check.id === "cls" && typeof check.value === "number"
          ? check.value
          : check.total,
      );
    }
  }
  if (!job.captures.some((c) => c.state === "default" && !c.error))
    failed.add("default_missing");
  return { green: failed.size === 0, failed: [...failed], values };
}
async function record(
  job: Job,
  auditor: string,
  dir: string,
  results: RunResult[],
  rawFiles: string[],
  calibration = "not-run",
): Promise<AuditRecord | null> {
  const valid = results.filter(
      (r): r is RunResult & { audit: Audit } => !!r.audit,
    ),
    name = job.label ?? `${job.screen}-${job.device}`;
  if (valid.length !== results.length) {
    await save(path.join(dir, name + ".json"), {
      screen: job.screen,
      device: job.device,
      auditor,
      status: "invalid",
      runs: results.length,
      errors: results.flatMap((r) => r.errors ?? []),
      model_ids: results.map((r) => r.model),
      raw_runs: rawFiles,
    });
    return null;
  }
  const summary = checkSummary(job),
    agg = aggregate(
      valid.map((r) => r.audit),
      summary.green,
    );
  const result: AuditRecord = {
    ...agg,
    screen: job.screen,
    device: job.device,
    auditor,
    status: "valid",
    model_id: [...new Set(results.map((r) => r.model))].join(", "),
    model_ids: results.map((r) => r.model),
    rubric: "v1",
    checks: summary.values,
    failing_checks: summary.failed,
    calibrated:
      calibration === "pass" &&
      !results.some((r) => r.model.includes("unspecified")),
    calibration,
    pairwise_vs_best: "not-run",
    reclassifications: results.flatMap((r) => r.reclassifications),
    page_specific: valid[0].audit.page_specific.map((c) => ({
      ...c,
      score:
        valid.reduce(
          (sum, r) =>
            sum +
            (r.audit.page_specific.find((x) => x.id === c.id)?.score ??
              c.score),
          0,
        ) / valid.length,
    })),
    raw_runs: rawFiles,
  };
  await save(path.join(dir, name + ".json"), result);
  return result;
}
async function jobs(
  section: string,
  round: string,
  screens: string[],
  devices: string[],
): Promise<Job[]> {
  const source = root(section, round),
    manifest = await json<Manifest>(path.join(source, "manifest.json"));
  return SCREENS.filter(
    (s) => s.section === section && (!screens.length || screens.includes(s.id)),
  )
    .flatMap((s) =>
      DEVICES.filter(
        (d) => d.judged && (!devices.length || devices.includes(d.id)),
      ).map((d) => ({
        screen: s.id,
        device: d.id,
        captures: manifest.captures.filter(
          (c) => c.screen === s.id && c.device === d.id,
        ),
        source,
      })),
    )
    .filter((j) => j.captures.some((c) => c.files.length && !c.error));
}
async function calibrationJobs(devices: string[]): Promise<Job[]> {
  const source = path.resolve("output/ui-loop/anchors"),
    anchors = await json<Anchor[]>(path.join(source, "anchors.json"));
  return DEVICES.filter(
    (d) => d.judged && (!devices.length || devices.includes(d.id)),
  ).flatMap((d) => {
    const a = anchors.find((a) => a.device === d.id);
    if (!a) return [];
    return [false, true].map((degraded) => ({
      screen: a.screen,
      device: a.device,
      anchor: a,
      degraded,
      label: `calibration-${a.device}-${degraded ? "probe" : "clean"}`,
      source,
      captures: [
        {
          screen: a.screen,
          section: "anchors",
          device: a.device,
          state: "default",
          files: [degraded ? a.degradedFile : a.file],
          description:
            "The main view is displayed by opening its navigation route.",
          pendingStates: ["long", "error", "empty", "dialog"],
          blocked: [],
          websocketUrls: [],
          guard: true,
        },
      ],
    }));
  });
}
export async function auditCLI() {
  const { values: v, positionals } = args({ "model-id": "string", diagnostic: "boolean" });
  const section = str(v.section, "1-daily"),
    round = str(v.round, "0"),
    auditor = str(v.auditor, "A");
  if (!["A", "B"].includes(auditor)) throw new Error("Auditor must be A or B");
  const out = path.join(root(section, round), `audit-${auditor}`);
  await mkdir(out, { recursive: true });
  const ingest = positionals[0] === "ingest";
  const preparedFile = path.join(out, "prepared.json");
  let pending: Prepared[] = [];
  const runs = Number(v.runs ?? 1);
  if (![1, 3].includes(runs)) throw new Error("--runs must be 1 or 3");
  const selected = ingest
    ? []
    : await jobs(section, round, list(v.screens), list(v.devices));
  if (!ingest && !selected.length)
    throw new Error("No captured screen/device matches");
  if (!ingest && !v.diagnostic) {
    const failed = selected.filter((job) => !checkSummary(job).green);
    if (failed.length)
      throw new Error(`Deterministic checks block audit: ${failed.map((job) => `${job.screen}/${job.device}`).join(", ")}. Use --diagnostic only for non-gating baseline analysis.`);
  }
  if (v.calibrate) selected.push(...(await calibrationJobs(list(v.devices))));
  if (ingest) pending = await json<Prepared[]>(preparedFile);
  else if (v["prepare-only"]) {
    for (const job of selected)
      for (let run = 1; run <= runs; run++) {
        const p = await prepare(job, run);
        pending.push(p);
        console.log(p.dir);
      }
    await save(preparedFile, pending);
    return;
  }
  const groups = ingest
    ? [
        ...new Map(
          pending.map((p) => [p.job.label ?? `${p.screen}-${p.device}`, p.job]),
        ).values(),
      ]
    : selected;
  await pool(groups, Number(v.concurrency ?? 4), async (job) => {
    const results: RunResult[] = [],
      rawFiles: string[] = [];
    let retryRequested = false;
    const prepared: Prepared[] = [];
    const name = job.label ?? `${job.screen}-${job.device}`;
    try {
      let target = ingest
        ? pending.filter(
            (p) => (p.job.label ?? `${p.screen}-${p.device}`) === name,
          ).length
        : runs;
      for (let run = 1; run <= target; run++) {
        const p = ingest
          ? pending.find(
              (p) =>
                (p.job.label ?? `${p.screen}-${p.device}`) === name &&
                p.run === run,
            )!
          : await prepare(job, run);
        prepared.push(p);
        const cachedFile = path.join(out, `${name}-run${run}.json`);
        const cached =
          ingest && !existsSync(p.dir) && existsSync(cachedFile)
            ? await json<{
                audit: Audit | null;
                processed_audit?: Audit | null;
                model_id: string;
                errors: string[];
                reclassifications: string[];
              }>(cachedFile)
            : null;
        const result: RunResult = cached
          ? {
              audit: cached.processed_audit ?? cached.audit ?? undefined,
              raw_audit: cached.audit,
              model: cached.model_id,
              errors: cached.errors,
              reclassifications: cached.reclassifications,
            }
          : ingest
            ? await readRun(
                p,
                str(v["model-id"]) || p.model_id || "external-B-unspecified",
              )
            : await execute(p);
        results.push(result);
        const file = `${name}-run${run}.json`;
        rawFiles.push(file);
        await save(path.join(out, file), {
          model_id: result.model,
          status: result.audit ? "valid" : "invalid",
          audit: result.raw_audit ?? result.audit ?? null,
          processed_audit: result.audit ?? null,
          errors: result.errors ?? [],
          reclassifications: result.reclassifications,
        });
        if (ingest && !result.audit && (p.validation_attempt ?? 0) < 1) {
          const retry = await prepare(job, run);
          retry.validation_attempt = 1;
          retry.model_id = result.model;
          await writeFile(
            path.join(retry.dir, "TASK.md"),
            (await readFile(path.join(retry.dir, "TASK.md"), "utf8")) +
              "\nCorrect these schema/evidence validation errors: " +
              result.errors?.join("; "),
          );
          pending[pending.indexOf(p)] = retry;
          retryRequested = true;
          await copyFile(
            path.join(out, file),
            path.join(out, `${name}-run${run}-invalid-attempt.json`),
          );
          await save(preparedFile, pending);
          await rm(p.dir, { recursive: true, force: true });
          console.log(`Validation retry required: ${retry.dir}`);
        }
        if (
          run === 3 &&
          results.every((r) => r.audit) &&
          aggregate(
            results.map((r) => r.audit!),
            checkSummary(job).green,
          ).needs_more_runs
        ) {
          if (ingest && target === 3) {
            const extras = await Promise.all(
              [4, 5].map((n) => prepare(job, n)),
            );
            pending.push(...extras);
            await save(preparedFile, pending);
            for (const p of extras)
              console.log(`Stability run required: ${p.dir}`);
            break;
          }
          target = 5;
        }
      }
      const r = await record(job, auditor, out, results, rawFiles);
      if (retryRequested)
        await save(path.join(out, name + ".json"), {
          screen: job.screen,
          device: job.device,
          auditor,
          status: "pending-validation",
          errors: results.flatMap((r) => r.errors ?? []),
          raw_runs: rawFiles,
        });
      if (!r) process.exitCode = 1;
      if (r?.needs_more_runs && ingest)
        console.error(
          `Unstable ${name}: complete prepared extra runs and ingest again`,
        );
      console.log(`Audited ${name}: ${r?.overall.toFixed(2) ?? "invalid"}`);
    } catch (e) {
      await save(path.join(out, name + ".json"), {
        screen: job.screen,
        device: job.device,
        auditor,
        status: "invalid",
        error: errorText(e),
      });
      console.error(`Audit failed: ${name}: ${errorText(e)}`);
      process.exitCode = 1;
    } finally {
      if (
        !ingest ||
        (!pending.some(
          (p) =>
            (p.job.label ?? `${p.screen}-${p.device}`) === name &&
            p.run > results.length,
        ) &&
          results.every((r) => r.audit))
      )
        for (const p of prepared)
          await rm(p.dir, { recursive: true, force: true });
    }
  });
  if (ingest) await save(preparedFile, pending);
  if (v.calibrate || ingest) {
    const calibration: Record<string, unknown> = {};
    const anchors = existsSync("output/ui-loop/anchors/anchors.json")
      ? await json<Anchor[]>("output/ui-loop/anchors/anchors.json")
      : [];
    for (const d of DEVICES.filter((d) => d.judged)) {
      const cleanFile = path.join(out, `calibration-${d.id}-clean.json`),
        probeFile = path.join(out, `calibration-${d.id}-probe.json`);
      if (!existsSync(cleanFile) || !existsSync(probeFile)) continue;
      const clean = await json<AuditRecord>(cleanFile),
        probe = await json<AuditRecord>(probeFile),
        anchor = anchors.find((a) => a.device === d.id);
      if (!anchor || clean.status !== "valid" || probe.status !== "valid") {
        calibration[d.id] = { status: "invalid" };
        continue;
      }
      const category = anchor.flawCategory as (typeof CATEGORIES)[number],
        sensitivity =
          clean.category_means[category] - probe.category_means[category] >=
            1 &&
          probe.issues.some((i) => i.category === category && !i.feature_gap);
      calibration[d.id] = {
        status: anchor.agreed
          ? Math.abs(clean.overall - anchor.agreed.overall) <= 0.5 &&
            sensitivity && calibrationModelsMatch(clean.model_ids, probe.model_ids)
            ? "pass"
            : "fail"
          : "pending-agreement",
        clean: clean.overall,
        degraded: probe.overall,
        sensitivity,
        model_ids: [...new Set([...clean.model_ids, ...probe.model_ids])],
        flaw: anchor.flaw,
      };
    }
    await save(path.join(out, "calibration.json"), calibration);
    for (const f of await readdir(out)) {
      if (
        !f.endsWith(".json") ||
        f.includes("-run") ||
        f.startsWith("calibration") ||
        f === "prepared.json"
      )
        continue;
      const record = await json<AuditRecord>(path.join(out, f));
      if (record.status !== "valid") continue;
      const status =
        (calibration[record.device] as { status: string } | undefined)
          ?.status ?? "not-run";
      const models = (calibration[record.device] as { model_ids?: string[] } | undefined)?.model_ids ?? [];
      record.calibration = status === "pass" && !calibrationModelsMatch(record.model_ids, models)
        ? "model-mismatch"
        : status;
      record.calibrated = record.calibration === "pass";
      await save(path.join(out, f), record);
    }
  }
}
if (import.meta.main) await auditCLI();
