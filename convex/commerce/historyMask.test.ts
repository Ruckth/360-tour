import { describe, expect, it } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import { guestHistoryFact } from './private/historyView';

/** Audit r2 blocker 1: Show guest masks a code in every spelling the receipt and display do. */
const SPELLINGS = ['GV-7K2M-Q9XD', 'gv-7k2m-q9xd', 'GV7K2MQ9XD', 'gv 7k2m q9xd'];
const entry = (name: string) => ({
  _id: 'e' as Id<'voucherEntries'>, _creationTime: 0, voucherId: 'v' as Id<'vouchers'>, kind: 'edit', sourceKey: 'rename', createdAt: 1,
  actor: 'Ploy', before: { paid: 0, goodwill: 0 }, after: { paid: 0, goodwill: 0 }, guestFact: { key: 'renamed', args: { name } },
}) as Doc<'voucherEntries'>;

describe('guest History scrub', () => {
  it.each(SPELLINGS)('masks %s in a stored fact', code => {
    expect(guestHistoryFact(entry(`Mia ${code}`), false)).toEqual({ key: 'renamed', args: { name: 'Mia GV-••••-Q9XD' } });
  });

  it('leaves ordinary names and numbers as they are', () => {
    for (const name of ['Mia Tanaka', 'Room 1204', '+66 81 234 5678', '฿2,600']) {
      expect(guestHistoryFact(entry(name), false)).toEqual({ key: 'renamed', args: { name } });
    }
  });
});
