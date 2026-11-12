#!/usr/bin/env node
// Architecture scorecard for docs/plans/scalable-architecture-plan.html.
// Measures every plan goal from the source tree. No network, no build, no deploy.
//
//   node scripts/arch-scorecard.mjs              # report all metrics
//   node scripts/arch-scorecard.mjs --phase 2    # exit 1 unless every metric due by phase 2 meets its target
//   node scripts/arch-scorecard.mjs --json       # machine-readable output
//
// Test-name gates match the exact titles below, so name the tests exactly this way.
import { execSync } from 'node:child_process';
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

// ---------- file helpers ----------
const SKIP = new Set(['node_modules', '_generated', '.next', '.git', 'reui']);
function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(path);
	}
	return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const read = (p) => readFileSync(p, 'utf8');
const isTest = (p) => /\.test\.tsx?$|\/tests\//.test(rel(p));
const convexFiles = walk(join(ROOT, 'convex'));
const convexProd = convexFiles.filter((p) => !isTest(p));
const srcFiles = walk(join(ROOT, 'src'));
const testFiles = [...convexFiles.filter(isTest), ...walk(join(ROOT, 'tests'))];
const count = (files, re) => files.reduce((n, p) => n + (read(p).match(re) ?? []).length, 0);
const filesMatching = (files, re) => files.filter((p) => re.test(read(p))).map(rel);

// ---------- measurements ----------
const tableNames = convexProd.flatMap((p) => [...read(p).matchAll(/^\s*([A-Za-z]+):\s*defineTable\(/gm)].map((m) => m[1]));

const RETIRED_TABLES = ['tenants', 'chatAnswers', 'chatQuestions', 'chatSuggestedQuestions', 'curatedChatQuestions', 'curatedChatQuestionVariants', 'chatQuestionInteractions', 'chatKnowledgeScopes', 'chatAnswerPropertyScopes', 'chatTopics', 'chatAnswerTopics', 'pricing', 'propertyKnowledge', 'recentBookingDisplay'];
const OLD_NAMES = ['bills', 'billLines', 'billPayments', 'billCorrections', 'billAudit', 'billCounters', 'billLineLinks', 'billRefunds', 'serviceAppointments', 'rooms', 'chatSessions', 'chatMessages', 'socialProof', 'lineWebhookEvents', 'facebookWebhookEvents', 'instagramWebhookEvents', 'whatsappWebhookEvents'];

// Public functions registered with a raw builder outside convex/auth/.
const RAW_PUBLIC = /export\s+const\s+\w+\s*=\s*(query|mutation|action)\s*\(/g;
const rawPublic = convexProd.filter((p) => !rel(p).startsWith('convex/auth/'));

// No-login builders must declare `returns:` before `handler`.
function missingReturns() {
	const re = /export\s+const\s+(\w+)\s*=\s*(publicQuery|guestQuery|guestMutation|deviceQuery|deviceMutation)\s*\(\s*\{/g;
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

// Cross-domain imports that bypass <domain>/model.ts.
const DOMAINS = ['auth', 'catalog', 'bookings', 'services', 'pos', 'marketing', 'messaging', 'concierge', 'settings'];
function crossDomainViolations() {
	const out = [];
	for (const p of convexProd) {
		const r = rel(p);
		const own = DOMAINS.find((d) => r.startsWith(`convex/${d}/`));
		if (!own) continue;
		for (const m of read(p).matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
			const target = rel(join(p, '..', m[1]));
			const dom = DOMAINS.find((d) => target.startsWith(`convex/${d}/`));
			if (dom && dom !== own && !/\/model(\.ts)?$/.test(target)) out.push(`${r} → ${target}`);
		}
	}
	return out;
}

const bigFiles = [...convexProd, ...srcFiles.filter((p) => !isTest(p))]
	.filter((p) => !rel(p).endsWith('convex/schema.ts'))
	.map((p) => [rel(p), read(p).split('\n').length])
	.filter(([, n]) => n > 1000)
	.map(([p, n]) => `${p} (${n})`);

const allTestText = testFiles.map(read).join('\n');
const hasTest = (title) => allTestText.includes(`'${title}'`) || allTestText.includes(`"${title}"`) || allTestText.includes(`\`${title}\``);

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

add('clean-tree', -1, 'Modified tracked files on the working tree', dirtyTracked(), 0);

add('secret-fails-open', 0, 'Code paths that skip the webhook secret when it is unset', count(convexProd, /temporarily unauthenticated/g), 0);
const PHASE0_TESTS = [
	'rejects webhook mutations when the server secret is missing',
	'rejects assistant messages from the browser',
	'rejects chat calls without a valid guest token',
	'rejects respond for a session the caller does not own',
	'hides rooms and reviews of draft properties'
];
add('phase0-tests', 0, 'Required security tests present', PHASE0_TESTS.filter(hasTest).length, PHASE0_TESTS.length, PHASE0_TESTS.filter((t) => !hasTest(t)).map((t) => `missing test: ${t}`));
add('static-dir', 0, 'Duplicate static/ directory exists (1 = yes)', existsSync(join(ROOT, 'static')) ? 1 : 0, 0);
add('ignored-scratch', 0, 'Scratch dirs not in .gitignore (output, tmp, graphify-out)', ['output', 'tmp', 'graphify-out'].filter((d) => !new RegExp(`^/?${d}/?$`, 'm').test(gitignore)).length, 0);
add('test-harness', 0, 'Shared Convex test harness exists (1 = yes)', existsSync(join(ROOT, 'convex/testing/harness.ts')) ? 1 : 0, 1);

add('tables', 1, 'Convex tables (91 integrated − 14 retired − 3 merged)', tableNames.length, 74);
add('channel-events-table', 1, 'Unified channelEvents table exists (1 = yes)', tableNames.includes('channelEvents') ? 1 : 0, 1);
add('retired-tables', 1, 'Retired tables still in the schema', RETIRED_TABLES.filter((t) => tableNames.includes(t)).length, 0, RETIRED_TABLES.filter((t) => tableNames.includes(t)));
add('old-table-names', 1, 'Tables still using pre-rename names', OLD_NAMES.filter((t) => tableNames.includes(t)).length, 0, OLD_NAMES.filter((t) => tableNames.includes(t)));
add('legacy-files', 1, 'Convex files mentioning "legacy" or "backfill"', filesMatching(convexProd, /legacy|backfill/i).length, 0, filesMatching(convexProd, /legacy|backfill/i));
add('migrations', 1, 'migrations.define calls', count(convexProd, /migrations\.define\(/g), 0);
const PHASE1_TESTS = ['rounds a percentage discount identically for stays and orders', 'charges Stripe the stored satang amount', 'acknowledges Stripe events for deleted bookings', 'seeds the demo-resort scenario from empty'];
add('phase1-tests', 1, 'Required money and reset tests present', PHASE1_TESTS.filter(hasTest).length, PHASE1_TESTS.length, PHASE1_TESTS.filter((t) => !hasTest(t)).map((t) => `missing test: ${t}`));
add('reexport-pages', 1, 'Files under [locale] that only re-export another page', srcFiles.filter((p) => rel(p).startsWith('src/app/[locale]/') && /^\s*export\s*\{[^}]*\}\s*from\s*["']@\/app\//m.test(read(p))).length, 0);

add('channel-routes', 2, 'Next.js webhook route folders left (line/facebook/instagram/whatsapp)', ['line', 'facebook', 'instagram', 'whatsapp'].filter((c) => existsSync(join(ROOT, `src/app/api/${c}`))).length, 0);
add('server-secret-uses', 2, 'Calls to requireServerSecret', count(convexProd, /requireServerSecret\(/g), 0);
add('as-never-webhooks', 2, '`as never` casts in src/app/api', count(srcFiles.filter((p) => rel(p).startsWith('src/app/api/')), /as never/g), 0);
const PHASE2_TESTS = ['ignores a duplicate webhook delivery', 'takes over a stale event lease', 'does not resend after a crash following send', 'pushes after an expired LINE reply token', 'does not push after an ambiguous LINE timeout', 'builds the concierge prompt'];
add('phase2-tests', 2, 'Required messaging reliability tests present', PHASE2_TESTS.filter(hasTest).length, PHASE2_TESTS.length, PHASE2_TESTS.filter((t) => !hasTest(t)).map((t) => `missing test: ${t}`));
add('global-rate-row', 2, 'Uses of the single chat:global rate-limit key', count(convexProd, /['"`]chat:global['"`]/g), 0);

add('raw-public-functions', 3, 'Public functions on raw query/mutation/action outside convex/auth', count(rawPublic, RAW_PUBLIC), 0);
add('as-never', 3, '`as never` casts in app code (excluding reui)', count([...srcFiles, ...convexProd].filter((p) => !isTest(p)), /as never/g), 0);
add('src-imports-convex-lib', 3, 'src imports of convex/lib', count(srcFiles, /from\s+['"][^'"]*convex\/lib\//g), 0, filesMatching(srcFiles, /from\s+['"][^'"]*convex\/lib\//));
add('convex-imports-src', 3, 'convex imports of src', count(convexProd, /from\s+['"][^'"]*\/src\//g), 0, filesMatching(convexProd, /from\s+['"][^'"]*\/src\//));
add('cross-domain', 3, 'Cross-domain imports that bypass model.ts', crossDomainViolations().length, 0, crossDomainViolations().slice(0, 20));
add('domain-folders', 3, 'Domain folders present in convex/', DOMAINS.filter((d) => existsSync(join(ROOT, `convex/${d}`))).length, DOMAINS.length);
add('demo-mode', 3, 'Files using demo mode (useOptionalConvex, dev:demo, bookingId=demo)', filesMatching([...srcFiles, ...testFiles], /useOptionalConvex|bookingId=demo/).length + (/"dev:demo"/.test(read(join(ROOT, 'package.json'))) ? 1 : 0), 0);
add('ci-placeholder-backend', 3, 'CI steps using a placeholder Convex URL', (ciText.match(/example\.convex\.cloud|placeholder/g) ?? []).length, 0);
add('architecture-doc', 3, 'ARCHITECTURE.md with a feature recipe (1 = yes)', existsSync(join(ROOT, 'ARCHITECTURE.md')) && /recipe/i.test(read(join(ROOT, 'ARCHITECTURE.md'))) ? 1 : 0, 1);
add('files-over-1000', 3, 'Non-vendor source files over 1,000 lines (schema excluded)', bigFiles.length, 0, bigFiles);

const missing = missingReturns();
add('no-login-without-returns', 4, 'No-login public functions without a return validator', missing.length, 0, missing.slice(0, 20));
add('phase4-tests', 4, 'Required read-budget test present', hasTest('lists the inbox within the read budget') ? 1 : 0, 1);

// A zero is only meaningful once the thing it measures exists.
const byId = Object.fromEntries(m.map((x) => [x.id, x]));
const vacuous = (id, why) => { if (byId[id].ok && why) { byId[id].ok = false; byId[id].detail = [why]; } };
vacuous('cross-domain', byId['domain-folders'].value < DOMAINS.length && 'domain folders do not exist yet');
vacuous('no-login-without-returns', count(convexProd, /=\s*(publicQuery|guestQuery|guestMutation|deviceQuery|deviceMutation)\s*\(/g) === 0 && 'no no-login builders in use yet');

// ---------- report ----------
const due = phaseArg === null ? m : m.filter((x) => x.phase <= phaseArg);
const failing = due.filter((x) => !x.ok);
if (asJson) {
	console.log(JSON.stringify({ phase: phaseArg, pass: failing.length === 0, metrics: m }, null, 2));
} else {
	const pad = (s, n) => String(s).padEnd(n);
	console.log(`Architecture scorecard${phaseArg === null ? '' : ` · gate for phase ${phaseArg}`}\n`);
	console.log(`${pad('', 3)}${pad('phase', 6)}${pad('value', 7)}${pad('target', 8)}metric`);
	for (const x of m) {
		const inGate = phaseArg === null || x.phase <= phaseArg;
		const mark = x.ok ? '✓' : inGate ? '✗' : '·';
		const target = typeof x.target === 'number' ? x.target : 'info';
		console.log(`${pad(mark, 3)}${pad(x.phase, 6)}${pad(x.value, 7)}${pad(target, 8)}${x.label}`);
		if (!x.ok && inGate) for (const d of x.detail.slice(0, 8)) console.log(`${' '.repeat(24)}- ${d}`);
	}
	console.log(`\n${due.length - failing.length}/${due.length} ${phaseArg === null ? 'metrics at target' : 'gate metrics pass'}`);
}
if (phaseArg !== null && failing.length) process.exit(1);
