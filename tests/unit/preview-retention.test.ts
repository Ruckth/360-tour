import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retentionPlan } from '../../scripts/preview-retention-policy.mjs';

const now = Date.parse('2026-11-13T12:00:00Z');
const branch = 't3/phase3b-bookings';
const scope = { projectId: 123, team: 'test-team', project: 'test-project', branch, now };
const deployment = { id: 1, name: 'old-preview-123', projectId: 123, deploymentType: 'preview', previewIdentifier: branch, createdAt: '2026-10-01T00:00:00Z' };
const pull = { number: 42, state: 'MERGED', mergedAt: '2026-10-02T00:00:00Z', headRefName: branch, headRefOid: 'a'.repeat(40), baseRefName: 'main', headRepository: { nameWithOwner: 'Ruckth/360-tour' }, repository: { nameWithOwner: 'Ruckth/360-tour' } };
const evidence = { observedAt: '2026-11-13T11:59:00Z', project: { id: 123, team: 'test-team', slug: 'test-project', defaultBranch: 'main' }, branch: { name: branch, exists: true, headSha: 'a'.repeat(40) }, deployments: [deployment], pulls: [pull] };
describe('offline architecture Preview retention protections', () => {
  it('plans only explicitly proven old merged previews in the exact branch/project/type scope', () => {
    expect(retentionPlan(evidence, scope)[0]).toMatchObject({ eligible: true, id: 1 });
    for (const mutation of [{ projectId: 2 }, { deploymentType: 'prod' }, { deploymentType: 'dev' }, { name: 'wary-toad-189' }, { name: 'optimistic-turtle-573' }, { name: 'default' }, { previewIdentifier: 'unrelated' }, { createdAt: 'not-a-date' }, { createdAt: '2026-11-12T12:00:00Z' }]) expect(retentionPlan({ ...evidence, deployments: [{ ...deployment, ...mutation }] }, scope)[0].eligible).toBe(false);
  });
  it('does not treat branch-like deployment names as branch proof', () => {
    expect(retentionPlan({ ...evidence, deployments: [{ ...deployment, name: 't3-phase3b-bookings', previewIdentifier: '' }] }, scope)[0].eligible).toBe(false);
  });
  it('protects a reused branch with new unmerged commits and allows a confirmed deleted merged branch', () => {
    expect(retentionPlan({ ...evidence, branch: { ...evidence.branch, headSha: 'b'.repeat(40) } }, scope)[0].eligible).toBe(false);
    expect(retentionPlan({ ...evidence, branch: { ...evidence.branch, exists: false, headSha: null } }, scope)[0].eligible).toBe(true);
    expect(() => retentionPlan({ ...evidence, branch: { ...evidence.branch, name: 'other' } }, scope)).toThrow('branch head');
  });
  it('protects all unmerged, fork, wrong repository/base, recent-merge and missing-proof work', () => {
    for (const pulls of [[], [{ ...pull, state: 'OPEN', mergedAt: null }], [{ ...pull, state: 'CLOSED', mergedAt: null }], [{ ...pull, headRepository: { nameWithOwner: 'fork/360-tour' } }], [{ ...pull, repository: { nameWithOwner: 'other/360-tour' } }], [{ ...pull, baseRefName: 'stacked-parent' }], [{ ...pull, mergedAt: '2026-11-12T12:00:00Z' }], [pull, { ...pull, number: 43, state: 'OPEN', mergedAt: null }]]) expect(retentionPlan({ ...evidence, pulls }, scope)[0].eligible).toBe(false);
  });
  it('fails closed on stale/future observation, unknown scope, default/nonarchitecture branches and duplicate identity', () => {
    for (const observedAt of ['2026-11-13T11:40:00Z', '2026-11-13T12:01:00Z', 'invalid']) expect(() => retentionPlan({ ...evidence, observedAt }, scope)).toThrow('freshly');
    for (const mutation of [{ projectId: 456 }, { team: 'wrong' }, { project: 'wrong' }, { branch: 'main' }, { branch: 'feature/old-work' }, { branch: '' }]) expect(() => retentionPlan(evidence, { ...scope, ...mutation })).toThrow();
    expect(() => retentionPlan({ ...evidence, deployments: [deployment, deployment] }, scope)).toThrow('Ambiguous');
  });
});

it('operator planner requires protected fresh export, matching hash and valid ZIP CRC before emitting a deletion endpoint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3f-retention-'));
  fs.chmodSync(dir, 0o700);
  const archive = path.join(dir, 'snapshot.zip'), manifestFile = path.join(dir, 'backups.json'), proofFile = path.join(dir, 'proof.json');
  const script = path.resolve(import.meta.dirname, '../../scripts/preview-retention.mjs');
  const args = [script, '--evidence', proofFile, '--project-id', '123', '--team', scope.team, '--project', scope.project, '--branch', branch];
  const invoke = (extra: string[] = []) => execFileSync(process.execPath, [...args, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    fs.writeFileSync(proofFile, JSON.stringify({ ...evidence, observedAt: new Date().toISOString() }), { mode: 0o600 });
    expect(invoke()).toContain('"dryRun": true');
    expect(invoke()).not.toContain('operatorEndpointAfterFreshRecheck');
    execFileSync('python3', ['-c', 'import sys,zipfile,json\nwith zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_STORED) as z:z.writestr("orders/documents.jsonl",json.dumps({"sentinel":True})+chr(10))', archive]);
    fs.chmodSync(archive, 0o600);
    const backup = { deploymentId: 1, deploymentName: deployment.name, projectId: 123, previewIdentifier: branch, path: archive, exportedAt: new Date().toISOString(), includeFileStorage: true, sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex') };
    const write = (value: typeof backup) => fs.writeFileSync(manifestFile, JSON.stringify([value]), { mode: 0o600 });
    write(backup);
    expect(invoke(['--backups', manifestFile])).toContain(`POST https://api.convex.dev/v1/deployments/${deployment.name}/delete`);
    for (const mutation of [{ sha256: 'wrong' }, { includeFileStorage: false }, { exportedAt: 'invalid' }, { exportedAt: new Date(Date.now() - 3600000).toISOString() }]) {
      write({ ...backup, ...mutation }); expect(() => invoke(['--backups', manifestFile])).toThrow();
    }
    write(backup); fs.chmodSync(archive, 0o644);
    expect(() => invoke(['--backups', manifestFile])).toThrow();
    fs.chmodSync(archive, 0o600);
    const data = fs.readFileSync(archive), at = data.indexOf(Buffer.from('sentinel'));
    expect(at).toBeGreaterThan(0); data[at] ^= 1; fs.writeFileSync(archive, data);
    write({ ...backup, sha256: createHash('sha256').update(data).digest('hex') });
    expect(() => invoke(['--backups', manifestFile])).toThrow();
    expect(() => invoke(['--apply', 'yes'])).toThrow();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
