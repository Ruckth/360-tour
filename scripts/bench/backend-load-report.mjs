import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const operations = ['featured-post-edit', 'featured-warm', 'checkout', 'inbox', 'review-write'];
const concurrencies = [1, 10];

/** @param {number[]} values */
function summarize(values) {
  if (!values.length) return { n: 0, median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { n: sorted.length, median, p95: sorted[Math.ceil(0.95 * sorted.length) - 1] };
}

/** @param {string} filename */
function read(filename) {
  const bytes = readFileSync(filename);
  return { value: JSON.parse(bytes.toString()), sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** @param {string} file @param {string} spansFile */
function arm(file, spansFile) {
  const input = read(file);
  const spans = read(spansFile);
  const load = input.value;
  assert.match(load.revision, /^[a-f0-9]{40}$/);
  assert.match(load.lockSha, /^[a-f0-9]{64}$/);
  const batches = load.batchesByConcurrency ?? { 1: 100, 10: 10 };
  const groups = new Map();
  for (const sample of load.samples) {
    assert(sample.success && Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0, 'Failed or invalid request');
    assert(operations.includes(sample.operation) && concurrencies.includes(sample.concurrency), 'Unexpected sample');
    assert(Number.isInteger(sample.batch) && sample.batch >= 0 && sample.batch < batches[sample.concurrency]);
    const tag = sample.operation + '/' + sample.concurrency;
    const group = groups.get(tag) ?? [];
    group.push(sample.elapsedMs);
    groups.set(tag, group);
  }
  const windows = new Map();
  for (const count of concurrencies) {
    assert(Number.isInteger(batches[count]) && batches[count] > 0);
    for (const op of operations) {
      const expected = batches[count] * (op === 'review-write' ? 1 : count);
      assert.equal(groups.get(op + '/' + count)?.length, expected, 'Incomplete ' + op + '/' + count);
    }
    for (let i = 0; i < batches[count]; i++) windows.set('catalog-' + count + '-' + i, count);
  }

  const backendGroups = new Map();
  for (const window of spans.value.runs) {
    const count = windows.get(window.runId);
    assert(count && windows.delete(window.runId), 'Duplicate or unexpected backend window');
    assert(window.convex.some(row => row.function === 'catalog/adminReviews:update'), 'Missing origin write');
    assert(window.convex.some(row => row.function === 'catalog/publicProperties:featuredReviews' && !row.cached), 'Missing fresh query');
    for (const row of window.convex) {
      assert.equal(row.outcome, 'success', 'A backend execution failed');
      const key = [row.function, count, row.cached ? 'cached' : 'fresh'].join('/');
      const list = backendGroups.get(key) ?? [];
      list.push(row);
      backendGroups.set(key, list);
    }
  }
  assert.equal(windows.size, 0, 'Incomplete backend capture');
  const fields = ['executionMs', 'handlerMs', 'databaseReadDocuments', 'databaseReadBytes', 'databaseIoReadBytes',
    'databaseWriteDocuments', 'databaseWriteBytes', 'returnBytes', 'occRetryCount'];
  const backend = Object.fromEntries([...backendGroups].map(([key, rows]) => [key, Object.fromEntries(fields.map(field =>
    [field, summarize(rows.flatMap(row => Number.isFinite(row[field]) ? [row[field]] : []))]))]));
  return {
    revision: load.revision, sha256: { samples: input.sha256, spans: spans.sha256 }, lockSha: load.lockSha, versions: load.versions,
    fixture: { reviews: load.fixtureReviews, editCadenceMs: load.editCadenceMs, paired: Boolean(load.paired), batches },
    operations: Object.fromEntries([...groups].map(([tag, values]) => [tag, summarize(values)])), backend,
  };
}

const [controlLoad, controlSpans, changedLoad, changedSpans] = process.argv.slice(2);
const control = arm(controlLoad, controlSpans);
const candidate = arm(changedLoad, changedSpans);
assert.equal(control.lockSha, candidate.lockSha, 'Lockfile mismatch');
assert.deepEqual(control.fixture, candidate.fixture, 'Workload mismatch');
assert.deepEqual(control.versions, candidate.versions, 'Runtime version mismatch');
const comparisons = Object.keys(control.operations).sort().map(operation => {
  const before = control.operations[operation];
  const after = candidate.operations[operation];
  const p95Percent = 100 * (Number(after.p95) / Number(before.p95) - 1);
  // A post-edit read executes the changed function. An immediately repeated warm read can be
  // answered by Convex without executing the handler. The warm rows are reported separately.
  const maxChange = operation.startsWith('featured-post-edit/') ? -20 : operation.startsWith('featured-warm/') ? null : 5;
  return { operation, control: before, candidate: after, p95Percent, maxChange, passed: maxChange === null ? null : p95Percent <= maxChange };
});
const passed = comparisons.every(row => row.passed !== false);
console.log(JSON.stringify({ schemaVersion: 2, passed, comparisons, control, candidate }, null, 2));
if (!passed) process.exitCode = 1;
