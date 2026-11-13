import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('uses actual type information for promises in app, backend and test code', async () => {
  // lintText supplies changing virtual source. CI's read-only single-run TS program can retain
  // the on-disk AST instead, whose locations do not match this small snippet.
  const eslint = new ESLint({ overrideConfig: [{ languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } }] });
  for (const filePath of ['src/components/booking/PayClient.tsx', 'convex/pos/orders.ts', 'tests/unit/eslint-guardrails.test.ts']) {
    const [bad] = await eslint.lintText('async function operation() { return 1; }\noperation();', { filePath });
    expect(bad.messages.filter(m => m.ruleId === '@typescript-eslint/no-floating-promises'), filePath).toHaveLength(1);
    const [good] = await eslint.lintText('async function operation() { return 1; }\nawait operation();', { filePath });
    expect(good.messages.filter(m => m.ruleId === '@typescript-eslint/no-floating-promises'), filePath).toEqual([]);
  }
}, 30_000);

it('wires current-source ownership into standard ESLint while allowing focused private tests', async () => {
  const eslint = new ESLint({ overrideConfig: [{ languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } }] });
  const source = "import type { QueryCtx } from 'convex/pos/private/orderLinks'; export type Context = QueryCtx;";
  const [browser] = await eslint.lintText(source, { filePath: 'src/components/booking/PayClient.tsx' });
  expect(browser.messages.some(m => m.ruleId === 'architecture/ownership')).toBe(true);
  const [test] = await eslint.lintText(source, { filePath: 'tests/unit/eslint-guardrails.test.ts' });
  expect(test.messages.some(m => m.ruleId === 'architecture/ownership')).toBe(false);
}, 30_000);

it('checks deployed harness registrations and configures every Convex entry extension', async () => {
  const eslint = new ESLint({ overrideConfig: [{ languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } }] });
  const [harness] = await eslint.lintText("import { query } from '../_generated/server'; export const leak = query({ args: {}, handler: () => null });", { filePath: 'convex/testing/harness.ts' });
  expect(harness.messages.some(message => message.ruleId === 'no-restricted-imports')).toBe(true);
  expect(harness.messages.some(message => message.ruleId === 'architecture/ownership')).toBe(true);
  for (const extension of ['ts', 'tsx', 'js', 'mjs', 'cjs', 'mts', 'cts', 'jsx']) {
    const config = await eslint.calculateConfigForFile(`convex/pos/leak.${extension}`);
    expect(config.rules['architecture/ownership'][0]).toBe(2);
  }
}, 30_000);
