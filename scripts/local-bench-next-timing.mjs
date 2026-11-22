import { Server } from "node:http";

const roomDocument = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?rooms\/[^/?]+\/?(?:\?|$)/;

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export function measureRoomDocument(req, res) {
  if (req.method !== "GET" || !roomDocument.test(req.url ?? "") ||
      req.headers.rsc || req.headers["next-router-prefetch"] ||
      (req.headers["sec-fetch-dest"] && req.headers["sec-fetch-dest"] !== "document")) return;

  const start = performance.now();
  const writeHead = res.writeHead;
  res.writeHead = function (status, ...args) {
    // Node also calls writeHead for implicit headers (end, write, flushHeaders).
    // Restore it before delegation so there is exactly one timing record.
    this.writeHead = writeHead;
    const index = typeof args[0] === "string" ? 1 : 0;
    const headers = args[index];
    /** @param {string} name */
    function readHeader(name) {
      if (Array.isArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) {
          if (String(headers[i]).toLowerCase() === name) return headers[i + 1];
        }
      } else if (headers && typeof headers === "object") {
        const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
        if (match) return match[1];
      }
      return res.getHeader(name);
    }

    if (/^text\/html\b/i.test(String(readHeader("content-type") ?? ""))) {
      const headersMs = performance.now() - start;
      const existing = readHeader("server-timing");
      const metric = `ssr;dur=${headersMs.toFixed(3)}`;
      const timing = existing ? `${existing}, ${metric}` : metric;
      if (Array.isArray(headers)) {
        const next = [];
        for (let i = 0; i < headers.length; i += 2) {
          if (String(headers[i]).toLowerCase() !== "server-timing") next.push(headers[i], headers[i + 1]);
        }
        args[index] = [...next, "Server-Timing", timing];
      } else if (headers && typeof headers === "object") {
        const next = Object.fromEntries(Object.entries(headers)
          .filter(([name]) => name.toLowerCase() !== "server-timing"));
        args[index] = { ...next, "Server-Timing": timing };
      } else {
        this.setHeader("Server-Timing", timing);
      }
      this.once("finish", () => {
        console.log("BENCH_ROOM_HTTP", JSON.stringify({
          status,
          headersMs,
          finishMs: performance.now() - start,
        }));
      });
    }
    return Reflect.apply(writeHead, this, [status, ...args]);
  };
}

// Preloaded only by the Next or Start server in the isolated benchmark profile. Prepending the
// listener keeps the ordinary server and socket intact, with no proxy hop.
const port = Number(process.env.BENCH_START_PORT ?? process.env.BENCH_NEXT_PORT);
if (process.env.BENCH_LOCAL_SSR === "1" && Number.isInteger(port) && port > 0 &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.NEXT_PUBLIC_CONVEX_URL ?? "")) {
  const listen = Server.prototype.listen;
  Server.prototype.listen = function (...args) {
    this.prependListener("request", (req, res) => {
      if (req.socket.localPort === port &&
          ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
        measureRoomDocument(req, res);
      }
    });
    return Reflect.apply(listen, this, args);
  };
}
