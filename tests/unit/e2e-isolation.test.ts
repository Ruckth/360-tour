import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canReuseDemoBuild, createDemoEnv, demoBuildStamp, disabledDemoKeys } from "../../scripts/demo-server-config.mjs";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));

describe("disconnected demo configuration", () => {
  it("overrides inherited services and prevents Next from restoring dotenv credentials", () => {
    const fixture = mkdtempSync(path.join(tmpdir(), "360-demo-env-"));
    try {
      writeFileSync(path.join(fixture, ".env.local"), disabledDemoKeys.map((key) => `${key}=invented-test-value`).join("\n"));
      const script = `const {loadEnvConfig}=require(process.argv[1]);loadEnvConfig(process.argv[2]);process.stdout.write(JSON.stringify(Object.fromEntries(JSON.parse(process.argv[3]).map(k=>[k,process.env[k]]))))`;
      const result = execFileSync(process.execPath, ["-e", script, nextRequire.resolve("@next/env"), fixture, JSON.stringify(disabledDemoKeys)], {
        env: createDemoEnv({ PATH: process.env.PATH, SENTRY_DSN: "inherited-test-value", NODE_ENV: "test" }, "3217"),
        encoding: "utf8",
      });
      expect(JSON.parse(result)).toEqual(Object.fromEntries(disabledDemoKeys.map((key) => [key, ""])));
      const env = createDemoEnv({ NEXT_PUBLIC_CONVEX_URL: "https://invented.convex.cloud", NODE_ENV: "test" }, "3217");
      expect(env.NEXT_PUBLIC_CONVEX_URL).toBe("placeholder");
      expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("placeholder");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("reuses only the same demo build identity and configuration", () => {
    const marker = demoBuildStamp("demo-build-a\n");
    expect(canReuseDemoBuild(marker, "demo-build-a")).toBe(true);
    expect(canReuseDemoBuild(marker, "later-normal-build")).toBe(false);
    expect(canReuseDemoBuild(null, "demo-build-a")).toBe(false);
    expect(canReuseDemoBuild(marker, null)).toBe(false);
    expect(canReuseDemoBuild(JSON.stringify({ version: 0, buildId: "demo-build-a" }), "demo-build-a")).toBe(false);
  });
});
