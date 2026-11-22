import { ESLint } from 'eslint';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('keeps ESLint untyped and checks floating promises with the standard oxlint script', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  expect(pkg.scripts['lint:types']).toBe('oxlint --type-aware -A all -D typescript/no-floating-promises');
  expect(pkg.scripts.lint).toContain('bun run lint:types');
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile('tests/unit/eslint-guardrails.test.ts');
  expect(config.languageOptions.parserOptions.project).toBeUndefined();
  expect(config.rules['@typescript-eslint/no-floating-promises']).toBeUndefined();
  const fixtures = [
    ...['src', 'convex', 'tests/unit', 'scripts'].map(dir => `${dir}/floating-promise-${process.pid}.ts`),
    `scripts/floating-promise-${process.pid}.mjs`,
  ];
  try {
    for (const file of fixtures) await writeFile(file, 'async function operation() { return 1; }\noperation();\nexport {};\n');
    const bad = await promisify(execFile)('bun', ['run', '--silent', 'lint:types', ...fixtures]).catch(error => error);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain('no-floating-promises');
    for (const file of fixtures) expect(bad.stdout).toContain(file);
    for (const file of fixtures) await writeFile(file, 'async function operation() { return 1; }\nawait operation();\nexport {};\n');
    await expect(promisify(execFile)('bun', ['run', '--silent', 'lint:types', ...fixtures])).resolves.toMatchObject({ stderr: '' });
  } finally {
    await Promise.all(fixtures.map(file => rm(file, { force: true })));
  }
});

it('wires current-source ownership into standard ESLint while allowing focused private tests', async () => {
  const eslint = new ESLint();
  const source = "import type { QueryCtx } from 'convex/pos/private/orderLinks'; export type Context = QueryCtx;";
  const [browser] = await eslint.lintText(source, { filePath: 'src/components/booking/PayClient.tsx' });
  expect(browser.messages.some(m => m.ruleId === 'architecture/ownership')).toBe(true);
  const [test] = await eslint.lintText(source, { filePath: 'tests/unit/eslint-guardrails.test.ts' });
  expect(test.messages.some(m => m.ruleId === 'architecture/ownership')).toBe(false);
});

it('checks deployed harness registrations and configures every Convex entry extension', async () => {
  const eslint = new ESLint();
  const [harness] = await eslint.lintText("import { query } from '../_generated/server'; export const leak = query({ args: {}, handler: () => null });", { filePath: 'convex/testing/harness.ts' });
  expect(harness.messages.some(message => message.ruleId === 'no-restricted-imports')).toBe(true);
  expect(harness.messages.some(message => message.ruleId === 'architecture/ownership')).toBe(true);
  for (const extension of ['ts', 'tsx', 'js', 'mjs', 'cjs', 'mts', 'cts', 'jsx']) {
    const config = await eslint.calculateConfigForFile(`convex/pos/leak.${extension}`);
    expect(config.rules['architecture/ownership'][0]).toBe(2);
  }
});
