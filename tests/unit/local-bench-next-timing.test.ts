import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { measureRoomDocument } from "../../scripts/local-bench-next-timing.mjs";

it("reports native document headers and streamed response finish separately", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const server = createServer((req, res) => {
    measureRoomDocument(req, res);
    if (req.url === "/th/rooms/pool-villa?tour=1") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Server-Timing", "other;dur=1");
      res.write("first");
      void delay(30).then(() => res.end("second"));
    } else if (req.url === "/rooms/rsc") {
      res.writeHead(200, { "Content-Type": "text/x-component" }).end("flight");
    } else {
      res.writeHead(200, "OK", { "Content-Type": "text/html", "Server-Timing": "other;dur=1" }).end("html");
    }
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + "/th/rooms/pool-villa?tour=1");
    const timing = response.headers.get("Server-Timing");
    expect(timing).toMatch(/^other;dur=1, ssr;dur=\d+\.\d{3}$/);
    expect(await response.text()).toBe("firstsecond");
    const [prefix, raw] = log.mock.calls[0];
    expect(prefix).toBe("BENCH_ROOM_HTTP");
    const span = JSON.parse(String(raw));
    expect(span.status).toBe(200);
    expect(span.headersMs.toFixed(3)).toBe(timing?.split("ssr;dur=")[1]);
    expect(span.finishMs - span.headersMs).toBeGreaterThan(10);

    const explicit = await fetch(base + "/rooms/garden-villa");
    expect(explicit.headers.get("server-timing")).toMatch(/^other;dur=1, ssr;dur=\d+\.\d{3}$/);
    await explicit.text();
    for (const [pathname, headers] of [
      ["/rooms/rsc", {}],
      ["/rooms/garden-villa", { RSC: "1" }],
      ["/rooms/garden-villa", { "Next-Router-Prefetch": "1" }],
      ["/about", {}],
    ] as const) {
      const other = await fetch(base + pathname, { headers });
      expect(other.headers.get("server-timing") ?? "").not.toContain("ssr");
      await other.text();
    }
    expect(log).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
