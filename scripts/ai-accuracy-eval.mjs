import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const deployment = fs.readFileSync('.env.local', 'utf8').split('\n').find(line => line.startsWith('CONVEX_DEPLOYMENT='))?.split('=')[1]?.split('#')[0]?.trim();
if (!deployment?.startsWith('dev:')) throw new Error('Accuracy eval requires the configured Convex dev deployment');
const arg = process.argv.indexOf('--repetitions');
const repetitions = arg < 0 ? 3 : Number(process.argv[arg + 1]);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error('Repetitions must be between 1 and 5');
const outputDir = path.resolve('output/ai-refactor-2026-10-01');
fs.mkdirSync(outputDir, { recursive: true });
async function run(name, args) {
	const { stdout } = await exec('npx', ['convex', 'run', name, JSON.stringify(args)], { timeout: 60000, maxBuffer: 2e6 });
	return JSON.parse(stdout);
}
const [properties, settings] = await Promise.all([run('properties:list', {}), run('settings:effective', {})]);
const pool = properties.find(property => property.slug === 'pool-villa');
if (!pool) throw new Error('Pool Villa must be active for this dataset');
const subtotal = pool.pricePerNight * 3;
const total = subtotal - Math.round(subtotal * pool.directDiscountPercent / 100);
const timeCheck = response => response.includes(settings.checkInTime) && response.includes(settings.checkOutTime);
const priceCheck = response => (response.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? []).some(amount => Number(amount.replace(/,/g, '')) === total) && /THB|฿/.test(response);
const cases = [
	{ id: 'check-in-en', channel: 'web', prompt: 'What time is check-in?', model: 'guardrail', check: timeCheck },
	{ id: 'check-in-th', channel: 'web', prompt: 'เช็กอินกี่โมงครับ', model: 'guardrail', check: timeCheck },
	{ id: 'check-in-ko', channel: 'web', prompt: '체크인 시간은 몇 시인가요?', model: 'guardrail', check: timeCheck },
	{ id: 'reschedule-en', channel: 'line', prompt: 'Reschedule my massage booking to tomorrow.', model: 'guardrail', check: r => r.includes('cannot reschedule') && r.includes('not been changed') },
	{ id: 'reschedule-th', channel: 'line', prompt: 'เลื่อนนัดนวดเป็นพรุ่งนี้ครับ', model: 'guardrail', check: r => r.includes('ยังเลื่อน') && r.includes('ยังไม่ถูกเปลี่ยน') },
	{ id: 'reschedule-ko', channel: 'line', prompt: '마사지 예약 시간을 변경해 주세요.', model: 'guardrail', check: r => r.includes('변경할 수 없') && r.includes('변경되지 않았') },
	{ id: 'off-topic-code', channel: 'web', prompt: 'Write a Python script to sort a list.', model: 'guardrail', check: r => r.includes('villas') && !r.includes('sorted(') },
	{ id: 'quote-en', channel: 'web', prompt: 'Calculate the total direct price for Pool Villa, 3 nights, for 2 guests. Give the total in THB.', model: 'openai/gpt-6-luna', check: priceCheck },
	{ id: 'quote-th', channel: 'web', prompt: 'คำนวณราคาพูลวิลล่า 3 คืน 2 คนเมื่อจองตรง ขอราคารวมเป็น THB ครับ', model: 'openai/gpt-6-luna', check: priceCheck },
	{ id: 'quote-ko', channel: 'web', prompt: 'Pool Villa를 2명이 3박 직접 예약할 때 총 가격을 THB로 계산해 주세요.', model: 'openai/gpt-6-luna', check: priceCheck }
];
const report = { startedAt: new Date().toISOString(), deployment, modelOverride: false, repetitions, dataset: 'critical-read-only-v1', expected: { checkIn: settings.checkInTime, checkOut: settings.checkOutTime, poolThreeNightTotal: total }, results: [] };
for (let repeat = 1; repeat <= repetitions; repeat++) {
	for (const scenario of cases) {
		const sessionId = await run('chatEval:createSession', { channel: scenario.channel, visitorName: 'Accuracy eval' });
		const started = Date.now();
		try {
			const reply = scenario.channel === 'web'
				? await run('chatAi:respond', { sessionId, userMessage: scenario.prompt })
				: await run('chatAi:generateReply', { sessionId, userMessage: scenario.prompt });
			report.results.push({ id: scenario.id, repeat, sessionId, prompt: scenario.prompt, latencyMs: Date.now() - started, ...reply, passed: reply.model === scenario.model && scenario.check(reply.response) });
		} catch (error) {
			report.results.push({ id: scenario.id, repeat, sessionId, prompt: scenario.prompt, passed: false, error: error.message });
		}
		fs.writeFileSync(path.join(outputDir, 'live-accuracy.json'), JSON.stringify(report, null, 2));
		console.log(`${repeat}/${repetitions} ${scenario.id}: ${report.results.at(-1).passed ? 'PASS' : 'FAIL'}`);
	}
}
report.finishedAt = new Date().toISOString();
report.summary = { total: report.results.length, passed: report.results.filter(result => result.passed).length, failed: report.results.filter(result => !result.passed).length };
fs.writeFileSync(path.join(outputDir, 'live-accuracy.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary));
if (report.summary.failed) process.exitCode = 1;
