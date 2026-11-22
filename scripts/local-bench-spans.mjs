import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

/**
 * @typedef {{backendUrl: string, adminKey: string, nextLog: string, out: string}} BenchOptions
 * @typedef {{
 *   kind: string, udfType: string, componentPath?: string, identifier: string,
 *   cachedResult?: boolean, occInfo?: {retryCount?: number} | null, error?: string, executionTime?: number, userExecutionTime?: number,
 *   usageStats?: Record<string, number>, returnBytes?: number, requestId: string, executionId: string
 * }} ConvexLog
 */
const tourQueries = new Set([
  "catalog/publicProperties:getBySlug",
  "catalog/properties:getTourRooms",
]);
const catalogFunctions = new Map([
  ["catalog/publicProperties:featuredReviews", "Query"],
  ["pos/orders:listOpenOrders", "Query"],
  ["messaging/adminChat:listSessions", "Query"],
  ["catalog/adminReviews:update", "Mutation"],
  ["catalog/properties:updateRoom", "Mutation"],
]);
/** @param {unknown} value */
const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
/** @param {unknown} value */
function secondsToMs(value) {
  const seconds = nonnegative(value);
  return seconds === null ? null : seconds * 1000;
}

/** @param {ConvexLog} entry */
function publicConvexSpan(entry, catalog = false) {
  if (entry.kind !== "Completion" || entry.componentPath) return null;
  const expectedType = catalog ? catalogFunctions.get(entry.identifier) : tourQueries.has(entry.identifier) ? "Query" : undefined;
  if (entry.udfType !== expectedType || !expectedType) return null;

  return {
    function: entry.identifier,
    ...(catalog ? {
      databaseWriteBytes: nonnegative(entry.usageStats?.databaseWriteBytes),
      databaseWriteDocuments: nonnegative(entry.usageStats?.databaseWriteDocuments),
      occRetryCount: nonnegative(entry.occInfo?.retryCount) ?? 0,
    } : {}),
    cached: entry.cachedResult === true,
    outcome: entry.error == null ? "success" : "error",
    executionMs: secondsToMs(entry.executionTime),
    handlerMs: entry.cachedResult === true ? null : secondsToMs(entry.userExecutionTime),
    databaseReadDocuments: nonnegative(entry.usageStats?.databaseReadDocuments),
    databaseReadBytes: nonnegative(entry.usageStats?.databaseReadBytes),
    databaseIoReadBytes: nonnegative(entry.usageStats?.databaseIoReadBytes),
    returnBytes: nonnegative(entry.returnBytes),
  };
}

/** @param {string} log @param {string} prefix */
function timingLines(log, prefix) {
  const completeLines = log.split("\n");
  completeLines.pop();
  return completeLines.filter((line) => line.startsWith(prefix)).map((line) => JSON.parse(line.slice(prefix.length)));
}

/** @param {string} log */
function publicSsrSpans(log) {
  return timingLines(log, "BENCH_VILLA_SSR ").flatMap((span) => {
    if (!["hit", "miss", "stale", "bypass"].includes(span.cache) ||
        nonnegative(span.durationMs) === null) return [];
    return [{
      operation: "getVilla",
      cache: span.cache,
      recovery: ["backoff", "read-error"].includes(span.recovery) ? span.recovery : null,
      durationMs: span.durationMs,
      transportMs: nonnegative(span.transportMs),
    }];
  });
}

/** @param {string} log */
function publicHttpSpans(log) {
  return timingLines(log, "BENCH_ROOM_HTTP ").flatMap((span) => {
    const headersMs = nonnegative(span.headersMs);
    const finishMs = nonnegative(span.finishMs);
    if (!Number.isInteger(span.status) || span.status < 200 || span.status >= 600 ||
        headersMs === null || finishMs === null || finishMs < headersMs) return [];
    return [{ operation: "room-document", status: span.status, headersMs, finishMs }];
  });
}

/** @param {BenchOptions} options */
async function checkpoint({ backendUrl, adminKey, nextLog }, catalog = false) {
  // A zero cursor takes a snapshot of the fresh backend's recent log buffer.
  // An incremental cursor long-polls when a full-route cache hit executes no UDFs.
  const response = await fetch(backendUrl + "/api/stream_function_logs?cursor=0", {
    headers: { Authorization: `Convex ${adminKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Could not read local Convex completion logs");
  /** @type {{entries: ConvexLog[]}} */
  const { entries } = await response.json();
  const log = await readFile(nextLog, "utf8");
  const convex = new Map();
  for (const entry of entries) {
    const span = publicConvexSpan(entry, catalog);
    if (span) convex.set(`${entry.requestId}:${entry.executionId}`, span);
  }
  return { convex, ssr: publicSsrSpans(log), http: publicHttpSpans(log) };
}

/** Keep raw Convex logs and credentials inside the harness. The child gets an allowlisted snapshot per run.
 * @param {BenchOptions} options
 */
export async function startBenchSpans(options) {
  /** @typedef {Awaited<ReturnType<typeof checkpoint>>} Checkpoint */
  /** @type {{runId: string, ssr: Checkpoint["ssr"], http: Checkpoint["http"], convex: NonNullable<ReturnType<typeof publicConvexSpan>>[]}[]} */
  const runs = [];
  const artifact = { version: 1, runs };
  await writeFile(options.out, JSON.stringify(artifact) + "\n", { flag: "wx", mode: 0o600 });
  const route = `/${randomUUID()}`;
  /** @type {{runId: string, before: Checkpoint} | undefined} */
  let active;
  let busy = false;
  const server = createServer((req, res) => {
    // JSON and the unguessable path keep browser-originated requests out of the collector.
    if (req.method !== "POST" || req.headers["content-type"] !== "application/json" ||
        ![`${route}/start`, `${route}/finish`].includes(req.url ?? "")) {
      res.writeHead(404).end();
      return;
    }
    if (busy) {
      res.writeHead(409).end();
      return;
    }
    busy = true;
    void handle(req, res).catch(() => {
      res.writeHead(500).end("Could not capture local benchmark spans");
    }).finally(() => {
      busy = false;
    });
  });

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handle(req, res) {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 256) return res.writeHead(413).end();
    }
    let runId;
    try {
      ({ runId } = JSON.parse(body));
    } catch {
      return res.writeHead(400).end();
    }
    if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) {
      return res.writeHead(400).end();
    }
    if (req.url === `${route}/start`) {
      if (active || artifact.runs.some((run) => run.runId === runId)) return res.writeHead(409).end();
      active = { runId, before: await checkpoint(options, runId.startsWith("catalog-")) };
      return res.writeHead(204).end();
    }
    if (!active || active.runId !== runId) return res.writeHead(409).end();
    const { before } = active;
    const after = await checkpoint(options, runId.startsWith("catalog-"));
    const run = {
      runId,
      ssr: after.ssr.slice(before.ssr.length),
      http: after.http.slice(before.http.length),
      convex: Array.from(after.convex)
        .filter(([id]) => !before.convex.has(id))
        .map(([, span]) => span),
    };
    const updated = { ...artifact, runs: [...artifact.runs, run] };
    await writeFile(options.out, JSON.stringify(updated, null, 2) + "\n");
    artifact.runs.push(run);
    active = undefined;
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(run));
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local benchmark collector has no TCP address");
  return {
    endpoint: `http://127.0.0.1:${address.port}${route}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(undefined))),
  };
}
