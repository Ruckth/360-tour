#!/usr/bin/env node
import { spawn } from 'node:child_process';

const parallel = process.argv[2] === '--parallel';
const scripts = process.argv.slice(parallel ? 3 : 2);
async function run(script) {
  return await new Promise(resolve => {
    const child = spawn('bun', ['run', script], { stdio: 'inherit' });
    child.once('error', error => { console.error(error); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
}
if (parallel) {
  const codes = await Promise.all(scripts.map(run));
  process.exitCode = codes.find(code => code !== 0) ?? 0;
} else {
  for (const script of scripts) {
    const code = await run(script);
    if (code !== 0) { process.exitCode = code; break; }
  }
}
