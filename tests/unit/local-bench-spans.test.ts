import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startBenchSpans } from "../../scripts/local-bench-spans.mjs";

it("exports only allowlisted timings from the current run and records windows with no calls", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "tour-bench-spans-"));
  const out = path.join(work, "spans.json");
  const nextLog = path.join(work, "next.log");
  const cold = {
    kind: "Completion",
    udfType: "Query",
    identifier: "catalog/publicProperties:getBySlug",
    requestId: "private-request-id",
    executionId: "private-execution-id",
    cachedResult: false,
    executionTime: 0.007,
    userExecutionTime: 0.005,
    usageStats: { databaseReadDocuments: 4, databaseReadBytes: 500, databaseIoReadBytes: 600 },
    returnBytes: 200,
    logLines: ["private-log-line"],
    args: ["private-slug"],
    success: { name: "private-return-value" },
  };
  const entries = [{ ...cold, requestId: "prior-run" }];
  const backend = createServer((req, res) => {
    if (req.url !== "/api/stream_function_logs?cursor=0" || req.headers.authorization !== "Convex private-admin-key") {
      res.writeHead(403).end();
      return;
    }
    res.end(JSON.stringify({ entries }));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));

  let collector: Awaited<ReturnType<typeof startBenchSpans>> | undefined;
  try {
    const address = backend.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const priorSsr = 'BENCH_VILLA_SSR {"cache":"hit","durationMs":1}\n';
    await writeFile(nextLog, priorSsr);
    collector = await startBenchSpans({
      backendUrl: `http://127.0.0.1:${address.port}`,
      adminKey: "private-admin-key",
      out,
      nextLog,
    });
    const { endpoint } = collector;
    const mark = (event: "start" | "finish", runId: string) => fetch(endpoint + "/" + event, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });

    expect((await mark("start", "direct-1")).status).toBe(204);
    expect((await mark("start", "overlap")).status).toBe(409);
    entries.push(
      cold,
      { ...cold, identifier: "catalog/properties:getTourRooms", requestId: "warm", cachedResult: true,
        executionTime: 0.001 },
      { ...cold, identifier: "private:function", requestId: "unrelated" },
      { ...cold, kind: "Progress", requestId: "progress" },
    );
    await writeFile(nextLog, priorSsr +
      'unrelated private-output\nBENCH_VILLA_SSR {"cache":"miss","durationMs":9,"transportMs":8,"slug":"private-slug"}\n');
    const finish = await mark("finish", "direct-1");
    expect(finish.status).toBe(200);
    const run = await finish.json();
    expect(run).toEqual({
      runId: "direct-1",
      ssr: [{ operation: "getVilla", cache: "miss", recovery: null, durationMs: 9, transportMs: 8 }],
      convex: [
        { function: cold.identifier, cached: false, outcome: "success", executionMs: 7,
          handlerMs: 5, databaseReadDocuments: 4, databaseReadBytes: 500, databaseIoReadBytes: 600, returnBytes: 200 },
        { function: "catalog/properties:getTourRooms", cached: true, outcome: "success", executionMs: 1,
          handlerMs: null, databaseReadDocuments: 4, databaseReadBytes: 500, databaseIoReadBytes: 600, returnBytes: 200 },
      ],
    });
    expect((await mark("start", "direct-2")).status).toBe(204);
    const idleRun = await (await mark("finish", "direct-2")).json();
    expect(idleRun).toEqual({ runId: "direct-2", ssr: [], convex: [] });
    const artifact = await readFile(out, "utf8");
    expect(JSON.parse(artifact)).toEqual({ version: 1, runs: [run, idleRun] });
    expect(artifact).not.toMatch(/private|prior-run|progress|unrelated/);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
  } finally {
    await collector?.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(work, { recursive: true, force: true });
  }
});
