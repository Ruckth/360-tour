import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { disabledServiceKeys, disabledServices, requireLocalBackend } from "../../scripts/local-integration-config.mjs";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));

describe("local integration isolation", () => {
  it("overrides inherited services and prevents Next from restoring dotenv credentials", () => {
    const fixture = mkdtempSync(path.join(tmpdir(), "360-local-env-"));
    try {
      writeFileSync(path.join(fixture, ".env.local"), disabledServiceKeys.map((key) => `${key}=invented-test-value`).join("\n"));
      const script = `const {loadEnvConfig}=require(process.argv[1]);loadEnvConfig(process.argv[2]);process.stdout.write(JSON.stringify(Object.fromEntries(JSON.parse(process.argv[3]).map(k=>[k,process.env[k]]))))`;
      const result = execFileSync(process.execPath, ["-e", script, nextRequire.resolve("@next/env"), fixture, JSON.stringify(disabledServiceKeys)], {
        env: { PATH: process.env.PATH, NODE_ENV: "test", ...disabledServices },
        encoding: "utf8",
      });
      expect(JSON.parse(result)).toEqual(Object.fromEntries(disabledServiceKeys.map((key) => [key, ""])));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("refuses remote deployments and accepts only explicit local HTTP backends", () => {
    for (const url of ['https://example.convex.cloud', 'https://localhost', 'http://127.0.0.1.evil.test', 'http://example.com']) expect(() => requireLocalBackend(url)).toThrow();
    expect(requireLocalBackend('http://127.0.0.1:3217')).toBe('http://127.0.0.1:3217');
  });
});
