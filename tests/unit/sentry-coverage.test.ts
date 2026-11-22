import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateCoverage, generatedOnlyKind } from '../../scripts/lib/sentry-coverage.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const snippet = (id: string) => `(function() {\n\ttry {\n\t\tvar e = globalThis;\n\t\te._sentryDebugIds = {}, e._sentryDebugIds[1] = "${id}";\n\t} catch (e) {}\n})();\n`;
const runtimeCode = `${snippet('run')}import { createRequire } from "node:module";\n//#region \\0rolldown/runtime.js\nvar __toESM = () => {};\nvar __require = createRequire(import.meta.url);\n//#endregion\nexport { __require, __toESM };\n`;
const barrelCode = `${snippet('bar')}import { a, b } from "./ssr.mjs";\nexport { a, b };\n`;
const map = { version: 3, sources: ['src/i18n/routing.ts'], mappings: 'AAAA,CAAC' };

type Item = { file: string; side: 'client' | 'server'; debugId: string; content: string };
const published: Item[] = [
  { file: '.output/public/assets/index-x.js', side: 'client', debugId: 'c1', content: 'client();' },
  { file: '.output/server/_ssr/routing-x.mjs', side: 'server', debugId: 's1', content: 'server();' },
  { file: '.output/server/other-x.mjs', side: 'server', debugId: 's2', content: 'other();' },
  { file: '.output/server/_runtime.mjs', side: 'server', debugId: 'run', content: runtimeCode },
  { file: '.output/server/_ssr/server-Abc1.mjs', side: 'server', debugId: 'bar', content: barrelCode },
];
const uploads = () => new Map(published.slice(0, 3).map((item) => [item.debugId, { source: { content: `${item.content}\n//# debugId=${item.debugId}` }, sourceMap: map }]));
const noMaps = () => false;

describe('strict Sentry source-map coverage', () => {
  it('passes when every file links except the two characterized generated-only files', () => {
    const result = evaluateCoverage(published, uploads(), noMaps, root);
    expect(result).toMatchObject({ pass: true, allClientLinked: true, allServerLinkedOrCharacterized: true, linked: { client: 1, server: 2 }, failures: [] });
    expect(result.unlinked.map((entry: { generatedOnlyKind?: string }) => entry.generatedOnlyKind)).toEqual(['rolldown-runtime', 'reexport-barrel']);
  });

  it('fails when a non-sampled uploaded map is dropped (negative control)', () => {
    const missing = uploads();
    missing.delete('s2');
    const result = evaluateCoverage(published, missing, noMaps, root);
    expect(result.pass).toBe(false);
    expect(result.failures).toEqual(['.output/server/other-x.mjs: debug ID not uploaded']);
  });

  it('requires linking once a characterized file gains a map or application code', () => {
    expect(evaluateCoverage(published, uploads(), (file: string) => file.includes('server-Abc1'), root).failures)
      .toEqual(['.output/server/_ssr/server-Abc1.mjs: debug ID not uploaded (a map was emitted, so it must link)']);
    expect(generatedOnlyKind('.output/server/_runtime.mjs', `${runtimeCode}//#region src/app.ts\nexport const app = 1;\n`)).toBeUndefined();
    expect(generatedOnlyKind('.output/server/_ssr/server-Abc1.mjs', `${barrelCode}const run = () => 1;\n`)).toBeUndefined();
    expect(generatedOnlyKind('.output/server/other.mjs', barrelCode)).toBeUndefined();
  });

  it('fails a client file that does not link, changed code, or a map without real sources', () => {
    expect(evaluateCoverage(published, new Map([...uploads()].filter(([id]) => id !== 'c1')), noMaps, root).allClientLinked).toBe(false);
    const changed = uploads();
    changed.set('s1', { source: { content: 'stale();' }, sourceMap: map });
    expect(evaluateCoverage(published, changed, noMaps, root).failures).toEqual(['.output/server/_ssr/routing-x.mjs: published code differs from uploaded code']);
    const unreal = uploads();
    unreal.set('s1', { source: { content: 'server();' }, sourceMap: { ...map, sources: ['src/does-not-exist.ts'], mappings: 'AAAA' } });
    expect(evaluateCoverage(published, unreal, noMaps, root).failures[0]).toMatch(/map sources missing on disk/);
    const segmentless = uploads();
    segmentless.set('s1', { source: { content: 'server();' }, sourceMap: { ...map, sources: ['src/i18n/routing.ts'], mappings: ';;' } });
    expect(evaluateCoverage(published, segmentless, noMaps, root).failures[0]).toMatch(/no mapped segments/);
  });

  it('accepts JSON data modules without segments and Vite query or virtual source IDs', () => {
    const real = uploads();
    real.set('s1', { source: { content: 'server();' }, sourceMap: { ...map, sources: ['messages/de.json'], mappings: ';;;' } });
    real.set('s2', { source: { content: 'other();' }, sourceMap: { ...map, sources: ['src/start-app/start.css?url', '\u0000virtual', '__vite-optional-peer-dep:bufferutil:ws', 'src/start-app/server.ts?sentry-tunnel-original'], mappings: 'AAAA' } });
    expect(evaluateCoverage(published, real, noMaps, root).failures).toEqual([]);
  });
});
