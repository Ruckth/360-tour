import { protectedDeployments } from './preview-build.mjs';

const minute = 60000, day = 86400000;
/** Normalized operator evidence, never inferred from a deployment name.
 * @typedef {{id: number, name: string, projectId: number, deploymentType: string, previewIdentifier: string, createdAt: string}} Deployment
 * @typedef {{number: number, state: string, mergedAt: string | null, headRefName: string, headRefOid: string, baseRefName: string, headRepository: {nameWithOwner: string}, repository: {nameWithOwner: string}}} Pull
 * @typedef {{observedAt: string, project: {id: number, team: string, slug: string, defaultBranch: string}, branch: {name: string, exists: boolean, headSha: string | null}, deployments: Deployment[], pulls: Pull[]}} RetentionEvidence
 */
/** @param {RetentionEvidence} evidence @param {{projectId: number, team: string, project: string, branch: string, now?: number}} scope */
export function retentionPlan(evidence, scope) {
  const now = scope.now ?? Date.now();
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observed) || observed > now || now - observed > 15 * minute) throw new Error('Inventory and GitHub merge proof must be freshly observed together (15 minutes)');
  if (!Number.isSafeInteger(scope.projectId) || scope.projectId <= 0 || evidence.project.id !== scope.projectId || evidence.project.team !== scope.team || evidence.project.slug !== scope.project || !scope.team || !scope.project || !evidence.project.defaultBranch) throw new Error('Explicit project id/team/slug proof must match');
  if (!/^t3\/phase(?:[012]|3[a-f])-[a-z0-9-]+$/.test(scope.branch) || [evidence.project.defaultBranch, 'main', 'master', 'default'].includes(scope.branch)) throw new Error('Retention is limited to one explicit non-default architecture branch');
  if (evidence.branch.name !== scope.branch || typeof evidence.branch.exists !== 'boolean' || (evidence.branch.exists ? !/^[a-f0-9]{40}$/.test(evidence.branch.headSha || '') : evidence.branch.headSha !== null)) throw new Error('Require a fresh exact GitHub branch head or confirmed deletion proof');
  if (new Set(evidence.deployments.map(row => row.id)).size !== evidence.deployments.length || new Set(evidence.deployments.map(row => row.name)).size !== evidence.deployments.length) throw new Error('Ambiguous deployment inventory');
  return evidence.deployments.map(row => {
    let reason = '';
    if (protectedDeployments.includes(row.name) || ['default', 'main', 'master'].includes(row.name)) reason = 'protected deployment';
    else if (row.projectId !== scope.projectId || row.deploymentType !== 'preview') reason = 'project/type proof mismatch';
    else if (row.previewIdentifier !== scope.branch) reason = 'outside explicit branch scope';
    else if (!Number.isSafeInteger(row.id) || row.id <= 0 || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(row.name)) reason = 'invalid deployment identity';
    const pulls = evidence.pulls.filter(pr => pr.headRefName === scope.branch);
    if (!reason && (!pulls.length || pulls.some(pr => pr.repository.nameWithOwner !== 'Ruckth/360-tour' || pr.headRepository.nameWithOwner !== 'Ruckth/360-tour' || pr.baseRefName !== evidence.project.defaultBranch || pr.state !== 'MERGED' || !Number.isFinite(Date.parse(pr.mergedAt || ''))))) reason = 'missing merged same-repository/default-base GitHub proof or unmerged work';
    if (!reason && evidence.branch.exists && !pulls.some(pr => pr.headRefOid === evidence.branch.headSha)) reason = 'branch has new unmerged commits after its merged PR';
    const dates = [Date.parse(row.createdAt), ...pulls.map(pr => Date.parse(pr.mergedAt || ''))];
    if (!reason && dates.some(value => !Number.isFinite(value) || now - value < 7 * day)) reason = 'seven-day retention not elapsed';
    return { id: row.id, name: row.name, previewIdentifier: row.previewIdentifier, eligible: !reason, reason: reason || 'merged architecture preview past retention; backup verification required' };
  });
}
