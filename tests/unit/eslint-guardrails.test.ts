import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('uses actual type information for promises in app, backend and test code', async () => {
  const eslint = new ESLint();
  for (const filePath of ['src/components/booking/PayClient.tsx', 'convex/pos/orders.ts', 'tests/unit/eslint-guardrails.test.ts']) {
    const [bad] = await eslint.lintText('async function operation() { return 1; }\noperation();', { filePath });
    expect(bad.messages.filter(m => m.ruleId === '@typescript-eslint/no-floating-promises'), filePath).toHaveLength(1);
    const [good] = await eslint.lintText('async function operation() { return 1; }\nawait operation();', { filePath });
    expect(good.messages.filter(m => m.ruleId === '@typescript-eslint/no-floating-promises'), filePath).toEqual([]);
  }
}, 30_000);

it('wires current-source ownership into standard ESLint while allowing focused private tests', async () => {
  const eslint = new ESLint();
  const source = "import type { QueryCtx } from 'convex/pos/private/orderLinks'; export type Context = QueryCtx;";
  const [browser] = await eslint.lintText(source, { filePath: 'src/components/booking/PayClient.tsx' });
  expect(browser.messages.some(m => m.ruleId === 'architecture/ownership')).toBe(true);
  const [test] = await eslint.lintText(source, { filePath: 'tests/unit/eslint-guardrails.test.ts' });
  expect(test.messages.some(m => m.ruleId === 'architecture/ownership')).toBe(false);
}, 30_000);
