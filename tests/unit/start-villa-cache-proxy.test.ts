import { createServer } from "node:http";
import { expect, it } from "vitest";
import { startVillaCacheProxy } from "../../scripts/bench/start-villa-cache-proxy.mjs";

it("proxies only anonymous catalog reads and reports sanitized study totals", async () => {
  let queries = 0;
  const backend = createServer((req, res) => {
    queries += 1;
    expect(req.url).toBe("/api/query");
    expect(req.headers.authorization).toBeUndefined();
    res.setHeader("Content-Type", "application/json");
    res.end('{"status":"success","value":null}');
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  let study: Awaited<ReturnType<typeof startVillaCacheProxy>> | undefined;
  try {
    const address = backend.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    study = await startVillaCacheProxy(`http://127.0.0.1:${address.port}`);
    function post(url: string, path: string, authorization?: string) {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authorization && { authorization }) },
        body: JSON.stringify({ path, args: { slug: "private-fixture-tag" } }),
      });
    }
    const upstream = study.proxyUrl + "/api/query";
    expect((await post(upstream, "catalog/adminProperties:get")).status).toBe(403);
    expect((await post(upstream, "catalog/publicProperties:getBySlug", "Bearer fixture")).status).toBe(403);
    expect((await post(study.proxyUrl + "/api/mutation", "catalog/properties:update")).status).toBe(404);
    expect(await (await post(upstream, "catalog/publicProperties:getBySlug")).json())
      .toEqual({ status: "success", value: null });
    expect(queries).toBe(1);
    expect(await (await post(study.controlUrl, "")).json())
      .toEqual({ mode: "healthy", detailReads: 1, timedOutReads: 0 });
  } finally {
    await study?.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  }
});
