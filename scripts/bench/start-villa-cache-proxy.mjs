import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { requireLocalBackend } from "../local-integration-config.mjs";

const publicReads = new Set([
  "catalog/publicProperties:getBySlug",
  "catalog/publicProperties:list",
  "catalog/publicProperties:listSlugs",
  "catalog/publicProperties:featuredReviews",
]);
const modes = new Set(["healthy", "timeout"]);

/** Local study bridge for SSR's anonymous reads. The real test owner writes directly to Convex.
 * @param {string} upstream
 */
export async function startVillaCacheProxy(upstream) {
  const backend = new URL(requireLocalBackend(upstream));
  if (!backend.port || backend.pathname !== "/" || backend.username || backend.password ||
      backend.search || backend.hash) throw new Error("Expected a fresh loopback Convex origin");
  const secret = randomBytes(32).toString("base64url");
  const controlPath = "/study/" + randomUUID();
  let mode = "healthy";
  let detailReads = 0;
  let timedOutReads = 0;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handle(req, res) {
    if (req.method !== "POST" || (req.url !== "/api/query" && req.url !== controlPath)) {
      return res.writeHead(404).end();
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16_384) return res.writeHead(413).end();
    }
    const payload = JSON.parse(body);
    if (req.url === controlPath) {
      if (payload.mode !== undefined) {
        if (!modes.has(payload.mode)) return res.writeHead(400).end();
        mode = payload.mode;
      }
      return res.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ mode, detailReads, timedOutReads }));
    }
    if (!publicReads.has(payload.path) || req.headers.authorization) return res.writeHead(403).end();
    if (payload.path === "catalog/publicProperties:getBySlug") {
      detailReads += 1;
      if (mode === "timeout") {
        timedOutReads += 1;
        await delay(4_000);
        return res.writeHead(503).end();
      }
    }
    const response = await fetch(new URL("/api/query", backend), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(4_000),
    });
    const value = await response.text();
    return res.writeHead(response.status, { "Content-Type": "application/json" }).end(value);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject).listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const listener = server.address();
  if (!listener || typeof listener === "string") throw new Error("Expected a TCP listener");
  const proxyUrl = `http://127.0.0.1:${listener.port}`;
  return {
    proxyUrl, controlUrl: proxyUrl + controlPath, secret,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}
