import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * @param {string} root
 * @param {string[]} files
 * @param {{success?: boolean, testResults?: {name: string, status: string, assertionResults?: {status: string, title?: string}[]}[]}|undefined} report
 * @param {number|null} status
 * @param {Record<string, string[]>} requiredTitles
 */
export function parseSuiteResults(root, files, report, status, requiredTitles = {}) {
  return new Map(files.map(file => {
    const matches = Array.isArray(report?.testResults) ? report.testResults.filter(result => result.name === resolve(root, file)) : [];
    const suite = matches[0];
    const cases = suite?.assertionResults;
    return [file, status === 0 && report?.success === true && matches.length === 1 && suite.status === 'passed'
      && Array.isArray(cases) && cases.length > 0 && cases.every(test => test.status === 'passed')
      && (requiredTitles[file] ?? []).every(title => cases.some(test => test.title === title && test.status === 'passed'))];
  }));
}

/** @param {string} root @param {string[]} files @param {Record<string, string[]>} requiredTitles */
export function runRequiredSuites(root, files, requiredTitles = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'architecture-suites-'));
  try {
    const reportPath = join(directory, 'results.json');
    const result = spawnSync(process.execPath, ['scripts/heavy.mjs', 'pnpm', 'exec', 'vitest', 'run', ...files,
      '--reporter=json', `--outputFile=${reportPath}`], {
      cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { /* missing/malformed fails closed */ }
    return parseSuiteResults(root, files, report, result.status, requiredTitles);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
