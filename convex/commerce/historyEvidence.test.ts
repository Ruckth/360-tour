// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { expect, it } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { canReadCheckoutOrder, requireStaff } from '../auth/model';
import { readBudget, reserveWrites } from '../lib/readBudget';
import schema from '../schema';
import { adjust, type AdjustmentCommand, type AdjustmentWriter } from './private/adjustments';
import { listCommerceHistory, MAX_PAGE_BYTES, nameHistoryParts } from './private/history';
import { staffHistoryEntry } from './private/historyView';

/**
 * PR #91 round 4: staff History keeps D19 before → after for edits written through the shared
 * adjustment helper, and a page of near-cap edits stays ≤ 160 KiB with a cursor that loses nothing.
 */

const modules = import.meta.glob('/convex/**/*.ts');
const balances = { paid: 50_000, goodwill: 0 };
const terms = {
  preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 },
  packageValidityDays: 180, voucherValidityDays: 365, allowSessionTransfer: true,
  packageSplit: 'voucherFaceValue' as const, packageVatTiming: 'atSale' as const,
  pointsVatTreatment: 'discount' as const, pointsExpiryMonths: 12,
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

async function fixture() {
  const t = convexTest(schema, modules);
  const manager = t.withIdentity({ email: 'manager@example.com', emailVerified: true, tokenIdentifier: 'manager' });
  const cashier = t.withIdentity({ email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' });
  const ids = await t.run(async ctx => {
    for (const role of ['cashier', 'manager'] as const) {
      await ctx.db.insert('staffGrants', {
        role, email: `${role}@example.com`, tokenIdentifier: role, createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
      });
    }
    const branchId = await ctx.db.insert('branches', { key: 'main' });
    const orderId = await ctx.db.insert('orders', {
      status: 'paid', orderNumber: 1, currency: 'THB', itemCount: 1, hasItems: true,
      total: 50_000, due: 0, revision: 1, paidAt: Date.now(), createdBy: 'cashier', createdAt: 1, updatedAt: 1,
    });
    const lineId = await ctx.db.insert('orderLines', {
      orderId, kind: 'extra', name: 'Gift voucher', qty: 1, unitPrice: 50_000, catalogUnitPrice: 50_000, currency: 'THB', createdAt: 1,
    });
    const voucher = () => ctx.db.insert('vouchers', {
      branchId, source: { kind: 'sale', orderId, lineId },
      faceValue: balances.paid, paidBalance: balances.paid, goodwillBalance: 0,
      issuedExpiresAt: 1_800_000_000_000, effectiveExpiresAt: 1_800_000_000_000, status: 'active',
      name: 'Mia', revision: 0, settingsRevision: 0, terms,
    });
    const packageId = await ctx.db.insert('packages', { name: 'Massage 5', status: 'active', sort: 0, revision: 0 });
    return { voucherId: await voucher(), otherVoucherId: await voucher(), packageId };
  });
  return { t, manager, cashier, ...ids };
}

/** The auditor's round-4 writer (output/pr91-audit/writer-r4.test.ts): it never links its ledger entry. */
const voucherWriter = (ledgerVoucher?: Id<'vouchers'>): AdjustmentWriter => ({
  assertScope: async (ctx, actor, command) => {
    if (command.target.targetType !== 'voucher') throw new Error('Invalid voucher operation');
    const budget = readBudget(ctx);
    budget.range();
    const voucher = await ctx.db.get(command.target.targetId);
    if (voucher) budget.document(voucher);
    budget.assert();
    if (!voucher) throw new ConvexError({ code: 'VOUCHER_SCOPE_DENIED' });
    if (actor.role === 'cashier') {
      budget.range();
      const order = await ctx.db.get(voucher.source.orderId);
      if (order) budget.document(order);
      budget.assert();
      if (canReadCheckoutOrder(actor, order)) return;
      throw new ConvexError({ code: 'VOUCHER_SCOPE_DENIED' });
    }
  },
  prepare: async (ctx, actor, { target, kind, input }) => {
    if (target.targetType !== 'voucher') throw new Error('Invalid voucher operation');
    const budget = readBudget(ctx);
    budget.range();
    const voucher = await ctx.db.get(target.targetId);
    if (!voucher) throw new Error('Voucher disappeared');
    budget.document(voucher);
    budget.assert();
    const name = kind === 'rename' && typeof input.name === 'string' ? input.name : voucher.name;
    const before = { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance };
    return {
      before: { name: voucher.name ?? null },
      after: { name: name ?? null },
      apply: async ({ revisionAfter, recordedAt, sourceKey, reasonCode, reasonText }) => {
        reserveWrites(ctx, 2);
        await ctx.db.patch(voucher._id, { revision: revisionAfter, name });
        const id = await ctx.db.insert('voucherEntries', {
          voucherId: ledgerVoucher ?? voucher._id, before, after: before, actor: actor.email, createdAt: recordedAt,
          guestFact: { key: 'renamed', args: { name: name ?? '' } }, kind: 'edit', sourceKey, reasonCode, reasonText,
        });
        return [{ kind: 'voucherEntry', id }];
      },
    };
  },
});

const part = (serviceIds: string[], label?: string) => ({
  kind: 'session', contentKey: 'massage', units: 5, serviceIds, ...(label ? { label } : {}),
});
/** A W5-style package publish in the stored W0 shape: same content key and units, only the eligible service swapped. */
const packageWriter = (before: string[], after: string[], labels: [string?, string?] = []): AdjustmentWriter => ({
  assertScope: async () => {},
  prepare: async (ctx, _actor, { target }) => {
    if (target.targetType !== 'package') throw new Error('Invalid package operation');
    return {
      before: { contents: [part(before, labels[0])] },
      after: { contents: [part(after, labels[1])] },
      apply: async ({ revisionAfter }) => {
        reserveWrites(ctx, 1);
        await ctx.db.patch(target.targetId, { revision: revisionAfter });
        return [];
      },
    };
  },
});

function rename(voucherId: Id<'vouchers'>, extra: Partial<AdjustmentCommand> = {}): AdjustmentCommand {
  return {
    target: { targetType: 'voucher', targetId: voucherId }, kind: 'rename', input: { name: 'Mia Lin' },
    expectedRevision: 0, clientKey: 'test-key', reasonCode: 'serviceRecovery', reasonText: 'Customer service', ...extra,
  };
}

it('shows staff the before and after of a rename written through the shared helper, and replays it once', async () => {
  const { t, cashier, voucherId } = await fixture();
  const edit = rename(voucherId);
  const apply = () => cashier.run(async ctx => {
    const result = await adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter());
    expect(readBudget(ctx).documents).toBeLessThanOrEqual(8);
    return result;
  });
  const applied = await apply();
  expect(applied.status).toBe('applied');
  expect(await apply()).toEqual(applied);
  const stored = await t.run(async ctx => ({
    audit: await ctx.db.query('commerceAdjustments').unique(),
    ledger: await ctx.db.query('voucherEntries').unique(),
  }));
  expect(stored.audit).toMatchObject({ before: { name: 'Mia' }, after: { name: 'Mia Lin' }, effects: [{ kind: 'voucherEntry', id: stored.ledger?._id }] });
  expect(stored.ledger).toMatchObject({ adjustmentId: stored.audit?._id, changes: { before: { name: 'Mia' }, after: { name: 'Mia Lin' } } });

  const page = await cashier.query(api.commerce.history.staffPage, { target: edit.target, paginationOpts: { numItems: 20, cursor: null } });
  expect(page.page).toHaveLength(1);
  expect(page.page[0]).toMatchObject({
    fact: { key: 'renamed', args: { name: 'Mia Lin' } }, before: { name: 'Mia' }, after: { name: 'Mia Lin' },
    staff: { actorName: 'cashier@example.com', reason: 'serviceRecovery', reasonText: 'Customer service' },
  });
  // History reads the voucher's own stream (D19): the ledger range, not the adjustment.
  const reads = await t.run(async ctx => {
    await listCommerceHistory(ctx, edit.target, { numItems: 20, cursor: null });
    return readBudget(ctx).documents;
  });
  expect(reads).toBe(1);
  const guest = await cashier.query(api.commerce.history.guestPage, { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts: { numItems: 20, cursor: null } });
  expect(guest.page).toEqual([{ entryId: expect.any(String), at: expect.any(Number), fact: { key: 'renamed', args: { name: 'Mia Lin' } }, balance: expect.anything() }]);
});

it('refuses to record another voucher\'s entry as the edit\'s own and writes nothing', async () => {
  const { t, cashier, voucherId, otherVoucherId } = await fixture();
  await expect(cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), rename(voucherId), voucherWriter(otherVoucherId))))
    .rejects.toThrow('not its own');
  expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').collect())).toEqual([]);
});

async function service(t: Awaited<ReturnType<typeof fixture>>['t'], name: string) {
  return await t.run(ctx => ctx.db.insert('services', {
    slug: name.toLowerCase().replaceAll(' ', '-'), name, description: '', category: 'massage', durationMin: 60, bufferMin: 0,
    price: 120_000, currency: 'THB', staffIds: [], status: 'active', createdAt: 1, updatedAt: 1,
  }));
}

async function publish(f: Awaited<ReturnType<typeof fixture>>, clientKey: string, revision: number, writer: AdjustmentWriter) {
  const target = { targetType: 'package' as const, targetId: f.packageId };
  const command: AdjustmentCommand = { target, kind: 'publish', input: { version: revision + 2 }, expectedRevision: revision, clientKey, reasonCode: 'other', reasonText: 'Updated eligible treatment' };
  expect((await f.manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), command, writer))).status).toBe('applied');
  return target;
}

// Astra round 4 (audits/pr91-r4-astra-evidence/service-substitution.json): Massage 5's eligible
// treatment changes from Traditional Thai Massage to Aromatherapy Massage; the stored parts hold IDs only.
it('names a same-key service substitution for staff from the services, then the stored label, then nothing', async () => {
  const f = await fixture();
  const thai = await service(f.t, 'Traditional Thai Massage');
  const aroma = await service(f.t, 'Aromatherapy Massage');
  const target = await publish(f, 'swap', 0, packageWriter([thai], [aroma]));
  const page = () => f.manager.query(api.commerce.history.staffPage, { target, paginationOpts: { numItems: 20, cursor: null } });
  expect((await page()).page).toEqual([expect.objectContaining({
    fact: { key: 'published' },
    before: { contents: [part([thai], 'Traditional Thai Massage')] },
    after: { contents: [part([aroma], 'Aromatherapy Massage')] },
    staff: { actorName: 'manager@example.com', reason: 'other', reasonText: 'Updated eligible treatment' },
  })]);
  // The stored identities are kept; the name is drawn at read time.
  expect(await f.t.run(async ctx => (await ctx.db.query('commerceAdjustments').unique())?.before)).toEqual({ contents: [part([thai])] });

  // Once a service is gone: the label the writer stored, then the reader's generic text (no label).
  await publish(f, 'labelled', 1, packageWriter([aroma], [thai], ['Aroma 60', 'Thai 60']));
  await f.t.run(ctx => ctx.db.delete(thai));
  const [labelled, first] = (await page()).page;
  expect(labelled).toMatchObject({ before: { contents: [part([aroma], 'Aromatherapy Massage')] }, after: { contents: [part([thai], 'Thai 60')] } });
  expect(first).toMatchObject({ before: { contents: [part([thai])] }, after: { contents: [part([aroma], 'Aromatherapy Massage')] } });
});

it('reads each part name once per page and at most 20 names', async () => {
  const f = await fixture();
  const ids = await Promise.all(Array.from({ length: 25 }, (_, i) => service(f.t, `Service ${i}`)));
  // 25 distinct services across two edits, one of them in both: a page reads 20.
  await publish(f, 'wide', 0, packageWriter(ids.slice(0, 13), ids.slice(12)));
  await publish(f, 'again', 1, packageWriter(ids.slice(0, 1), ids.slice(1, 2)));
  const target = { targetType: 'package' as const, targetId: f.packageId };
  const reads = await f.t.run(async ctx => {
    const result = await listCommerceHistory(ctx, target, { numItems: 20, cursor: null });
    const rows = await nameHistoryParts(ctx, result.page.map(row => staffHistoryEntry(row)));
    return { documents: readBudget(ctx).documents, rows };
  });
  expect(reads.documents).toBe(2 + 20);
  const labels = reads.rows.flatMap(row => [row.before, row.after]).map(fields => (fields?.contents as { label?: string }[])[0].label);
  expect(labels.filter(Boolean).length).toBeGreaterThan(0);
  expect(labels.filter(label => label === undefined).length).toBeGreaterThan(0);
});

/** Twenty schema-valid edits, each ledger row near or above the helper's 8 KiB cap (the auditor's sizes). */
async function nearCapEdits(t: Awaited<ReturnType<typeof fixture>>['t'], voucherId: Id<'vouchers'>, sizes: { before: number; after: number; reason: number }) {
  await t.run(async ctx => {
    for (let i = 0; i < 20; i++) {
      const name = String.fromCharCode(97 + i).repeat(sizes.after);
      await ctx.db.insert('voucherEntries', {
        voucherId, kind: 'edit', sourceKey: `near-cap-${i}`, createdAt: 1_000 + i, actor: 'Ploy',
        reasonCode: 'other', reasonText: 'q'.repeat(sizes.reason), before: balances, after: balances,
        guestFact: { key: 'renamed', args: { name: 'GV-ABCD-1234 '.repeat(4) + name.slice(52) } },
        changes: { before: { name: 'z'.repeat(sizes.before) }, after: { name } },
      });
    }
  });
}

for (const [label, sizes] of [
  ['at the helper cap', { before: 3_000, after: 3_000, reason: 480 }],
  ['above the helper cap (the round-4 fixture)', { before: 3_400, after: 3_500, reason: 480 }],
] as const) {
  it(`pages 20 near-cap edits ${label} within 160 KiB, every row exactly once, staff and guest`, async () => {
    const { t, cashier, voucherId } = await fixture();
    await nearCapEdits(t, voucherId, sizes);
    const target = { targetType: 'voucher' as const, targetId: voucherId };
    const pageOf = (audience: 'staff' | 'guest', cursor: string | null) => cashier.query(
      audience === 'staff' ? api.commerce.history.staffPage : api.commerce.history.guestPage, { target, paginationOpts: { numItems: 20, cursor } });
    for (const audience of ['staff', 'guest'] as const) {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const result: Awaited<ReturnType<typeof pageOf>> = await pageOf(audience, cursor);
        expect(bytes(result)).toBeLessThanOrEqual(MAX_PAGE_BYTES);
        expect(result.page.length).toBeLessThanOrEqual(20);
        seen.push(...result.page.map(row => row.at));
        cursor = result.isDone ? null : result.continueCursor;
        expect(++pages).toBeLessThan(10);
      } while (cursor);
      expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => 1_019 - i));
      expect(pages).toBeGreaterThan(1);
    }
    // The first staff page reads one indexed range of at most 20 rows (≤ 41 documents with staff auth).
    const first = await t.run(async ctx => {
      const result = await listCommerceHistory(ctx, target, { numItems: 20, cursor: null });
      return { rows: result.page.length, documents: readBudget(ctx).documents, ranges: readBudget(ctx).ranges };
    });
    expect(first.documents).toBe(first.rows);
    expect(first.ranges).toBe(1);
  });
}
