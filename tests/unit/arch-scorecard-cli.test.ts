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
  expect(due.find((metric: { id: string }) => metric.id === 'phase2-tests')).toMatchObject({ target: 6 });
});
it('rejects an invalid explicit architecture phase', () => {
  expect(spawnSync(process.execPath, ['scripts/arch-scorecard.mjs', '--phase', '9']).status).toBe(2);
});
