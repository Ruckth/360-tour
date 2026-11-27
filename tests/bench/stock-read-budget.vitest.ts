// @vitest-environment edge-runtime
/**
 * Fast synthetic Stock read-budget & 1x/2x invariance regression probe (convex-test).
 * Complements the real isolated local Convex load runner (`scripts/bench/stock-load.mjs`).
 */
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { Id } from '../../convex/_generated/dataModel';
import { resolveCommerceSettings } from '../../convex/commerce/model';
import { stockSearchFields } from '../../convex/commerce/private/stockCatalog';
import * as stockEndpoints from '../../convex/commerce/stock';
import * as purchasingEndpoints from '../../convex/commerce/purchasing';
import * as retailEndpoints from '../../convex/pos/retail';
import { readBudget } from '../../convex/lib/readBudget';
import schema from '../../convex/schema';
import { seedTestBranch } from '../../convex/testing/staff.test-support';

const modules = import.meta.glob('/convex/**/*.ts');
const encoder = new TextEncoder();

type RawHandler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

function countDb<T extends object>(db: T) {
  const stats = { ranges: 0, documents: 0, bytes: 0, writes: 0 };
  const record = (doc: unknown) => {
    if (doc !== null && doc !== undefined) {
      stats.documents++;
      stats.bytes += encoder.encode(JSON.stringify(doc)).length;
    }
    return doc;
  };
  const wrapQuery = (q: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(q, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        if (prop === 'withIndex' || prop === 'withSearchIndex' || prop === 'order' || prop === 'filter') {
          return (...args: unknown[]) => wrapQuery(value.apply(target, args) as Record<string, unknown>);
        }
        if (prop === 'first' || prop === 'unique') {
          return async (...args: unknown[]) => {
            stats.ranges++;
            return record(await value.apply(target, args));
          };
        }
        if (prop === 'take' || prop === 'collect') {
          return async (...args: unknown[]) => {
            stats.ranges++;
            const rows = (await value.apply(target, args)) as unknown[];
            for (const row of rows) record(row);
            return rows;
          };
        }
        if (prop === 'paginate') {
          return async (...args: unknown[]) => {
            stats.ranges++;
            const res = (await value.apply(target, args)) as { page: unknown[] };
            for (const row of res.page) record(row);
            return res;
          };
        }
        return value.bind(target);
      },
    });
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'get') {
        return async (...args: unknown[]) => {
          stats.ranges++;
          return record(await value.apply(target, args));
        };
      }
      if (prop === 'query') {
        return (...args: unknown[]) => wrapQuery(value.apply(target, args) as Record<string, unknown>);
      }
      if (prop === 'insert' || prop === 'patch' || prop === 'replace' || prop === 'delete') {
        return async (...args: unknown[]) => {
          stats.writes++;
          return await value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
  return { db: proxy, stats };
}

describe('stock read/write budgets & 1x->2x invariance (synthetic)', () => {
  it('stays within pilot read/write budgets and <=10% read growth when history doubles', async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const setup = await t.run(async (ctx) => {
      const hotBranchId = await seedTestBranch(ctx, 'koh-samui');
      const coldBranchId = await seedTestBranch(ctx, 'phuket');
      const allBranchIds: Id<'branches'>[] = [hotBranchId, coldBranchId];
      for (let i = 0; i < 18; i++) {
        const extra = await ctx.db.insert('branches', {
          key: `extra-${i}`,
          name: `Extra Branch ${i}`,
          slug: `extra-${i}`,
          issuer: { legalName: 'Test Co', taxId: '0105559999999', branchCode: String(i + 3).padStart(5, '0'), address: 'Local' },
          state: 'active',
          stateChangedAt: now,
          stateChangedByEmail: 'owner@example.com',
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        allBranchIds.push(extra);
      }
      const roles = { requester: true, approver: true, buyer: true, receiver: true, lead: true };
      const grantId = await ctx.db.insert('staffGrants', {
        email: 'buyer20@example.com',
        role: 'manager',
        branchIds: allBranchIds,
        tokenIdentifier: 'test|buyer20',
        revision: 1,
        createdAt: now,
        updatedAt: now,
        updatedByEmail: 'owner@example.com',
      });
      await ctx.db.insert('stockGrants', {
        branchId: hotBranchId,
        staffGrantId: grantId,
        roles,
        revision: 1,
        changedBy: 'owner',
        changedAt: now,
      });
      await ctx.db.insert('stockBranchPolicies', {
        branchId: hotBranchId,
        directOrder: true,
        directReceipt: true,
        revision: 1,
        changedBy: 'owner',
        changedAt: now,
      });
      const settings = resolveCommerceSettings(null);
      await ctx.db.insert('commerceSettings', {
        key: 'default',
        ...settings,
        paymentsMode: 'attempts',
        saleSwitches: { ...settings.saleSwitches, products: 'everyone' },
      });
      const supplierId = await ctx.db.insert('suppliers', {
        name: 'Coastal Supply',
        nameKey: 'coastal supply',
        status: 'active',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      const categoryId = await ctx.db.insert('productCategories', { name: 'Retail', sort: 0 });
      const variantIds: Id<'productVariants'>[] = [];
      for (let i = 0; i < 60; i++) {
        const name = i === 0 ? 'Apex Hot Sunscreen' : i === 1 ? 'New Unstocked Serum' : `Item ${i}`;
        const sku = i === 0 ? 'HOT-SKU-0001' : i === 1 ? 'NEW-NOBAL-0002' : `SKU-${i}`;
        const productId = await ctx.db.insert('products', {
          categoryId,
          name,
          status: 'active',
          vatProfile: 'standard',
          options: [],
          minPrice: 25000,
          maxPrice: 25000,
          variantCount: 1,
          sort: i,
          revision: 1,
        });
        const label = '50ml';
        const search = stockSearchFields({ name, status: 'active' }, { label, sku, barcode: undefined });
        const variantId = await ctx.db.insert('productVariants', {
          productId,
          optionValueIds: [],
          label,
          sku,
          price: 25000,
          status: 'active',
          revision: 1,
          ...search,
        });
        variantIds.push(variantId);
        if (i !== 1) {
          await ctx.db.insert('stockLevels', {
            branchId: hotBranchId,
            productId,
            variantId,
            onHand: 500,
            revision: 1,
            needsRecount: i >= 2 && i < 30,
          });
        }
      }
      return { hotBranchId, coldBranchId, supplierId, variantIds };
    });

    const hotVariantId = setup.variantIds[0];
    const fiftyVariants = [hotVariantId, ...setup.variantIds.slice(2, 51)];

    const addHistory = async (batchTag: string, orders: number, movements: number) => {
      await t.run(async (ctx) => {
        for (let i = 0; i < orders; i++) {
          const isOpen = i < 30;
          const orderId = await ctx.db.insert('purchaseOrders', {
            branchId: setup.hotBranchId,
            reference: `PO-${batchTag}-${i}`,
            status: isOpen ? 'ordered' : 'received',
            phase: isOpen ? 'open' : 'closed',
            supplierId: setup.supplierId,
            supplier: { name: 'Coastal Supply' },
            issuedRevision: 1,
            revision: 2,
            lineCount: 2,
            openLineCount: isOpen ? 2 : 0,
            orderedUnits: 20,
            acceptedUnits: isOpen ? 0 : 20,
            dueUnits: isOpen ? 20 : 0,
            totalCost: 100000,
            createdByKey: 'test|buyer20',
            createdByLabel: 'buyer20@example.com',
            issuedAt: now + i,
            createdAt: now + i,
            updatedAt: now + i,
          });
          for (const [sort, variantId] of [hotVariantId, setup.variantIds[(i % 50) + 2]].entries()) {
            await ctx.db.insert('purchaseOrderLines', {
              orderId,
              branchId: setup.hotBranchId,
              variantId,
              item: { productName: 'Apex Hot Sunscreen', variantLabel: '50ml', sku: 'HOT-SKU-0001' },
              ordered: 10,
              cancelled: 0,
              accepted: isOpen ? 0 : 10,
              corrected: 0,
              returned: 0,
              unitCost: 5000,
              open: isOpen,
              sort,
            });
          }
        }
        for (let i = 0; i < movements; i++) {
          await ctx.db.insert('stockMovements', {
            branchId: setup.hotBranchId,
            variantId: i % 2 === 0 ? hotVariantId : setup.variantIds[(i % 50) + 2],
            delta: 1,
            before: i,
            after: i + 1,
            kind: i < 30 ? 'write_off' : 'purchase_receipt',
            sourceKey: `hist:${batchTag}:${i}`,
            actor: 'test|buyer20',
            actorLabel: 'buyer20@example.com',
            itemLabel: 'Apex Hot Sunscreen · 50ml',
            sku: 'HOT-SKU-0001',
            createdAt: now + i,
          });
        }
      });
    };

    const measureLists = async () =>
      t.run(async (ctx) => {
        const identity = {
          issuer: 'test',
          subject: 'buyer20',
          tokenIdentifier: 'test|buyer20',
          email: 'buyer20@example.com',
          emailVerified: true,
        };
        const runProbe = async (handler: RawHandler, args: Record<string, unknown>) => {
          const { db, stats } = countDb(ctx.db);
          const wrapped = { ...ctx, db, auth: { ...ctx.auth, getUserIdentity: async () => identity } };
          await handler._handler(wrapped, args);
          const budget = readBudget(wrapped);
          return { db: stats, budget: { documents: budget.documents, ranges: budget.ranges, bytes: budget.bytes } };
        };
        const page = { numItems: 25, cursor: null };
        return {
          balances_default: await runProbe(stockEndpoints.listBalances as unknown as RawHandler, { branchId: setup.hotBranchId, paginationOpts: page }),
          balances_recount: await runProbe(stockEndpoints.listBalances as unknown as RawHandler, { branchId: setup.hotBranchId, recountOnly: true, paginationOpts: page }),
          activity_hot: await runProbe(stockEndpoints.listActivity as unknown as RawHandler, { branchId: setup.hotBranchId, variantId: hotVariantId, paginationOpts: page }),
          activity_rare: await runProbe(stockEndpoints.listActivity as unknown as RawHandler, { branchId: setup.hotBranchId, kind: 'write_off', paginationOpts: page }),
          orders_open: await runProbe(purchasingEndpoints.orders as unknown as RawHandler, { branchId: setup.hotBranchId, view: { kind: 'phase', phase: 'open' }, paginationOpts: page }),
          orders_on_order: await runProbe(purchasingEndpoints.orders as unknown as RawHandler, { branchId: setup.hotBranchId, view: { kind: 'item', variantId: hotVariantId, openOnly: true }, paginationOpts: page }),
          retail_browse: await runProbe(retailEndpoints.browse as unknown as RawHandler, { branchId: setup.hotBranchId, search: '', paginationOpts: { numItems: 24, cursor: null } }),
        };
      });

    await addHistory('1x', 100, 500);
    const m1x = await measureLists();
    await addHistory('2x', 100, 500);
    const m2x = await measureLists();

    for (const [name, s1] of Object.entries(m1x)) {
      const s2 = m2x[name as keyof typeof m2x];
      expect(s1.db.documents, `${name} 1x docs`).toBeLessThanOrEqual(150);
      expect(s1.db.ranges, `${name} 1x ranges`).toBeLessThanOrEqual(60);
      expect(s1.db.bytes, `${name} 1x bytes`).toBeLessThanOrEqual(256 * 1024);
      expect(s2.db.documents, `${name} 2x docs`).toBeLessThanOrEqual(150);
      expect(s2.db.ranges, `${name} 2x ranges`).toBeLessThanOrEqual(60);
      expect(s2.db.bytes, `${name} 2x bytes`).toBeLessThanOrEqual(256 * 1024);
      if (s1.db.documents > 0) {
        expect((s2.db.documents - s1.db.documents) / s1.db.documents, `${name} 1x->2x doc growth`).toBeLessThanOrEqual(0.1);
      }
      if (s1.db.ranges > 0) {
        expect((s2.db.ranges - s1.db.ranges) / s1.db.ranges, `${name} 1x->2x range growth`).toBeLessThanOrEqual(0.1);
      }
    }

    // Full 50-line receipt budget proof (<= 350 docs read, <= 225 ranges, <= 350 writes).
    const receiptStats = await t.run(async (ctx) => {
      const orderId = await ctx.db.insert('purchaseOrders', {
        branchId: setup.hotBranchId,
        reference: 'PO-50-BUDGET',
        status: 'ordered',
        phase: 'open',
        supplierId: setup.supplierId,
        supplier: { name: 'Coastal Supply' },
        issuedRevision: 1,
        revision: 2,
        lineCount: 50,
        openLineCount: 50,
        orderedUnits: 250,
        acceptedUnits: 0,
        dueUnits: 250,
        totalCost: 1_250_000,
        createdByKey: 'test|buyer20',
        createdByLabel: 'buyer20@example.com',
        issuedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const lines: { orderLineId: Id<'purchaseOrderLines'>; accepted: number }[] = [];
      for (const [sort, variantId] of fiftyVariants.entries()) {
        const orderLineId = await ctx.db.insert('purchaseOrderLines', {
          orderId,
          branchId: setup.hotBranchId,
          variantId,
          item: { productName: 'Item', variantLabel: '50ml' },
          ordered: 5,
          cancelled: 0,
          accepted: 0,
          corrected: 0,
          returned: 0,
          unitCost: 5000,
          open: true,
          sort,
        });
        await ctx.db.insert('stockIncoming', { branchId: setup.hotBranchId, variantId, quantity: 5 });
        lines.push({ orderLineId, accepted: 5 });
      }
      const { db, stats } = countDb(ctx.db);
      const identity = {
        issuer: 'test',
        subject: 'buyer20',
        tokenIdentifier: 'test|buyer20',
        email: 'buyer20@example.com',
        emailVerified: true,
      };
      const wrapped = { ...ctx, db, auth: { ...ctx.auth, getUserIdentity: async () => identity } };
      await (purchasingEndpoints.receivePurchaseOrder as unknown as RawHandler)._handler(wrapped, {
        orderId,
        expectedIssuedRevision: 1,
        operationKey: 'synthetic-50-line-receipt',
        lines,
      });
      return stats;
    });

    expect(receiptStats.documents, '50-line receipt docs read').toBeLessThanOrEqual(350);
    expect(receiptStats.ranges, '50-line receipt ranges').toBeLessThanOrEqual(225);
    expect(receiptStats.writes, '50-line receipt writes').toBeLessThanOrEqual(350);

    // 50 tracked lines, one new lot each, with tracking on and every lot recorded. Each lot entry adds a bounded core cost
    // (tracking/lot reads, lot, lot balance and lot movement writes); PURCHASING_MAX_RECEIPT_LOTS caps entries at 100.
    // Documented bound: the untracked gate (350 docs, 225 ranges, 350 writes) plus 5 ranges and 3 writes per lot entry,
    // rounded: <= 350 docs read, <= 500 ranges, <= 500 writes. Measured 255 / 458 / 455.
    const trackedStats = await t.run(async (ctx) => {
      const orderId = await ctx.db.insert('purchaseOrders', {
        branchId: setup.hotBranchId, reference: 'PO-50-TRACKED', status: 'ordered', phase: 'open', supplierId: setup.supplierId,
        supplier: { name: 'Coastal Supply' }, issuedRevision: 1, revision: 2, lineCount: 50, openLineCount: 50, orderedUnits: 250,
        acceptedUnits: 0, dueUnits: 250, totalCost: 1_250_000, createdByKey: 'test|buyer20', createdByLabel: 'buyer20@example.com',
        issuedAt: now, createdAt: now, updatedAt: now,
      });
      const lines: { orderLineId: Id<'purchaseOrderLines'>; accepted: number; lotReceipt: { code: string; expiresAt: number } }[] = [];
      const categoryId = (await ctx.db.query('productCategories').first())!._id;
      for (let sort = 0; sort < 50; sort++) {
        // Fresh tracked items: tracking an item that already has untracked On hand needs a lot count first.
        const productId = await ctx.db.insert('products', {
          categoryId, name: `Tracked ${sort}`, status: 'active', vatProfile: 'standard', options: [], minPrice: 100, maxPrice: 100, variantCount: 1, sort, revision: 1,
        });
        const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label: '50ml', price: 100, status: 'active', revision: 1 });
        await ctx.db.insert('stockTracking', { variantId, enabledBy: 'owner', enabledAt: now });
        const orderLineId = await ctx.db.insert('purchaseOrderLines', {
          orderId, branchId: setup.hotBranchId, variantId, item: { productName: 'Item', variantLabel: '50ml' },
          ordered: 5, cancelled: 0, accepted: 0, corrected: 0, returned: 0, unitCost: 5000, open: true, sort,
        });
        await ctx.db.insert('stockIncoming', { branchId: setup.hotBranchId, variantId, quantity: 5 });
        lines.push({ orderLineId, accepted: 5, lotReceipt: { code: `LOT-${sort}`, expiresAt: now + 90 * 86_400_000 } });
      }
      const { db, stats } = countDb(ctx.db);
      const identity = { issuer: 'test', subject: 'buyer20', tokenIdentifier: 'test|buyer20', email: 'buyer20@example.com', emailVerified: true };
      const wrapped = { ...ctx, db, auth: { ...ctx.auth, getUserIdentity: async () => identity } };
      await (purchasingEndpoints.receivePurchaseOrder as unknown as RawHandler)._handler(wrapped, {
        orderId, expectedIssuedRevision: 1, operationKey: 'synthetic-50-tracked-receipt', lines,
      });
      const lots = await ctx.db.query('stockLotMovements').collect();
      return { ...stats, lotMovements: lots.length };
    });
    expect(trackedStats.lotMovements, 'every tracked line keeps its lot evidence').toBeGreaterThanOrEqual(50);
    expect(trackedStats.documents, '50-line tracked receipt docs read').toBeLessThanOrEqual(350);
    expect(trackedStats.ranges, '50-line tracked receipt ranges').toBeLessThanOrEqual(500);
    expect(trackedStats.writes, '50-line tracked receipt writes').toBeLessThanOrEqual(500);
  });
});
