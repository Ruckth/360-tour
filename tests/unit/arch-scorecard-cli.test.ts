import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
it.each([['--phase2'], ['--phase', '2']])('enforces Phase 2 with CLI arguments %j', (...flags) => {
  const result = spawnSync(process.execPath, ['scripts/arch-scorecard.mjs', ...flags, '--json'], { encoding: 'utf8' });
  const report = JSON.parse(result.stdout);
  expect(report.phase).toBe(2);
  expect(report.metrics.every((metric: { phase: number }) => metric.phase <= 2)).toBe(true);
  const due = report.metrics.filter((metric: { phase: number }) => metric.phase <= 2);
  // A dirty local checkout is reported but never fails the gate.
  expect(due.find((metric: { id: string }) => metric.id === 'clean-tree')).toMatchObject({ advisory: true });
  const gate = due.filter((metric: { advisory?: boolean }) => !metric.advisory);
  expect(result.status).toBe(gate.every((metric: { ok: boolean }) => metric.ok) ? 0 : 1);
  expect(due.find((metric: { id: string }) => metric.id === 'phase2-tests')).toMatchObject({ target: 2 });
});
it('rejects an invalid explicit architecture phase', () => {
  expect(spawnSync(process.execPath, ['scripts/arch-scorecard.mjs', '--phase', '9']).status).toBe(2);
});

it('rejects real comments-only and skipped suite execution reports', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { parseSuiteResults } = await import('../../scripts/lib/scorecard-tests.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-fixtures-'));
  try {
    const fixtures = [
      '// it("passes", () => {});',
      'test.skipIf(true)("conditional", () => {});',
      'const alias = test.skip; alias("alias", () => {});',
      'describe.skip("parent", () => { test("nested", () => {}); });',
      'test.todo("later");',
    ];
    const files = fixtures.map((source, i) => {
      const file = join(dir, `case-${i}.test.js`);
      writeFileSync(file, source);
      return file;
    });
    const config = join(dir, 'vitest.config.mjs');
    writeFileSync(config, `export default { test: { globals: true, include: ${JSON.stringify(files)}, maxWorkers: 2 } };`);
    const output = join(dir, 'results.json');
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', `--outputFile=${output}`], { encoding: 'utf8', timeout: 30_000 });
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.testResults.map((suite: { name: string }) => suite.name).sort()).toEqual([...files].sort());
    for (const suite of report.testResults.filter((suite: { name: string }) => suite.name !== files[0])) expect(suite.assertionResults.length).toBeGreaterThan(0);
    // Test each file independently of the aggregate failure from the empty file.
    for (const file of files) expect(parseSuiteResults(dir, [file], { ...report, success: true }, 0).get(file), file).toBe(false);
    expect(result.status).not.toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
