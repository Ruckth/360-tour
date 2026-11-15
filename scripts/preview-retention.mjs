#!/usr/bin/env node
// Offline planning only: intentionally no network, credential, env mutation or DELETE implementation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { retentionPlan } from './preview-retention-policy.mjs';

process.umask(0o077);
const args = process.argv.slice(2);
function value(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
if (args.includes('--help') || !args.length) {
  console.log('Offline dry-run: pnpm preview:retention --evidence <private-json> --project-id <id> --team <slug> --project <slug> --branch <exact-architecture-branch> [--backups <private-manifest-json>]\nNo deletion is performed. See docs/architecture/phase3f-operations.md for evidence/export/fresh recheck/deletion procedure.');
} else {
  const allowed = ['--evidence', '--project-id', '--team', '--project', '--branch', '--backups'];
  if (args.length % 2 || args.some((item, index) => index % 2 === 0 && !allowed.includes(item)) || new Set(args.filter((_, index) => index % 2 === 0)).size !== args.length / 2) throw new Error('Unknown, duplicate or missing retention arguments; no apply option exists');
  const evidence = JSON.parse(fs.readFileSync(value('--evidence'), 'utf8'));
  const plan = retentionPlan(evidence, { projectId: Number(value('--project-id')), team: value('--team'), project: value('--project'), branch: value('--branch') });
  const backupFile = value('--backups');
  const backups = backupFile ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : [];
  for (const row of plan) {
    row.backupVerified = false;
    if (!row.eligible) continue;
    const backup = backups.find(item => item.deploymentId === row.id && item.deploymentName === row.name && item.projectId === evidence.project.id && item.previewIdentifier === row.previewIdentifier);
    if (!backup) continue;
    const file = path.resolve(backup.path);
    const stat = fs.lstatSync(file), dir = fs.lstatSync(path.dirname(file));
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || !dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)) throw new Error('Backup must be a regular mode-600 file in a mode-700 private directory');
    if (!Number.isFinite(Date.parse(backup.exportedAt)) || Date.parse(backup.exportedAt) < Date.parse(evidence.observedAt) - 15 * 60000 || Date.parse(backup.exportedAt) > Date.now()) throw new Error('Backup must be fresh, with a recorded export timestamp');
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sha256 !== backup.sha256) throw new Error('Backup SHA-256 mismatch');
    // Reading every ZIP member checks CRC. Require root and component data plus file-storage export attestation.
    if (backup.includeFileStorage !== true) throw new Error('Backup must include file storage');
    execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None, "CRC failure"\n assert "_tables/documents.jsonl" in z.namelist(), "Missing root table inventory"\n assert "_storage/documents.jsonl" in z.namelist(), "Missing storage inventory"\n assert "_components/rateLimiter/_tables/documents.jsonl" in z.namelist(), "Missing rateLimiter component inventory"\n assert "_components/rateLimiter/_storage/documents.jsonl" in z.namelist(), "Missing component storage inventory"\n assert all(not n.startswith("/") and ".." not in n.split("/") for n in z.namelist()), "Unsafe member"', file], { timeout: 30000, stdio: 'pipe' });
    row.backupVerified = true;
    row.sha256 = sha256;
    row.operatorEndpointAfterFreshRecheck = `POST https://api.convex.dev/v1/deployments/${row.name}/delete`;
  }
  console.log(JSON.stringify({ dryRun: true, branch: value('--branch'), plan }, null, 2));
}
