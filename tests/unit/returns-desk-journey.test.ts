// @vitest-environment edge-runtime
import { expect, it } from 'vitest';
import type { OrderView } from '@/components/checkout/backend';
import { returnableParts } from '@/components/checkout/returnable-parts';
import { chosenParts, destinations, initialChoices } from '@/components/checkout/returns-desk';
import { authorizeLabel } from '@/components/checkout/returns-desk-copy';
import { createFixtureBackend, type ReturnsVariant } from '../support/returns-desk-harness';

// The browser harness's seeded receipts, read back through the real getOrder and returnItems.preview.
it('turns journey 7 choices on the seeded Gold Wellness receipt into ฿4,793 to card', async () => {
  const backend = await createFixtureBackend();
  const orderId = backend.orderId();
  const view = await backend.query('manager', 'pos/orders:getOrder', { orderId }) as OrderView;
  const parts = returnableParts(view);
  // Two of five sessions are used: only the three unused, paid ones can come back (major 6).
  expect(parts.map(part => [part.kind, part.label, part.maxUnits])).toEqual([
    ['whole', 'Gold Wellness', 1], ['sessions', 'Thai massage 60 sessions', 3], ['goods', 'Spa robe · Sand / M', 1], ['voucher', 'Voucher value ฿500', 1],
  ]);
  const choices = initialChoices(parts, view.lines[0]._id);
  choices[parts[2].partKey] = { units: 1, condition: 'sellable' };
  const request = chosenParts(parts, choices)!;
  const preview = await backend.query('manager', 'pos/commands/returnItems:preview', {
    orderId, expectedRevision: view.order.revision, expectedCorrectionRevision: 0, clientKey: 'preview-key-1', tillId: 'till-a', reason: 'Package cancelled', parts: request,
  });
  expect(preview).toMatchObject({ amount: 479300, external: { amount: 479300, method: 'card' }, voucherCredits: [] });
});

/** A variant receipt as the desk reads it, with the visits the server offers (commerce.returnableVisitParts). */
async function variant(name: ReturnsVariant) {
  const backend = await createFixtureBackend({ variant: name });
  const orderId = backend.orderId();
  const view = await backend.query('manager', 'pos/orders:getOrder', { orderId }) as OrderView;
  const parts = returnableParts(view);
  const request = chosenParts(parts, initialChoices(parts, view.lines[0]._id))!;
  const preview = await backend.query('manager', 'pos/commands/returnItems:preview', {
    orderId, expectedRevision: view.order.revision, expectedCorrectionRevision: 0, clientKey: `preview-${name}`, tillId: 'till-a', reason: 'Changed mind', parts: request,
  }) as Parameters<typeof destinations>[0];
  return { parts, request, preview, label: authorizeLabel(destinations(preview)) };
}

it('splits a ฿1,200 voucher-and-card walk-in exactly: ฿700 to the card, ฿500 back to the voucher (astra blocker 2)', async () => {
  const { parts, preview, label } = await variant('mixed');
  expect(parts.map(part => part.kind)).toEqual(['units']);
  expect(preview).toMatchObject({ amount: 120000, external: { method: 'card', amount: 70000 }, voucherCredits: [{ paid: 50000 }] });
  expect(label).toBe('Authorize ฿700 to Card · ฿500 back to voucher GV-••••-Q9XD');
});

it.each(['visit', 'linked'] as const)('returns a commerce-funded %s visit through Return items (astra blocker 3)', async (name) => {
  const { parts, request, preview, label } = await variant(name);
  expect(parts.map(part => part.kind)).toEqual(['visit']);
  expect(request).toEqual([{ kind: 'line', lineId: parts[0].lineId, units: 1 }]);
  expect(preview).toMatchObject({ amount: 120000, external: { method: 'card', amount: 70000 }, voucherCredits: [{ paid: 50000 }] });
  expect(label).toBe('Authorize ฿700 to Card · ฿500 back to voucher GV-••••-Q9XD');
});

it('restores the session on a ฿0 covered visit (astra blocker 3)', async () => {
  const { parts, request, preview, label } = await variant('covered');
  expect(parts.map(part => part.kind)).toEqual(['restore']);
  expect(request).toEqual([{ kind: 'restoreSession', lineId: parts[0].lineId, useId: expect.any(String) }]);
  expect(preview).toMatchObject({ amount: 0, external: null });
  expect(label).toBe('Restore session');
});
