#!/usr/bin/env node
// Architecture scorecard for docs/plans/scalable-architecture-plan.html.
// Measures every plan goal from the source tree. No network, no build, no deploy.
//
//   node scripts/arch-scorecard.mjs              # report all metrics
//   node scripts/arch-scorecard.mjs --phase 2    # exit 1 unless every metric due by phase 2 meets its target
//   node scripts/arch-scorecard.mjs --json       # machine-readable output
//
// --phase N measures/reports only metrics due through N; omit it for the complete report.
// The clean-tree metric is advisory: it is reported but never fails a --phase gate.
// Required suite gates execute explicit files once and require every case to pass.
import { execSync } from 'node:child_process';
import ts from 'typescript';
import { runRequiredSuites } from './lib/scorecard-tests.mjs';
import { inspectArchitecture, SOURCE_EXTENSION, isConvexEntryFile } from './lib/architecture.mjs';
import { inspectConvexAccess } from './lib/convex-access.mjs';
import { COMMERCE_TABLE_NAMES, SCHEMA_DOMAINS, inspectSchema, reviewedTableDifferences, schemaSourceReader } from './lib/convex-schema.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
// Accept the task's --phase2 spelling as well as the documented --phase 2 form.
const compactPhase = args.find(arg => /^--phase[0-4]$/.test(arg));
const phaseArg = args.includes('--phase') ? Number(args[args.indexOf('--phase') + 1]) : compactPhase ? Number(compactPhase.slice(7)) : null;
if (phaseArg !== null && (!Number.isInteger(phaseArg) || phaseArg < 0 || phaseArg > 4)) {
  console.error('Expected --phase 0..4 or --phase0..4');
  process.exit(2);
}
const asJson = args.includes('--json');
const measuresPhase3 = phaseArg === null || phaseArg >= 3;

// ---------- file helpers ----------
const SKIP = new Set(['node_modules', '_generated', '.next', '.git', 'reui']);
function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (SOURCE_EXTENSION.test(name)) out.push(path);
	}
	return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');
// One invocation measures a single source snapshot. Metrics share file contents
// instead of repeatedly reading every file for each independent rule.
const contents = new Map();
const read = (p) => {
	if (!contents.has(p)) contents.set(p, readFileSync(p, 'utf8'));
	return contents.get(p);
};
const isTest = (p) => /\.test\.tsx?$|\/tests\//.test(rel(p));
const convexFiles = walk(join(ROOT, 'convex'));
const convexProd = convexFiles.filter((p) => isConvexEntryFile(rel(p)));
const srcFiles = walk(join(ROOT, 'src'));
const testFiles = [...convexFiles.filter(isTest), ...walk(join(ROOT, 'tests'))];
const count = (files, re) => files.reduce((n, p) => n + (read(p).match(re) ?? []).length, 0);
const filesMatching = (files, re) => files.filter((p) => re.test(read(p))).map(rel);

// ---------- measurements ----------
const schema = inspectSchema(schemaSourceReader(ROOT));
const tableNames = schema.tables.map(table => table.name);

const RETIRED_TABLES = ['tenants', 'chatAnswers', 'chatQuestions', 'chatSuggestedQuestions', 'curatedChatQuestions', 'curatedChatQuestionVariants', 'chatQuestionInteractions', 'chatKnowledgeScopes', 'chatAnswerPropertyScopes', 'chatTopics', 'chatAnswerTopics', 'pricing', 'propertyKnowledge', 'recentBookingDisplay'];
const OLD_NAMES = ['bills', 'billLines', 'billPayments', 'billCorrections', 'billAudit', 'billCounters', 'billLineLinks', 'billRefunds', 'serviceAppointments', 'rooms', 'chatSessions', 'chatMessages', 'socialProof', 'lineWebhookEvents', 'facebookWebhookEvents', 'instagramWebhookEvents', 'whatsappWebhookEvents'];
// Stock widens a live schema. Keep its bounded initialization and existing ledger
// retry compatibility while continuing to flag Phase 1 migration residue elsewhere.
const STOCK_COMPATIBILITY_FILES = new Set([
  'convex/commerce/private/stockCatalog.ts', // Checks uniqueness before variant search initialization finishes.
  'convex/commerce/private/stockLedger.ts', // Recognizes retries for movement rows without fingerprints.
  'convex/commerce/private/stockExpansionLedger.ts', // Returns and transfers made before lot tracking retain their original physical provenance.
  'convex/commerce/stockExpansion.ts', // Protects the reserved lot code for units without recorded provenance.
  'convex/commerce/private/purchasingCore.ts', // Derives historical line value and rejected quantities from original receipt evidence.
  'convex/commerce/private/purchasingOrders.ts', // Preserves old order values during amendment and indexes historical purchase references.
  'convex/commerce/private/purchasingReceipts.ts', // Seeds historical order line value before receipt or correction writes.
  'convex/commerce/purchasing.ts', // Exposes bounded internal supplier and purchase history migration commands.
  'convex/commerce/settings.ts', // Gates product sales on catalog readiness.
  'convex/commerce/stock.ts', // Initializes variant search and movement filters in bounded batches.
]);

// Public functions registered with a raw builder outside convex/auth/.
const rawPublicViolations = [];

// No-login builders must declare `returns:` before `handler`.
function missingReturns() {
	const re = /export\s+const\s+(\w+)\s*=\s*(publicQuery|publicMutation|publicAction|guestQuery|guestMutation|deviceQuery|deviceMutation)\s*\(\s*\{/g;
	const missing = [];
	for (const p of convexProd) {
		const text = read(p);
		for (const m of text.matchAll(re)) {
			const head = text.slice(m.index, text.indexOf('handler', m.index));
			if (!/\breturns\s*:/.test(head)) missing.push(`${rel(p)}:${m[1]}`);
		}
	}
	return missing;
}

// The same AST rules used by lint; all supported deployed source extensions count.
const deployed = new Set(convexProd);
const ownership = measuresPhase3 ? [...convexFiles, ...srcFiles].flatMap(p => {
	const path = rel(p), source = read(p);
	// Both guards inspect the same immutable source; parse deployed files once.
	const parsed = deployed.has(p) ? ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true) : undefined;
	if (parsed) rawPublicViolations.push(...inspectConvexAccess(path, source, parsed).violations);
	return inspectArchitecture(path, source, parsed).map(issue => ({ ...issue, path }));
}) : [];
const ownershipDetails = rule => ownership.filter(issue => issue.rule === rule).map(issue => `${issue.path}:${issue.line} ${issue.message}`);
const DOMAINS = SCHEMA_DOMAINS;

const bigFiles = [...convexProd, ...srcFiles.filter((p) => !isTest(p))]
	.filter((p) => !['convex/schema.ts', 'src/start-app/routeTree.gen.ts'].includes(rel(p)))
	.map((p) => [rel(p), read(p).split('\n').length])
	.filter(([, n]) => n > 1000)
	.map(([p, n]) => `${p} (${n})`);

const requiredSuites = [
  [0, 'convex/phase0Security.test.ts', [
    'rejects webhook mutations when the server secret is missing',
    'rejects assistant messages from the browser',
    'rejects chat calls without a valid guest token',
    'rejects respond for a session the caller does not own',
    'hides rooms and reviews of draft properties',
  ]],
  [1, 'convex/moneyCutover.test.ts', ['rounds a percentage discount identically for stays and orders']],
  [1, 'convex/phase1Architecture.test.ts', [
    'charges Stripe the stored satang amount',
    'acknowledges Stripe events for deleted bookings',
    'seeds the demo-resort scenario from empty',
  ]],
  [2, 'convex/messaging/reliability.test.ts', [
    'ignores a duplicate webhook delivery',
    'takes over a stale event lease',
    'does not resend after a crash following send',
    'pushes after an expired LINE reply token',
    'does not push after an ambiguous LINE timeout',
  ]],
  [2, 'convex/concierge/prompt.test.ts', ['builds the concierge prompt']],
  [4, 'convex/queryScale.test.ts', ['lists the inbox within the read budget']],
].filter(([phase]) => phaseArg === null || phase <= phaseArg);
const suiteResults = runRequiredSuites(ROOT, requiredSuites.map(([, file]) => file), Object.fromEntries(requiredSuites.map(([, file, titles]) => [file, titles])));
const suiteMetric = (phase, id, label) => {
  const files = requiredSuites.filter(([due]) => due === phase).map(([, file]) => file);
  add(id, phase, label, files.filter(file => suiteResults.get(file) === true).length, files.length,
    files.filter(file => suiteResults.get(file) !== true).map(file => `required suite failed or required named test missing: ${file}`));
};

function dirtyTracked() {
	try {
		return execSync('git status --porcelain --untracked-files=no', { cwd: ROOT }).toString().split('\n').filter(Boolean).length;
	} catch {
		return -1;
	}
}
const ciText = existsSync(join(ROOT, '.github/workflows/verify.yml')) ? read(join(ROOT, '.github/workflows/verify.yml')) : '';
const gitignore = existsSync(join(ROOT, '.gitignore')) ? read(join(ROOT, '.gitignore')) : '';

// ---------- metrics: [id, phase due, description, measured value, target, how measured] ----------
const m = [];
const add = (id, phase, label, value, target, detail = []) => m.push({ id, phase, label, value, target, ok: typeof target === 'function' ? target(value) : value === target, detail });

// Reported but advisory: a dirty local checkout is not an architecture regression, and CI checkouts are always clean.
add('clean-tree', -1, 'Modified tracked files on the working tree (advisory)', dirtyTracked(), 0);
const ADVISORY = new Set(['clean-tree']);

add('secret-fails-open', 0, 'Code paths that skip the webhook secret when it is unset', count(convexProd, /temporarily unauthenticated/g), 0);
suiteMetric(0, 'phase0-tests', 'Required phase 0 test files executed and passing');
add('static-dir', 0, 'Duplicate static/ directory exists (1 = yes)', existsSync(join(ROOT, 'static')) ? 1 : 0, 0);
add('ignored-scratch', 0, 'Scratch dirs not in .gitignore (output, tmp, graphify-out)', ['output', 'tmp', 'graphify-out'].filter((d) => !new RegExp(`^/?${d}/?$`, 'm').test(gitignore)).length, 0);
add('test-harness', 0, 'Shared Convex test harness exists (1 = yes)', existsSync(join(ROOT, 'convex/testing/harness.ts')) ? 1 : 0, 1);

const tableDifferences = reviewedTableDifferences(schema.tables);
add('tables', 1, 'Convex tables (74 existing + 23 commerce + 4 profitability + 34 Stock and retail)', tableNames.length, 135,
  [...tableDifferences, ...schema.tables.map(table => `${table.name} → ${table.source}`)]);
const commercePosTables = new Set(['directPaymentPanels', 'paymentAttempts', 'orderReturns', 'returnPayouts']);
const commerceTables = schema.tables.filter(table => COMMERCE_TABLE_NAMES.includes(table.name)
  && (table.name === 'branches' ? table.source === 'convex/branches/tables.ts'
    : table.source === (commercePosTables.has(table.name) ? 'convex/pos/tables.ts' : 'convex/commerce/tables.ts')));
add('commerce-tables', 1, 'Release 1 commerce tables', commerceTables.length, 23, commerceTables.map(table => `${table.name} → ${table.source}`));
add('channel-events-table', 1, 'Unified channelEvents table exists (1 = yes)', tableNames.includes('channelEvents') ? 1 : 0, 1);
add('retired-tables', 1, 'Retired tables still in the schema', RETIRED_TABLES.filter((t) => tableNames.includes(t)).length, 0, RETIRED_TABLES.filter((t) => tableNames.includes(t)));
add('old-table-names', 1, 'Tables still using pre-rename names', OLD_NAMES.filter((t) => tableNames.includes(t)).length, 0, OLD_NAMES.filter((t) => tableNames.includes(t)));
const unexpectedCompatibilityFiles = filesMatching(convexProd, /legacy|backfill/i)
  .filter(path => !STOCK_COMPATIBILITY_FILES.has(path));
add('legacy-files', 1, 'Convex files mentioning "legacy" or "backfill" outside reviewed Stock compatibility files',
  unexpectedCompatibilityFiles.length, 0, unexpectedCompatibilityFiles);
add('migrations', 1, 'migrations.define calls', count(convexProd, /migrations\.define\(/g), 0);
suiteMetric(1, 'phase1-tests', 'Required phase 1 test files executed and passing');
add('reexport-pages', 1, 'Files under [locale] that only re-export another page', srcFiles.filter((p) => rel(p).startsWith('src/app/[locale]/') && /^\s*export\s*\{[^}]*\}\s*from\s*["']@\/app\//m.test(read(p))).length, 0);

const startApiRoutes = srcFiles.filter((p) => /^src\/start-app\/routes\/api\./.test(rel(p)));
add('channel-routes', 2, 'Frontend webhook routes left (line/facebook/instagram/whatsapp; Next folders or Start api routes)', ['line', 'facebook', 'instagram', 'whatsapp'].filter((c) => existsSync(join(ROOT, `src/app/api/${c}`)) || startApiRoutes.some((p) => rel(p).startsWith(`src/start-app/routes/api.${c}`))).length, 0);
add('server-secret-uses', 2, 'Calls to requireServerSecret', count(convexProd, /requireServerSecret\(/g), 0);
add('as-never-webhooks', 2, '`as never` casts in frontend HTTP handlers', count(srcFiles.filter((p) => rel(p).startsWith('src/app/api/') || startApiRoutes.includes(p) || rel(p).startsWith('src/lib/server/http/')), /\bas\s+never\b/g), 0);
suiteMetric(2, 'phase2-tests', 'Required phase 2 test files executed and passing');
add('global-rate-row', 2, 'Uses of the single chat:global rate-limit key', count(convexProd, /['"`]chat:global['"`]/g), 0);

add('raw-public-functions', 3, 'Public functions on raw query/mutation/action outside convex/auth/model.ts', rawPublicViolations.length, 0, rawPublicViolations);
add('as-never', 3, '`as never` casts in app code (excluding reui)', count([...srcFiles, ...convexProd].filter((p) => !isTest(p)), /\bas\s+never\b/g), 0);
add('src-imports-convex-lib', 3, 'Browser imports of backend implementations', ownershipDetails('browser').length, 0, ownershipDetails('browser'));
add('convex-imports-src', 3, 'Backend imports of browser implementations', ownershipDetails('backend').length, 0, ownershipDetails('backend'));
add('cross-domain', 3, 'Cross-domain imports that bypass model.ts', ownershipDetails('cross-domain').length, 0, ownershipDetails('cross-domain'));
add('source-ownership', 3, 'Owner, shared purity and inspectable import forms', ownership.filter(issue => !['browser', 'backend', 'cross-domain'].includes(issue.rule)).length, 0, ownership.filter(issue => !['browser', 'backend', 'cross-domain'].includes(issue.rule)).map(issue => `${issue.path}:${issue.line} ${issue.message}`));
add('domain-folders', 3, 'Domain folders owning assembled schema tables', DOMAINS.filter(d => schema.tables.some(table => table.source.startsWith(`convex/${d}/`))).length, DOMAINS.length, DOMAINS.map(d => `${d}: ${schema.tables.filter(table => table.source.startsWith(`convex/${d}/`)).length} tables`));
add('demo-mode', 3, 'Files using demo mode (useOptionalConvex, dev:demo, bookingId=demo)', filesMatching([...srcFiles, ...testFiles], /useOptionalConvex|bookingId=demo/).length + (/"dev:demo"/.test(read(join(ROOT, 'package.json'))) ? 1 : 0), 0);
add('ci-placeholder-backend', 3, 'CI steps using a placeholder Convex URL', (ciText.match(/example\.convex\.cloud|placeholder/g) ?? []).length, 0);
add('architecture-doc', 3, 'ARCHITECTURE.md with a feature recipe (1 = yes)', existsSync(join(ROOT, 'ARCHITECTURE.md')) && /recipe/i.test(read(join(ROOT, 'ARCHITECTURE.md'))) ? 1 : 0, 1);
add('files-over-1000', 3, 'Handwritten source files over 1,000 lines (schema excluded)', bigFiles.length, 0, bigFiles);

const missing = missingReturns();
add('no-login-without-returns', 4, 'No-login public functions without a return validator', missing.length, 0, missing.slice(0, 20));
suiteMetric(4, 'phase4-tests', 'Required read-budget test files executed and passing');

// A zero is only meaningful once the thing it measures exists.
const byId = Object.fromEntries(m.map((x) => [x.id, x]));
byId.tables.ok &&= tableDifferences.length === 0;
const vacuous = (id, why) => { if (byId[id].ok && why) { byId[id].ok = false; byId[id].detail = [why]; } };
vacuous('cross-domain', byId['domain-folders'].value < DOMAINS.length && 'domain folders do not exist yet');
vacuous('no-login-without-returns', count(convexProd, /=\s*(publicQuery|publicMutation|publicAction|guestQuery|guestMutation|deviceQuery|deviceMutation)\s*\(/g) === 0 && 'no no-login builders in use yet');

// ---------- report ----------
const due = (phaseArg === null ? m : m.filter((x) => x.phase <= phaseArg)).map((x) => ADVISORY.has(x.id) ? { ...x, advisory: true } : x);
const gate = due.filter((x) => !x.advisory);
const failing = gate.filter((x) => !x.ok);
if (asJson) {
	// Unmeasured later phases must not appear as misleading zero-valued results.
	console.log(JSON.stringify({ phase: phaseArg, pass: failing.length === 0, metrics: due }, null, 2));
} else {
	const pad = (s, n) => String(s).padEnd(n);
	console.log(`Architecture scorecard${phaseArg === null ? '' : ` · gate for phase ${phaseArg}`}\n`);
	console.log(`${pad('', 3)}${pad('phase', 6)}${pad('value', 7)}${pad('target', 8)}metric`);
	for (const x of due) {
		const inGate = phaseArg === null || x.phase <= phaseArg;
		const mark = x.ok ? '✓' : x.advisory ? '!' : inGate ? '✗' : '·';
		const target = typeof x.target === 'number' ? x.target : 'info';
		console.log(`${pad(mark, 3)}${pad(x.phase, 6)}${pad(x.value, 7)}${pad(target, 8)}${x.label}`);
		if (!x.ok && inGate) for (const d of x.detail.slice(0, 8)) console.log(`${' '.repeat(24)}- ${d}`);
	}
	console.log(`\n${gate.length - failing.length}/${gate.length} ${phaseArg === null ? 'metrics at target' : 'gate metrics pass'}`);
	const warnings = due.filter((x) => x.advisory && !x.ok);
	if (warnings.length) console.log(`Advisory, not gated: ${warnings.map((x) => `${x.id} (${x.value})`).join(', ')}`);
}
if (phaseArg !== null && failing.length) process.exit(1);
