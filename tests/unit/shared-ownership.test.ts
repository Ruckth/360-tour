import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps resort business time independent of host timezone and zone libraries', () => {
  expect(readFileSync('convex/shared/time.ts', 'utf8')).not.toMatch(/Intl\.|@date-fns/);
});
