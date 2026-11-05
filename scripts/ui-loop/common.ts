import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";

export function env() {
  if (existsSync(".env.local")) process.loadEnvFile?.(".env.local");
}
export function args(extra: Record<string, "string" | "boolean"> = {}) {
  const options: Record<string, { type: "string" | "boolean" }> = {};
  for (const key of [
    "section",
    "round",
    "screens",
    "devices",
    "concurrency",
    "out",
    "inject",
    "from",
    "auditor",
    "runs",
    "screen",
    "device",
    "base",
    "current",
    "notes",
    ...Object.keys(extra),
  ])
    options[key] = { type: extra[key] ?? "string" };
  for (const key of [
    "check-only-devices",
    "debug-shots",
    "prepare-only",
    "calibrate",
    "all",
  ])
    options[key] = { type: "boolean" };
  return parseArgs({ options, allowPositionals: true });
}
export const list = (value: string | boolean | undefined) =>
  typeof value === "string" ? value.split(",").filter(Boolean) : [];
export const str = (value: string | boolean | undefined, fallback = "") =>
  typeof value === "string" ? value : fallback;
export const root = (section: string, round: string | number) =>
  path.resolve("output/ui-loop", section, `round-${round}`);
export async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
export async function save(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
}
export async function pool<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive integer");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}
export const errorText = (e: unknown) => {
  let result = e instanceof Error ? e.message : String(e);
  for (const key of [
    "UI_LOOP_ADMIN_EMAIL",
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_PUBLISHABLE_KEY",
  ])
    if (process.env[key])
      result = result.replaceAll(process.env[key]!, "[redacted]");
  return result;
};
