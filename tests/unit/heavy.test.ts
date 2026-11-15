import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bypassQueue, tryAcquire } from '../../scripts/heavy.mjs';

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function options(slots = 1) {
  const directory = mkdtempSync(path.join(tmpdir(), '360-heavy-'));
  scratch.push(directory);
  return { directory, slots, command: 'test command' };
}

it('limits active owners, records diagnostics, and releases slots idempotently', () => {
  const config = options(2);
  const first = tryAcquire(config)!;
  const second = tryAcquire(config)!;
  expect(first).toBeTypeOf('function');
  expect(second).toBeTypeOf('function');
  expect(tryAcquire(config)).toBeNull();
  const owner = JSON.parse(readFileSync(path.join(config.directory, 'slot-0/owner.json'), 'utf8'));
  expect(owner).toMatchObject({ pid: process.pid, cwd: process.cwd(), command: config.command });
  expect(Number.isNaN(Date.parse(owner.startTime))).toBe(false);
  first();
  const replacement = tryAcquire(config)!;
  first(); // A previous owner cannot release the next owner's slot.
  expect(tryAcquire(config)).toBeNull();
  replacement(); second();
  expect(existsSync(path.join(config.directory, 'slot-0'))).toBe(false);
});

it('reclaims a dead pid but preserves a live owner', () => {
  const config = options();
  const slot = path.join(config.directory, 'slot-0');
  mkdirSync(slot);
  // Node rejects this out-of-range pid with ESRCH on supported macOS/Linux hosts.
  writeFileSync(path.join(slot, 'owner.json'), JSON.stringify({ pid: 2147483647, command: 'dead holder' }));
  const release = tryAcquire(config)!;
  expect(release).toBeTypeOf('function');
  expect(tryAcquire(config)).toBeNull();
  release();
});

it('bypasses nested jobs, CI, and disabled queues without taking another slot', () => {
  const config = options();
  const release = tryAcquire(config)!;
  for (const env of [{ HEAVY_HELD: '1' }, { CI: '1' }, { HEAVY_SLOTS: '0' }]) expect(bypassQueue(env)).toBe(true);
  expect(bypassQueue({})).toBe(false);
  expect(tryAcquire(config)).toBeNull();
  release();
});
