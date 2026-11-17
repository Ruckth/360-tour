import { expect, it } from 'vitest';
import { parseSuiteResults } from '../../scripts/lib/scorecard-tests.mjs';
const file = 'convex/example.test.ts';
const report = (statuses: string[]) => ({ success: true, testResults: [{ name: `/repo/${file}`, status: 'passed', assertionResults: statuses.map(status => ({ status })) }] });
it.each([[], ['pending'], ['skipped'], ['todo'], ['passed', 'pending'], ['failed']])('rejects empty or incomplete execution %j', (...statuses) => {
  expect(parseSuiteResults('/repo', [file], report(statuses), 0).get(file)).toBe(false);
});
it('requires a successful runner and a matching complete report', () => {
  expect(parseSuiteResults('/repo', [file], report(['passed']), 0).get(file)).toBe(true);
  for (const data of [undefined, {}, { success: true, testResults: [] }]) expect(parseSuiteResults('/repo', [file], data, 0).get(file)).toBe(false);
  expect(parseSuiteResults('/repo', [file], report(['passed']), 1).get(file)).toBe(false);
});
