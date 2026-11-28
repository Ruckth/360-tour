import { describe, expect, it } from 'vitest';
import type { OrderView, ReturnClaim, ReturnLotOptions } from '@/components/checkout/backend';
import { returnableParts, returnRefusal, rowReturnable } from '@/components/checkout/returnable-parts';
import {
  canCancel, chosenParts, coveredByWhole, destinations, freshInstruction, initialChoices, missingCondition, payoutStep, quoteDueAt,
} from '@/components/checkout/returns-desk';
import { authorizeLabel, payoutInstruction, returnRefusalText } from '@/components/checkout/returns-desk-copy';
import { formatResort, voucherMasks } from '@/components/checkout/checkout-ui';
import { benefitExpiresAt, benefitState, DEFAULT_COMMERCE_SETTINGS, lastUsableAt } from 'convex/shared/commerce';

type Content = { contentKey: string; label: string; units: number; returnedUnits: number; grantId?: string; voucherId?: string; stockMovementId?: string };
const snapshot = (label: string, contents: Content[], returnedUnits = 0) => ({ label, returnedUnits, contents });
function line(id: string, kind: string, contents: Content[], fields: Record<string, unknown> = {}) {
  return { _id: id, kind, name: kind, qty: 1, saleSnapshot: snapshot(kind === 'package' ? 'Gold Wellness' : id, contents), ...fields };
}
function view(lines: unknown[], fields: Record<string, unknown> = {}) {
  return {
    order: { _id: 'order1', status: 'paid', revision: 4 }, paymentRecord: { voidUnreceived: false, correctionRevision: 0 },
    commerce: { issuedBenefits: [], handovers: [] }, links: [], lines, ...fields,
  } as unknown as OrderView;
}
const gold = line('gold', 'package', [
  { contentKey: 'sessions', label: 'Sessions', units: 5, returnedUnits: 0, grantId: 'g1' },
  { contentKey: 'robe', label: 'Spa robe · Sand / M', units: 1, returnedUnits: 0, stockMovementId: 'm1' },
  { contentKey: 'credit', label: 'Voucher value', units: 1, returnedUnits: 0, voucherId: 'v1' },
]);
const tote = line('tote', 'product', [{ contentKey: 'product', label: 'Tote', units: 3, returnedUnits: 1, stockMovementId: 'm2' }], { qty: 3 });
const gift = line('gift', 'voucher', [{ contentKey: 'voucher', label: 'Gift', units: 1, returnedUnits: 0, voucherId: 'v2' }]);

describe('returnable parts', () => {
  it('lists what is still returnable on a settled commerce receipt only', () => {
    const parts = returnableParts(view([gold, tote, gift]));
    expect(parts.map(part => [part.kind, part.partKey, part.maxUnits, part.needsDisposition])).toEqual([
      ['whole', 'gold:whole', 1, false], ['sessions', 'gold:sessions', 5, false], ['goods', 'gold:robe', 1, true], ['voucher', 'gold:credit', 1, false],
      ['goods', 'tote', 2, true], ['voucher', 'gift', 1, false],
    ]);
    expect(parts.find(part => part.partKey === 'gift')?.voucherSale).toBe(true);
    expect(returnableParts(view([gold], { commerce: undefined }))).toEqual([]);
    expect(returnableParts(view([gold], { order: { _id: 'order1', status: 'open', revision: 1 } }))).toEqual([]);
    expect(returnableParts(view([gold], { paymentRecord: { voidUnreceived: true, correctionRevision: 0 } }))).toEqual([]);
  });

  it('leaves room stays to the booking page, and visits to what the visit adapter offers', () => {
    const rows = [
      line('stay', 'booking', [{ contentKey: 'x', label: 'Stay', units: 1, returnedUnits: 0 }]),
      line('visit', 'appointment', [], { appointmentId: 'a1' }),
      line('covered', 'appointment', [], { appointmentId: 'a2', coverage: { grantId: 'g1' } }),
      line('linked', 'service', []),
      line('room', 'service', []),
    ];
    const links = [{ lineId: 'linked', status: 'active', kind: 'appointment' }, { lineId: 'room', status: 'active', kind: 'booking' }];
    // A server without the visit field offers no visit (readers before writers).
    expect(returnableParts(view(rows, { links }))).toEqual([]);
    // Blocker 3: commerce-funded visits get Return items; a covered visit restores its session.
    const returnableVisitParts = [
      { lineId: 'visit', label: 'Thai massage', amount: 120000, appointmentId: 'a1', part: { kind: 'line', lineId: 'visit', units: 1 } },
      { lineId: 'covered', label: 'Thai massage', amount: 0, appointmentId: 'a2', part: { kind: 'restoreSession', lineId: 'covered', useId: 'u1' } },
      { lineId: 'linked', label: 'Thai massage', amount: 120000, appointmentId: 'a3', part: { kind: 'line', lineId: 'linked', units: 1 } },
      { lineId: 'room', label: 'Room', amount: 100, appointmentId: 'a4', part: { kind: 'line', lineId: 'room', units: 1 } },
    ];
    const parts = returnableParts(view(rows, { links, commerce: { issuedBenefits: [], handovers: [], returnableVisitParts } }));
    expect(parts.map(part => [part.kind, part.partKey, part.part.kind])).toEqual([
      ['visit', 'visit', 'line'], ['restore', 'covered', 'restoreSession'], ['visit', 'linked', 'line'],
    ]);
    expect(chosenParts(parts, initialChoices(parts, 'covered' as never))).toEqual([{ kind: 'restoreSession', lineId: 'covered', useId: 'u1' }]);
  });

  it('offers only unused paid sessions, and nothing once the whole package came back (major 6)', () => {
    const used = { issuedBenefits: [{ lineId: 'gold', contentKey: 'sessions', unusedPaidSessions: 3 }], handovers: [] };
    expect(returnableParts(view([gold], { commerce: used })).find(part => part.kind === 'sessions')?.maxUnits).toBe(3);
    const cancelled = line('gold', 'package', [
      { contentKey: 'sessions', label: 'Sessions', units: 5, returnedUnits: 3, grantId: 'g1' },
      { contentKey: 'robe', label: 'Spa robe · Sand / M', units: 1, returnedUnits: 1, stockMovementId: 'm1' },
      { contentKey: 'credit', label: 'Voucher value', units: 1, returnedUnits: 1, voucherId: 'v1' },
    ]);
    const spent = { issuedBenefits: [{ lineId: 'gold', contentKey: 'sessions', unusedPaidSessions: 0 }], handovers: [] };
    expect(returnableParts(view([cancelled], { commerce: spent }))).toEqual([]);
    expect(rowReturnable(view([cancelled], { commerce: spent }), 'gold' as never)).toBe(false);
    expect(rowReturnable(view([gold]), 'gold' as never)).toBe(true);
    expect(rowReturnable(view([gold], { activeReturn: { _id: 'r1' } }), 'gold' as never)).toBe(false);
  });

  it('marks goods on an open room-charge handover, so “Stays with guest” is not offered (sol blocker 3)', () => {
    const handovers = [{ lineId: 'tote', status: 'open' }];
    const parts = returnableParts(view([tote, gold], { commerce: { issuedBenefits: [], handovers } }));
    expect(parts.find(part => part.partKey === 'tote')?.custody).toBe(true);
    expect(parts.find(part => part.partKey === 'gold:robe')?.custody).toBe(false);
  });
});

describe('choices', () => {
  const parts = returnableParts(view([gold, tote, gift]));

  it('opens on the row it came from, with the whole package ticked (journey 7)', () => {
    expect(initialChoices(parts, 'gold' as never)).toEqual({ 'gold:whole': { units: 1, condition: null } });
    expect(initialChoices(parts, 'tote' as never)).toEqual({ tote: { units: 2, condition: null } });
    expect(initialChoices(parts, null)).toEqual({});
  });

  it('sends a whole package with the goods it names, and waits for every returned item’s condition', () => {
    const choices = { 'gold:whole': { units: 1, condition: null }, 'gold:sessions': { units: 2, condition: null }, 'gold:robe': { units: 1, condition: null } };
    expect(coveredByWhole(parts[1], choices)).toBe(true);
    expect(chosenParts(parts, choices)).toBeNull();
    expect(missingCondition(parts, choices)?.partKey).toBe('gold:robe');
    expect(chosenParts(parts, { ...choices, 'gold:robe': { units: 1, condition: 'sellable' } })).toEqual([
      { kind: 'cancelPackage', lineId: 'gold' },
      { kind: 'content', lineId: 'gold', contentKey: 'robe', units: 1, disposition: 'sellable' },
    ]);
  });

  it('waits for the physical lot on a partial restock and fills in an unambiguous return', () => {
    const lotA = 'a' as ReturnLotOptions['lots'][number]['lotId'];
    const lotB = 'b' as ReturnLotOptions['lots'][number]['lotId'];
    const options = new Map<string, ReturnLotOptions>([['tote', {
      lineId: 'tote' as ReturnLotOptions['lineId'], tracked: true,
      lots: [{ lotId: lotA, code: 'A', expiresAt: 10, quantity: 1 }, { lotId: lotB, code: 'B', expiresAt: 20, quantity: 1 }],
    }]]);
    expect(chosenParts(parts, { tote: { units: 1, condition: 'sellable' } }, null)).toBeNull();
    expect(chosenParts(parts, { tote: { units: 1, condition: 'sellable' } }, options)).toBeNull();
    expect(chosenParts(parts, { tote: { units: 1, condition: 'sellable', lotQuantities: { [lotB]: 1 } } }, options))
      .toMatchObject([{ lotAllocations: [{ lotId: 'b', quantity: 1 }] }]);
    expect(chosenParts(parts, { tote: { units: 2, condition: 'sellable' } }, options))
      .toMatchObject([{ lotAllocations: [{ lotId: 'a', quantity: 1 }, { lotId: 'b', quantity: 1 }] }]);
    expect(chosenParts(parts, { tote: { units: 1, condition: 'damaged', lotQuantities: { [lotB]: 1 } } }, options))
      .toEqual([{ kind: 'line', lineId: 'tote', units: 1, disposition: 'damaged' }]);
  });

  it('rejects out-of-cap units and sends no disposition for goods the guest keeps', () => {
    const sessions = { 'gold:sessions': { units: 2, condition: null } };
    expect(chosenParts(parts, { ...sessions, tote: { units: 9, condition: 'guest' } })).toBeNull();
    expect(chosenParts(parts, { ...sessions, tote: { units: 2, condition: 'guest' } })).toEqual([
      { kind: 'content', lineId: 'gold', contentKey: 'sessions', units: 2 },
      { kind: 'line', lineId: 'tote', units: 2 },
    ]);
  });

  it('lets staff return an eligible item when a different item has unavailable lot evidence', () => {
    const options = new Map<string, ReturnLotOptions>([
      ['gold:robe', { lineId: 'gold' as ReturnLotOptions['lineId'], contentKey: 'robe', tracked: false, lots: [], unavailable: true }],
      ['tote', { lineId: 'tote' as ReturnLotOptions['lineId'], tracked: false, lots: [] }],
    ]);
    expect(chosenParts(parts, { 'gold:robe': { units: 1, condition: 'sellable' } }, options)).toBeNull();
    expect(chosenParts(parts, { tote: { units: 1, condition: 'sellable' } }, options))
      .toEqual([{ kind: 'line', lineId: 'tote', units: 1, disposition: 'sellable' }]);
  });
});

describe('payout', () => {
  const claim = (key: string, state: ReturnClaim['state'], instructedAt = 1): ReturnClaim => ({ key, state, method: 'card', amount: 479300, dueAt: 0, instructedAt, reference: undefined } as ReturnClaim);
  const fresh = { key: 'external:1', instructedAt: 1, operatorRevision: 0 };

  it('shows a fresh instruction only for the destination this screen armed', () => {
    const record = { status: 'authorized' as const, operatorRevision: 0, claims: [claim('external:1', 'instructed')] };
    expect(payoutStep(record, fresh).kind).toBe('instruction');
    // A reload, another till or a lost answer: check what happened, never pay again.
    expect(payoutStep(record, null).kind).toBe('check');
    expect(payoutStep({ ...record, claims: [claim('external:1', 'unknown')] }, fresh).kind).toBe('check');
    expect(freshInstruction({ operatorRevision: 0, instruction: claim('external:1', 'instructed') })).toEqual(fresh);
    expect(freshInstruction({ operatorRevision: 0, instruction: null })).toBeNull();
  });

  it('never instructs the original till again after a takeover, release and reclaim (astra blocker 1)', () => {
    // A authorized (revision 0); B took over (1) and released (2); A continued at its till (3).
    const reclaimed = { status: 'authorized' as const, operatorRevision: 3, claims: [claim('external:1', 'instructed')] };
    expect(payoutStep(reclaimed, fresh).kind).toBe('check');
  });

  it('binds the instruction to the server answer, so a retry armed in another tab leaves this one checking (sol blocker 1)', () => {
    // Tab B: failed (1), retried (2), armed again (3) at a new time, same destination key.
    const rearmed = { status: 'authorized' as const, operatorRevision: 3, claims: [claim('external:1', 'instructed', 2)] };
    expect(payoutStep(rearmed, fresh).kind).toBe('check');
    expect(payoutStep(rearmed, freshInstruction({ operatorRevision: 3, instruction: claim('external:1', 'instructed', 2) })).kind).toBe('instruction');
    // The backend lane's per-instruction key (instructionId as the public key) is bound the same way.
    const keyed = { ...rearmed, claims: [{ ...claim('external:1', 'instructed', 2), key: 'b6f1' }] };
    expect(payoutStep(keyed, { key: 'external:1', instructedAt: 2, operatorRevision: 3 }).kind).toBe('check');
  });

  it('checks before anything else, then retries failures, then arms what is owed', () => {
    const claims = [claim('external:1', 'given'), claim('external:2', 'failed'), claim('external:3', 'owed')];
    expect(payoutStep({ status: 'authorized', operatorRevision: 0, claims }, null)).toMatchObject({ kind: 'failed', claim: { key: 'external:2' } });
    expect(payoutStep({ status: 'authorized', operatorRevision: 0, claims: [claims[0], claims[2]] }, null)).toMatchObject({ kind: 'owed', claim: { key: 'external:3' } });
    expect(payoutStep({ status: 'authorized', operatorRevision: 0, claims: [...claims, claim('external:4', 'instructed')] }, null).kind).toBe('check');
    expect(payoutStep({ status: 'completed', operatorRevision: 0, claims }, null).kind).toBe('closed');
  });

  it('cancels only while nothing was paid and nothing waits on a check', () => {
    expect(canCancel({ status: 'authorized', claims: [claim('a', 'failed'), claim('b', 'owed')] })).toBe(true);
    expect(canCancel({ status: 'authorized', claims: [claim('a', 'given'), claim('b', 'owed')] })).toBe(false);
    expect(canCancel({ status: 'authorized', claims: [claim('a', 'unknown')] })).toBe(false);
    expect(canCancel({ status: 'cancelled', claims: [] })).toBe(false);
  });

  it('words instructions and refusals in the catalog’s terms', () => {
    expect(payoutInstruction('card', 479300)).toBe('Refund ฿4,793 on the card terminal');
    expect(payoutInstruction('cash', 50000)).toBe('Give back ฿500 cash');
    const refusal = returnRefusal({ data: { code: 'RETURN_CHECK_PREVIOUS', message: 'server words' } })!;
    expect(returnRefusalText(refusal)).toBe('Check the earlier refund before doing anything else.');
    expect(returnRefusalText(returnRefusal({ data: { code: 'RETURN_SOMETHING_NEW', message: 'Server words.' } })!)).toBe('Server words.');
    expect(returnRefusal(new Error('lost'))).toBeNull();
  });
});

describe('where the money goes (astra blocker 2)', () => {
  const mixed = {
    amount: 120000, external: { method: 'card' as const, amount: 70000 },
    voucherCredits: [{ voucherId: 'v1', paid: 50000, goodwill: 0, newVoucher: false, maskedCode: 'GV-••••-Q9XD' }],
    rows: [{ lineId: 'massage', label: 'Thai massage', amount: 120000, parts: [{ kind: 'line', label: 'Thai massage', amount: 120000 }] }],
  } as never;

  it('names each destination exactly on the authorize and approve buttons, never the total to one method', () => {
    const list = destinations(mixed);
    expect(authorizeLabel(list)).toBe('Authorize ฿700 to Card · ฿500 back to voucher GV-••••-Q9XD');
    expect(authorizeLabel(list, true)).toBe('Approve · authorize ฿700 to Card · ฿500 back to voucher GV-••••-Q9XD');
    expect(authorizeLabel(destinations({ external: { method: 'card', amount: 479300 }, voucherCredits: [] } as never))).toBe('Authorize ฿4,793 to Card');
  });

  it('names a session put back, alone or beside money', () => {
    const restore = { external: null, voucherCredits: [], rows: [{ lineId: 'covered', label: 'Thai massage', amount: 0, parts: [{ kind: 'restore', label: 'Thai massage', amount: 0 }] }] } as never;
    expect(authorizeLabel(destinations(restore))).toBe('Restore session');
    expect(authorizeLabel(destinations(restore), true)).toBe('Approve · restore session');
  });

  it('dates the card refund from the sold rows’ terms, the shortest window winning (major 7)', () => {
    const now = Date.UTC(2026, 10, 19, 5);
    const terms = (card: number) => ({ saleSnapshot: { terms: { refundDueDays: { card, cashOrTransfer: 15 } } } });
    const at = quoteDueAt({ lines: [{ _id: 'massage', ...terms(45) }] } as never, mixed, now)!;
    // 19 Nov + 45 days = 3 Jan 2027, through the end of that Bangkok day.
    expect(new Date(at + 1).toISOString()).toBe('2027-01-03T17:00:00.000Z');
    expect(quoteDueAt({ lines: [] } as never, mixed, now)).toBeNull();
    expect(quoteDueAt({ lines: [] } as never, { external: null, rows: [] } as never, now)).toBeNull();
  });
});

describe('replacement vouchers (astra r3 B3, B4)', () => {
  const twoExpired = {
    amount: 120000, external: { method: 'card' as const, amount: 70000 },
    voucherCredits: [
      { voucherId: 'q9', paid: 25000, goodwill: 0, maskedCode: 'GV-••••-Q9XD', destination: { kind: 'newVoucher' } },
      { voucherId: 'r8', paid: 25000, goodwill: 0, maskedCode: null, destination: { kind: 'newVoucher' } },
    ],
    rows: [],
  } as never;

  it('names the voucher each equal replacement stands in for, on the quote, the decision and the button', () => {
    // r8's mask comes from the receipt's voucher tenders when the quote has none.
    const masks = voucherMasks({ voucherPayments: [{ _id: 'p', voucherId: 'r8' as never, amount: 25000, codeMask: 'GV-••••-R8TB' }] });
    expect(authorizeLabel(destinations(twoExpired, masks))).toBe(
      'Authorize ฿700 to Card · ฿250 on a new voucher replacing GV-••••-Q9XD (90 days) · ฿250 on a new voucher replacing GV-••••-R8TB (90 days)');
    // Without any mask it still says a new voucher, never a code it doesn't have.
    expect(authorizeLabel(destinations({ ...(twoExpired as object), voucherCredits: [(twoExpired as { voucherCredits: object[] }).voucherCredits[1]] } as never)))
      .toBe('Authorize ฿700 to Card · ฿250 on a new voucher (90 days)');
  });

  it('shows the last usable Bangkok day of an exclusive end, never the first expired day', () => {
    const issued = Date.parse('2026-11-20T10:00:00+07:00');
    const end = benefitExpiresAt(issued, 'voucher', DEFAULT_COMMERCE_SETTINGS, 90)!;
    expect(end).toBe(Date.parse('2027-02-19T00:00:00+07:00'));
    expect(benefitState({ kind: 'standalone_voucher', expiresAt: end, paused: false }, lastUsableAt(end), DEFAULT_COMMERCE_SETTINGS)).toBe('active');
    expect(benefitState({ kind: 'standalone_voucher', expiresAt: end, paused: false }, end, DEFAULT_COMMERCE_SETTINGS)).toBe('expired_forfeited');
    expect(lastUsableAt(end)).toBe(Date.parse('2027-02-18T23:59:59.999+07:00'));
    expect(formatResort(lastUsableAt(end), 'd MMM yyyy')).toBe('18 Feb 2027');
    expect(formatResort(end, 'd MMM yyyy')).toBe('19 Feb 2027');
  });
});
