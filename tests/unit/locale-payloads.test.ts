import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the public-route bundle size regression fixed by splitting locale loading out of the
 * client import graph. The baseline ae5c123 shipped a ~394 KB chunk with all 11 messages/*.json
 * in the ROOT LAYOUT initial JS because `src/lib/i18n/public-content.ts` statically imported
 * every dictionary and was pulled in by client components (hero, footer, villa detail, chat,
 * tour helpers...).
 *
 * This test statically walks every `'use client'` module and its transitive imports under src/,
 * and fails if any of them reaches a locale dictionary (`messages/*.json`) OR a module that
 * imports more than one locale dictionary. Client code must get localized strings from next-intl
 * hooks (the active locale only) or from server-provided props instead.
 */

const SRC = resolve(__dirname, "../../src");
const ROOT = resolve(__dirname, "../..");

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return listSourceFiles(full);
    return EXTENSIONS.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

function readSource(file: string) {
  return readFileSync(file, "utf8");
}

function isClientModule(file: string) {
  const source = readSource(file);
  // The directive must be the first statement; tolerate a leading comment/BOM block.
  const head = source.replace(/^\uFEFF/, "").trimStart().slice(0, 400);
  return /^(["'])use client\1/.test(head);
}

/** Extract raw module specifiers from static import/export-from and dynamic import() calls. */
function extractSpecifiers(source: string): string[] {
  // `typeof import("...")` and `import type ...` are TYPE positions, erased at runtime and never
  // bundled, so strip them before scanning. This is what lets a module reference the message SHAPE
  // (`typeof import("messages/en.json")`) without shipping the dictionary.
  const runtimeSource = source
    .replace(/\btypeof\s+import\s*\(\s*["'][^"']+["']\s*\)/g, "")
    .replace(/\bimport\s+type\b[^;]*;?/g, "");

  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^'"]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(runtimeSource)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolve a specifier to an absolute file path, or a sentinel for a messages/*.json dictionary. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(SRC, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // Bare package import — not part of our source graph.
    return null;
  }

  // A direct messages/*.json import.
  if (base.endsWith(".json")) {
    return existsSync(base) ? base : null;
  }

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isLocaleDictionary(file: string) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  return /^messages\/[^/]+\.json$/.test(rel);
}

/** All distinct locale dictionaries a single file imports directly. */
function directLocaleImports(file: string): string[] {
  const dicts = new Set<string>();
  for (const specifier of extractSpecifiers(readSource(file))) {
    const resolved = resolveSpecifier(file, specifier);
    if (resolved && isLocaleDictionary(resolved)) dicts.add(resolved);
  }
  return [...dicts];
}

/**
 * Walk the transitive import graph from a client entry file. Returns the offending chain the
 * first time a module reaches a locale dictionary (directly, or by importing a module that
 * imports more than one dictionary).
 */
function findLocaleLeak(entry: string): string[] | null {
  const visited = new Set<string>();
  const stack: { file: string; chain: string[] }[] = [{ file: entry, chain: [entry] }];

  while (stack.length) {
    const { file, chain } = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    // A module that imports MORE THAN ONE locale dictionary is a multi-locale module: forbidden.
    const directDicts = directLocaleImports(file);
    if (directDicts.length > 1) return [...chain, ...directDicts.map((d) => relative(ROOT, d))];

    for (const specifier of extractSpecifiers(readSource(file))) {
      const resolved = resolveSpecifier(file, specifier);
      if (!resolved) continue;
      if (isLocaleDictionary(resolved)) {
        return [...chain, relative(ROOT, resolved)];
      }
      if (resolved.startsWith(SRC) && !visited.has(resolved)) {
        stack.push({ file: resolved, chain: [...chain, resolved] });
      }
    }
  }
  return null;
}

describe("client locale payloads", () => {
  const sourceFiles = listSourceFiles(SRC);
  const clientModules = sourceFiles.filter(isClientModule);

  it("has client modules to check (sanity)", () => {
    expect(clientModules.length).toBeGreaterThan(0);
  });

  it("no 'use client' module transitively imports any messages/*.json dictionary", () => {
    const leaks: string[] = [];
    for (const entry of clientModules) {
      const chain = findLocaleLeak(entry);
      if (chain) {
        leaks.push(chain.map((file) => (file.startsWith(ROOT) ? relative(ROOT, file) : file)).join("\n  → "));
      }
    }

    expect(
      leaks,
      leaks.length
        ? `Client bundles must not ship locale dictionaries. Offending import chains:\n\n${leaks.join("\n\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("no source module imports more than one locale dictionary except the dedicated loader", () => {
    const allowed = resolve(SRC, "lib/i18n/messages-loader.ts");
    const offenders = sourceFiles
      .filter((file) => file !== allowed && directLocaleImports(file).length > 1)
      .map((file) => relative(ROOT, file));

    expect(
      offenders,
      offenders.length
        ? `Only src/lib/i18n/messages-loader.ts may import every locale dictionary; also: ${offenders.join(", ")}`
        : undefined,
    ).toEqual([]);
  });
});
