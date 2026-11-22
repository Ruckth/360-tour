// Strict debug-ID coverage for scripts/sentry-sourcemap-proof.mjs.
//
// Every published client file and every published server file with a debug ID must link to an
// uploaded copy of the same code whose source map resolves to real sources. The only allowed
// exceptions are the two generated-only server files characterized on 2026-11-22, and only while
// they still have no emitted map and no application code. Anything else fails.
import fs from 'node:fs';
import path from 'node:path';

const DEBUG_ID_SNIPPET = /^\(function\(\) \{\n[\s\S]*?_sentryDebugIds[\s\S]*?\n\}\)\(\);\n/;

/** Code without the debug-ID registration and trailing debugId/sourceMappingURL comments. @param {string} text */
export function comparableCode(text) {
  return text.replace(/\n?\/\/# (?:debugId|sourceMappingURL)=[^\n]*/g, '').trimEnd();
}

/** @param {string} text */
function withoutDebugIdSnippet(text) {
  return comparableCode(text).replace(DEBUG_ID_SNIPPET, '');
}

/**
 * The characterized generated-only kind of an unlinked server file, or undefined.
 * @param {string} file path relative to the repository root
 * @param {string} content
 */
export function generatedOnlyKind(file, content) {
  const body = withoutDebugIdSnippet(content);
  if (file === '.output/server/_runtime.mjs') {
    const regions = [...body.matchAll(/^\/\/#region (.+)$/gm)].map((match) => match[1]);
    const exported = /^export \{([^}]*)\};?$/m.exec(body)?.[1].split(',').map((name) => name.trim()).filter(Boolean) ?? [];
    // Rolldown writes the virtual module ID as the literal text `\0rolldown/runtime.js`.
    const onlyHelpers = regions.length === 1 && ['\\0rolldown/runtime.js', '\0rolldown/runtime.js'].includes(regions[0])
      && exported.length > 0 && exported.every((name) => /^__[A-Za-z]+$/.test(name))
      && !/\b(?:src|convex)\//.test(body);
    return onlyHelpers ? 'rolldown-runtime' : undefined;
  }
  if (/^\.output\/server\/_ssr\/server-[A-Za-z0-9_-]+\.mjs$/.test(file)) {
    const statements = body.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//'));
    const reexportsOnly = statements.length > 0 && statements.every((line) =>
      /^import \{[^}]*\} from "[^"]+";$/.test(line) || /^export \{[^}]*\};$/.test(line));
    return reexportsOnly ? 'reexport-barrel' : undefined;
  }
  return undefined;
}

const INSPECTED = {
  'rolldown-runtime': 'Rolldown runtime helpers generated from a virtual module; no first-party source.',
  'reexport-barrel': 'Server-entry re-exports and debug-ID registration; no first-party executable source.',
};

/**
 * Why an uploaded map does not resolve to real sources, or undefined. Vite query suffixes
 * (`?url`, `?sentry-tunnel-original`) are stripped; `\0…` and `prefix:` IDs are virtual. A map
 * must have mapped segments unless all its real sources are JSON data modules.
 * @param {{sources?: string[], mappings?: string}} map @param {string} root
 */
function mapProblem(map, root) {
  if (!Array.isArray(map?.sources) || map.sources.length === 0) return 'map has no sources';
  const real = map.sources.map((source) => source.replace(/\?.*$/, '')).filter((source) => !source.startsWith('\0') && !/^[\w.-]+:/.test(source));
  const missing = real.filter((source) => !fs.existsSync(path.join(root, source)));
  if (missing.length) return `map sources missing on disk: ${missing.slice(0, 3).join(', ')}`;
  const dataOnly = real.length > 0 && real.every((source) => source.endsWith('.json'));
  if (!dataOnly && !/[A-Za-z0-9+/]{4,}/.test(map.mappings ?? '')) return 'map has no mapped segments';
  return undefined;
}

/**
 * @param {{ file: string, side: 'client' | 'server', debugId: string, content: string }[]} published
 * @param {Map<string, { source?: { content: string }, sourceMap?: {sources?: string[], mappings?: string} }>} uploaded
 * @param {(file: string) => boolean} mapEmitted whether a map was emitted for a published file
 * @param {string} root
 */
export function evaluateCoverage(published, uploaded, mapEmitted, root) {
  const failures = [];
  const linked = { client: 0, server: 0 };
  const unlinked = [];
  for (const item of published) {
    const upload = uploaded.get(item.debugId);
    const sameCode = upload?.source && comparableCode(upload.source.content) === comparableCode(item.content);
    if (upload?.sourceMap && sameCode) {
      const problem = mapProblem(upload.sourceMap, root);
      if (problem) failures.push(`${item.file}: ${problem}`);
      else linked[item.side]++;
      continue;
    }
    const emitted = mapEmitted(item.file);
    const kind = item.side === 'server' && !upload && !emitted ? generatedOnlyKind(item.file, item.content) : undefined;
    const entry = {
      file: item.file, side: item.side, debugId: item.debugId,
      reason: upload ? 'published code differs from uploaded code' : 'debug ID not uploaded',
      mapEmitted: emitted,
      ...(kind ? { generatedOnlyKind: kind, inspectedContent: INSPECTED[kind] } : {}),
    };
    unlinked.push(entry);
    if (!kind) failures.push(`${item.file}: ${entry.reason}${emitted ? ' (a map was emitted, so it must link)' : ''}`);
  }
  const published_ = { client: published.filter((p) => p.side === 'client').length, server: published.filter((p) => p.side === 'server').length };
  const allowed = unlinked.filter((entry) => entry.generatedOnlyKind).length;
  return {
    published: published_, linked, unlinked, failures,
    allClientLinked: published_.client > 0 && linked.client === published_.client,
    allServerLinkedOrCharacterized: published_.server > 0 && linked.server + allowed === published_.server && allowed <= 2,
    pass: failures.length === 0 && published_.client > 0 && published_.server > 0,
  };
}
