import { describe, expect, it } from "vitest";
import {
  MARKER, classifyCache, documentFacts, edgeServed, evaluateGates, factMismatches, linkAlternates, median,
  namespace, naturalHitUncertainty, naturalSchedule, nearestRank, parseCurlOutput, publicPath, rejectReason, roomCacheObservation, roomCandidateFacts, roomPath, roomPreviewCookies, summarize,
  textDiff, vercelRegions,
} from "../../scripts/bench/room-preview-lib.mjs";

const head = `<html lang="en"><head><title>Tideglass Pool Residence — Auralis Cove Retreat</title>
<meta name="description" content="Ocean villa">
<meta property="og:image" content="https://cdn.example.com/img/villa.jpg?token=secret">
<link rel="alternate" hreflang="th" href="https://preview.example.vercel.app/th/rooms/pool-villa?x=1"></head>`;
// Next streams the room inside a hidden boundary behind a visible loading fallback.
const streamed = `${head}<body><div class="min-h-screen">Loading villa...</div>
<div hidden id="S:0"><h1>Tideglass  Pool Residence</h1><p>Sleeps &amp; dreams</p></div>
<script>self.__next_f.push([1,"<h1>not text</h1>"])</script><!-- comment --></body></html>`;
const rendered = `${head}<body><h1>Tideglass Pool Residence</h1><p>Sleeps &amp; dreams</p></body></html>`;

describe("room preview parity helpers", () => {
  it("parses final curl headers and timings and drops interim responses", () => {
    const raw = `HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200\r\nX-Villa-Cache: HIT\r\nx-vercel-id: sin1::iad1::abc-123\r\n\r\n<html></html>${MARKER}200 0.250 0.050 0.400`;
    const parsed = parseCurlOutput(Buffer.from(raw));
    expect(parsed).toMatchObject({ status: 200, ttfbMs: 250, waitMs: 200, totalMs: 400, body: "<html></html>" });
    expect(parsed.headers.get("x-villa-cache")).toBe("HIT");
    const links = parseCurlOutput(Buffer.from(`HTTP/2 200\r\nlink: <https://h/th/r>; rel="alternate"; hreflang="th"\r\nlink: </font.woff2>; rel=preload\r\n\r\n${MARKER}200 0.1 0 0.1`));
    expect(linkAlternates(links.headers.get("link"))).toEqual(["th /th/r"]);
    expect(() => parseCurlOutput(Buffer.from("HTTP/2 200\r\n\r\n"))).toThrow(/marker/);
  });

  it("keeps only region labels from x-vercel-id", () => {
    expect(vercelRegions("sin1::iad1::abcde-1795272143366-0123456789ab")).toEqual({ edge: "sin1", fn: "iad1" });
    expect(vercelRegions("sin1::abcde-123")).toEqual({ edge: "sin1", fn: null });
    expect(vercelRegions(undefined)).toEqual({ edge: null, fn: null });
  });

  it("classifies only the application header and treats edge cache hits as replays", () => {
    expect(classifyCache("HIT")).toBe("hit");
    expect(classifyCache("stale; age=61")).toBe("stale");
    expect(classifyCache("PRERENDER")).toBeNull();
    expect(classifyCache("unconfirmed")).toBe("unconfirmed");
    expect(classifyCache("recovery")).toBe("recovery");
    expect(classifyCache("stale; read-error")).toBe("recovery");
    expect(classifyCache("miss; backoff")).toBe("recovery");
    expect(classifyCache(undefined)).toBeNull();
    expect(edgeServed("HIT")).toBe(true);
    expect(edgeServed("PRERENDER")).toBe(true);
    expect(edgeServed("MISS")).toBe(false);
  });

  it("requires an exact namespace and response witness for a natural-only SSR observation", () => {
    const tag = "nat-control-1";
    const witness = "190af166-2cfd-4aeb-80cb-742d2b96e49f";
    const html = `<span hidden="" data-villa-cache-observation="${witness}:${tag}:stale"></span>`;
    const proof = { html, witness, namespaceEcho: tag, namespace: tag };
    expect(roomCacheObservation(undefined, proof)).toEqual({ cache: "stale", source: "server-document" });
    expect(roomCacheObservation("hit", proof)).toEqual({ cache: "hit", source: "header" });
    expect(roomCacheObservation("invalid", proof)).toEqual({ cache: null, source: null });
    expect(roomCacheObservation(undefined)).toEqual({ cache: null, source: null });
    expect(roomCacheObservation(undefined, { ...proof, namespaceEcho: undefined }).cache).toBeNull();
    expect(roomCacheObservation(undefined, { ...proof, namespace: "different-1" }).cache).toBeNull();
    expect(roomCacheObservation(undefined, { ...proof, witness: "190af166-2cfd-4aeb-80cb-742d2b96e49e" }).cache).toBeNull();
    for (const untrusted of [html + html, `<script>${html}</script>`, `<!-- ${html} -->`]) {
      expect(roomCacheObservation(undefined, { ...proof, html: untrusted }).cache).toBeNull();
    }
  });

  it("compares streamed and fully rendered room documents equally and scrubs URLs", () => {
    const a = documentFacts(streamed, ["Loading villa..."]);
    const b = documentFacts(rendered, ["Loading villa..."]);
    expect(a.h1).toEqual(["Tideglass Pool Residence"]);
    expect(a.lang).toBe("en");
    expect(a.ogImage).toBe("/img/villa.jpg");
    expect(a.alternates).toEqual(["th /th/rooms/pool-villa"]);
    expect(a.texts).not.toContain("not text");
    expect(factMismatches(a, b)).toEqual([]);
    const changed = documentFacts(rendered.replace("dreams", "naps"), []);
    expect(factMismatches(changed, b)).toEqual(["contentDigest"]);
    expect(textDiff(changed.texts, b.texts)).toMatchObject({ missing: 1, extra: 1 });
    expect(publicPath("https://x.vercel.app/a b?q=1")).toBe("/a%20b");
    expect(linkAlternates('<https://h/th/rooms/x>; rel="alternate"; hreflang="th", <https://h/rooms/x>; rel="alternate"; hreflang="x-default"'))
      .toEqual(["th /th/rooms/x", "x-default /rooms/x"]);
  });

  it("accepts only a correct candidate canonical and classifies locale-only cookies", () => {
    const reference = documentFacts(rendered);
    const expected = { path: "/rooms/pool-villa?tour=1", origin: "https://example.com" };
    const candidate = (href: string) => documentFacts(rendered.replace("</head>", `<link rel="canonical" href="${href}"></head>`));
    expect(roomCandidateFacts(candidate("https://example.com/rooms/pool-villa"), reference, expected))
      .toEqual({ mismatches: [], addedCanonical: true });
    expect(roomCandidateFacts(reference, reference, expected).mismatches).toContain("canonical");
    expect(roomCandidateFacts(candidate("https://example.com/api/line/webhook/rooms/pool-villa"), reference, expected).mismatches)
      .toContain("canonical");
    expect(roomCandidateFacts(candidate("https://other.invalid/rooms/pool-villa"), reference, expected).mismatches)
      .toContain("canonical");
    expect(roomPreviewCookies("NEXT_LOCALE=en; Path=/; Expires=Wed, 01 Jan 2020 00:00 GMT"))
      .toEqual({ setsLocaleCookie: true, setsOtherCookie: false });
    expect(roomPreviewCookies("NEXT_LOCALE=en; Path=/, __session=value"))
      .toEqual({ setsLocaleCookie: true, setsOtherCookie: true });
  });

  it("rejects responses that are not verified cache samples", () => {
    const ok = { status: 200, cache: "miss", edgeCache: "MISS", namespaceEcho: "miss-a-1", fnRegion: "iad1", mismatches: [] };
    const rule = { expect: "miss" as const, namespace: "miss-a-1", region: "iad1" };
    expect(rejectReason(ok, rule)).toBeNull();
    expect(rejectReason({ ...ok, cache: "hit", edgeCache: "HIT" }, { ...rule, expect: "hit" })).toBe("edge-served");
    expect(rejectReason({ ...ok, status: 307 }, rule)).toBe("status-307");
    expect(rejectReason({ ...ok, fnRegion: "sfo1" }, rule)).toBe("region");
    expect(rejectReason({ ...ok, mismatches: ["title"] }, rule)).toBe("facts:title");
    expect(rejectReason({ ...ok, namespaceEcho: undefined }, rule)).toBe("namespace-not-honored");
    expect(rejectReason({ ...ok, cache: null }, rule)).toBe("cache-unverified");
    expect(rejectReason({ ...ok, cache: "unconfirmed" }, rule)).toBe("unconfirmed-write");
    expect(rejectReason({ ...ok, cache: "unconfirmed" }, { ...rule, expect: "natural" })).toBe("unconfirmed-write");
    expect(rejectReason({ ...ok, cache: "stale" }, { ...rule, expect: "hit" })).toBe("expected-hit-got-stale");
    expect(rejectReason({ ...ok, cache: "stale" }, { ...rule, expect: "natural" })).toBeNull();
    expect(rejectReason({ ...ok, cache: "recovery" }, { ...rule, expect: "natural" })).toBeNull();
    expect(naturalHitUncertainty([
      { eligible: true, cache: "stale", startedMs: 0, completedMs: 1 },
      { eligible: true, cache: "recovery", startedMs: 2, completedMs: 3 },
    ]).observedRate).toBe(0.5);
  });

  it("applies the same five percent unknown ceiling to a natural-only replay", () => {
    const control = { rate: 0.99, unverifiedShare: 0.06 };
    const candidate = { rate: 0.99, unverifiedShare: 0 };
    const input = { classes: null, natural: { control, candidate }, factMismatches: 0, regionMismatches: 0 };
    const failed = evaluateGates(input, { samples: 100 });
    expect(failed.verdict).toBe("inconclusive");
    expect(failed.gates.map(({ gate }) => gate)).toEqual(["natural-hit-rate", "document-equivalence", "same-region"]);
    control.unverifiedShare = 0.05;
    expect(evaluateGates(input, { samples: 100 }).verdict).toBe("pass");
  });

  it("uses median and nearest-rank p95", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(median(values)).toBe(50.5);
    expect(nearestRank(values, 95)).toBe(95);
    expect(nearestRank([5], 95)).toBe(5);
    expect(summarize(values.map((ttfbMs) => ({ ttfbMs, waitMs: ttfbMs / 2 })))).toMatchObject({ n: 100, medianMs: 50.5, p95Ms: 95, waitP95Ms: 47.5 });
  });

  it("gates +5% latency per class and a 2 point natural hit loss", () => {
    const stats = (n: number, medianMs: number, p95Ms: number) => ({ n, medianMs, p95Ms, waitMedianMs: 0, waitP95Ms: 0 });
    const input = {
      classes: { hit: { control: stats(100, 100, 200), candidate: stats(100, 105, 210) }, miss: { control: stats(100, 400, 800), candidate: stats(100, 380, 820) } },
      natural: { control: { rate: 0.9, unverifiedShare: 0 }, candidate: { rate: 0.88, unverifiedShare: 0 } },
      factMismatches: 0, regionMismatches: 0,
    };
    expect(evaluateGates(input, { samples: 100 }).verdict).toBe("pass");
    const slowerMedian = { ...input, classes: { ...input.classes, hit: { ...input.classes.hit, candidate: stats(100, 150, 210) } } };
    expect(evaluateGates(slowerMedian, { samples: 100 }).verdict).toBe("pass");
    const slow = { ...input, classes: { ...input.classes, miss: { ...input.classes.miss, candidate: stats(100, 380, 841) } } };
    expect(evaluateGates(slow, { samples: 100 }).gates.find((gate) => gate.gate === "miss-p95")?.pass).toBe(false);
    const lostHits = { ...input, natural: { ...input.natural, candidate: { rate: 0.87, unverifiedShare: 0 } } };
    expect(evaluateGates(lostHits, { samples: 100 }).verdict).toBe("fail");
    const short = { ...input, classes: { ...input.classes, hit: { ...input.classes.hit, candidate: stats(99, 90, 150) } } };
    expect(evaluateGates(short, { samples: 100 }).verdict).toBe("inconclusive");
    expect(evaluateGates({ ...input, factMismatches: 1 }, { samples: 100 }).verdict).toBe("fail");
    expect(evaluateGates({ ...input, natural: null }, { samples: 100 }).verdict).toBe("inconclusive");
  });

  it("bounds unexpected misses without dropping any scheduled observations", () => {
    const result = naturalHitUncertainty([
      { eligible: true, cache: "miss", startedMs: 0, completedMs: 500 },
      { eligible: true, cache: "hit", startedMs: 10_000, completedMs: 10_500 },
      { eligible: true, cache: "miss", startedMs: 26_000, completedMs: 26_500 },
      { eligible: false, cache: "bypass", startedMs: 35_000, completedMs: 35_500 },
      { eligible: true, cache: "miss", startedMs: 87_000, completedMs: 87_500 },
    ]);
    expect(result).toEqual({ earlyAgeMs: 45_000, unexpectedMisses: 1, observedRate: 0.25, optimisticRate: 0.5 });
  });

  it("replays one deterministic natural schedule and builds safe request inputs", () => {
    const schedule = naturalSchedule(7, 50, 20_000, 90_000);
    expect(schedule).toEqual(naturalSchedule(7, 50, 20_000, 90_000));
    expect(schedule[0]).toBe(0);
    expect(Math.max(...schedule)).toBeLessThanOrEqual(90_000);
    expect(schedule.some((gap) => gap > 60_000)).toBe(true);
    expect(namespace("miss-cont")).toMatch(/^miss-cont-[0-9a-f]{12}$/);
    expect(roomPath("pool-villa", "en")).toBe("/rooms/pool-villa?tour=1");
    expect(roomPath("pool-villa", "th")).toBe("/th/rooms/pool-villa?tour=1");
    expect(() => roomPath("../x", "en")).toThrow();
  });
});
