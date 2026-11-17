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

it('requires every named regression in its own file even when the remaining cases pass', () => {
  const required = { [file]: ['security regression', 'reliability regression'] };
  const namedReport = (titles: string[]) => ({ success: true, testResults: [{ name: `/repo/${file}`, status: 'passed', assertionResults: titles.map(title => ({ title, status: 'passed' })) }] });
  expect(parseSuiteResults('/repo', [file], namedReport(['security regression', 'reliability regression']), 0, required).get(file)).toBe(true);
  for (const titles of [['unrelated test'], ['security regression'], ['security regression renamed', 'reliability regression']]) {
    expect(parseSuiteResults('/repo', [file], namedReport(titles), 0, required).get(file)).toBe(false);
  }
  const wrongFile = namedReport(['unrelated test']);
  wrongFile.testResults.push({ ...namedReport(required[file]).testResults[0], name: '/repo/other.test.ts' });
  expect(parseSuiteResults('/repo', [file], wrongFile, 0, required).get(file)).toBe(false);
});
