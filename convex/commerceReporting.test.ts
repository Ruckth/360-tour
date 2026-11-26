// @vitest-environment edge-runtime
import { seedTestBranch, asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { ReadBudget } from './lib/readBudget';
import { creditMoney, syncAffiliateCredit } from './marketing/affiliateCredits';
import { readMarketingReport } from './marketing/reportRead';
import schema from './schema';
import { projectTender } from './shared/tenderProjection';

const modules = import.meta.glob('./**/*.ts');
const email = 'reporting@example.com';
const soldAt = Date.parse('2026-11-09T16:59:59Z');
const redeemedAt = soldAt + 1_000;
const paidBackAt = redeemedAt + 86_400_000;
const saleDay = '2026-11-09';
const redeemDay = '2026-11-10';
const payoutDay = '2026-11-11';

type SaleSnapshot = NonNullable<Doc<'orderLines'>['saleSnapshot']>;
const terms: SaleSnapshot['terms'] = {
	preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 },
	packageValidityDays: 180, voucherValidityDays: 365, allowSessionTransfer: true,
	packageSplit: 'voucherFaceValue', packageVatTiming: 'atSale', pointsVatTreatment: 'discount', pointsExpiryMonths: 12,
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(soldAt);
});
afterEach(() => {
	vi.useRealTimers();
});

async function order(ctx: MutationCtx, total: number, fields: Partial<Pick<Doc<'orders'>, 'vatVersion' | 'returnedTotal' | 'affiliateSnapshot' | 'amendedTenders'>> = {}) {
	const at = Date.now();
	return ctx.db.insert('orders', {
		status: 'paid', currency: 'THB', total, orderNumber: 1, itemCount: 1, due: 0, hasItems: true,
		revision: 1, paidAt: at, createdAt: at, updatedAt: at, createdBy: email, ...fields,
	});
}

async function line(ctx: MutationCtx, orderId: Id<'orders'>, kind: Doc<'orderLines'>['kind'], price: number, saleSnapshot?: SaleSnapshot) {
	return ctx.db.insert('orderLines', { orderId, kind, name: kind, unitPrice: price, catalogUnitPrice: price, currency: 'THB', qty: 1, saleSnapshot, createdAt: Date.now() });
}

function allocation(paidShare: number, vatBase: number, tenderCells: SaleSnapshot['tenderCells']) {
	return { paidShare, vatBase, tenderCells, returnedUnits: 0, returnedAmount: 0 };
}

function snapshot(paidShare: number, vatBase: number, tenderCells: SaleSnapshot['tenderCells']): SaleSnapshot {
	return { label: 'Frozen', settingsRevision: 1, terms, ...allocation(paidShare, vatBase, tenderCells), chosenVariants: [], contents: [], goodwillDiscounts: [] };
}

async function payment(ctx: MutationCtx, orderId: Id<'orders'>, tender: { method: 'cash' | 'card'; amount: number } | { method: 'voucher'; amount: number; voucherId: Id<'vouchers'> }) {
	const at = Date.now();
	return ctx.db.insert('orderPayments', { orderId, ...tender, idempotencyKey: `${orderId}:${tender.method}`, createdBy: email, createdAt: at, effectiveAt: at });
}

async function voucher(ctx: MutationCtx, source: Doc<'vouchers'>['source'], amount: number) {
	const branchId = await seedTestBranch(ctx);
	return ctx.db.insert('vouchers', {
		source, faceValue: amount, paidBalance: amount, goodwillBalance: 0,
		issuedExpiresAt: soldAt + 365 * 86_400_000, effectiveExpiresAt: soldAt + 365 * 86_400_000,
		status: 'active', branchId, revision: 1, settingsRevision: 1, terms,
	});
}

async function voucherEntry(ctx: MutationCtx, voucherId: Id<'vouchers'>, kind: Doc<'voucherEntries'>['kind'], before: number, after: number, createdAt = Date.now()) {
	return ctx.db.insert('voucherEntries', {
		voucherId, kind, sourceKey: `${voucherId}:${kind}`, before: { paid: before, goodwill: 0 },
		after: { paid: after, goodwill: 0 }, actor: email, guestFact: 'Private fixture text', createdAt,
	});
}

async function affiliate(ctx: MutationCtx): Promise<NonNullable<Doc<'orders'>['affiliateSnapshot']>> {
	const changes = { createdAt: soldAt, updatedAt: soldAt, updatedByEmail: email };
	const campaignId = await ctx.db.insert('marketingCampaigns', { name: 'Referral', source: 'partner', medium: 'link', status: 'active', ...changes });
	const affiliateId = await ctx.db.insert('marketingAffiliates', { campaignId, name: 'Partner', slug: 'partner', status: 'active', ...changes });
	return { capturedAt: soldAt, affiliateId, flags: [], candidates: [{ affiliateId, name: 'Partner', slug: 'partner', origin: 'link', eligible: true }] };
}

async function setup() {
	const t = convexTest(schema, modules);
	const admin = await asTestOwner(t, { email, emailVerified: true, tokenIdentifier: 'reporting' });
	const report = (from: string, to = from, basis: 'cash' | 'cohort' = 'cash') =>
		admin.query(api.marketing.report.getReport, { from, to, basis });
	return { t, report };
}

it('counts a voucher sale once and shows the voucher-only sale across the Bangkok day boundary', async () => {
	const { t, report } = await setup();
	const sold = await t.run(async ctx => {
		const affiliateSnapshot = await affiliate(ctx);
		const orderId = await order(ctx, 100_000, { vatVersion: 2, affiliateSnapshot });
		const lineId = await line(ctx, orderId, 'voucher', 100_000, snapshot(100_000, 0, [{ kind: 'external', amount: 100_000 }]));
		const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId }, 100_000);
		await voucherEntry(ctx, voucherId, 'issue', 0, 100_000);
		await payment(ctx, orderId, { method: 'card', amount: 100_000 });
		return { orderId, voucherId, affiliateSnapshot, creditId: await syncAffiliateCredit(ctx, { orderId }) };
	});
	vi.setSystemTime(redeemedAt);
	const redeemed = await t.run(async ctx => {
		const orderId = await order(ctx, 100_000, { vatVersion: 2, affiliateSnapshot: sold.affiliateSnapshot });
		await line(ctx, orderId, 'service', 100_000, snapshot(100_000, 100_000, [{ kind: 'voucher', voucherId: sold.voucherId, amount: 100_000 }]));
		await payment(ctx, orderId, { method: 'voucher', voucherId: sold.voucherId, amount: 100_000 });
		await voucherEntry(ctx, sold.voucherId, 'spend', 100_000, 0);
		return { orderId, creditId: await syncAffiliateCredit(ctx, { orderId }) };
	});

	const result = await report(saleDay, redeemDay);
	expect(result.events).toEqual([{ saleId: sold.orderId, kind: 'payment', day: saleDay, amount: 100_000 }]);
	expect(result.sales).toMatchObject([
		{ id: sold.orderId, collected: 100_000, saleValue: 100_000, vatBase: 0, vat: 0 },
		{ id: redeemed.orderId, collected: 0, saleValue: 100_000, vatBase: 100_000, vat: 6542 },
	]);
	expect(result).toMatchObject({
		tenderByDay: [{ day: saleDay, method: 'card', moneyIn: 100_000, moneyOut: 0 }],
		voucherByDay: [
			{ day: saleDay, kind: 'issued', paid: 100_000, goodwill: 0 },
			{ day: redeemDay, kind: 'redeemed', paid: 100_000, goodwill: 0 },
		],
	});
	expect(sold.creditId).not.toBeNull();
	expect(redeemed.creditId).toBeNull();
	expect(await t.run(ctx => creditMoney(ctx, { orderId: sold.orderId }))).toEqual({ eligible: true, net: 100_000 });
	expect(await t.run(ctx => creditMoney(ctx, { orderId: redeemed.orderId }))).toEqual({ eligible: false, net: 0 });
});

it('reports an imported voucher spend on the Bangkok ledger day', async () => {
	const { t, report } = await setup();
	const voucherId = await t.run(async ctx => {
		const orderId = await order(ctx, 50_000);
		const lineId = await line(ctx, orderId, 'voucher', 50_000);
		return await voucher(ctx, { kind: 'sale', orderId, lineId }, 50_000);
	});
	vi.setSystemTime(paidBackAt);
	await t.run(ctx => voucherEntry(ctx, voucherId, 'spend', 50_000, 37_655, redeemedAt));
	expect(await report(redeemDay)).toMatchObject({
		truncated: false, voucherByDay: [{ day: redeemDay, kind: 'redeemed', paid: 12_345, goodwill: 0 }],
	});
	expect(await report(payoutDay)).toMatchObject({ voucherByDay: [] });
});

it('projects mixed commerce rows, reconciles paid and goodwill voucher value, and uses the payout day', async () => {
	const { t, report } = await setup();
	const seeded = await t.run(async ctx => {
		const affiliateSnapshot = await affiliate(ctx);
		const issuing = await order(ctx, 690_000, { vatVersion: 2, affiliateSnapshot });
		const packageId = await ctx.db.insert('packages', { name: 'Gold', status: 'active', sort: 0, revision: 1 });
		const packageVersionId = await ctx.db.insert('packageVersions', {
			packageId, version: 1, name: 'Gold', price: 690_000, validityDays: 180, allowTransfer: true,
			contents: [{ kind: 'session', contentKey: 'spa', units: 5, serviceIds: [] }, { kind: 'voucher', contentKey: 'gift', faceValue: 50_000 }],
			estimatedSplit: [{ contentKey: 'spa', amount: 640_000 }, { contentKey: 'gift', amount: 50_000 }],
		});
		const pkg = snapshot(690_000, 640_000, [{ kind: 'external', amount: 690_000 }]);
		const packageLine = await line(ctx, issuing, 'package', 800_000, pkg);
		const voucherId = await voucher(ctx, { kind: 'package', orderId: issuing, lineId: packageLine, contentKey: 'gift', packageVersionId }, 50_000);
		await ctx.db.patch(packageLine, { packageVersionId, saleSnapshot: { ...pkg, contents: [
			{ ...allocation(640_000, 640_000, [{ kind: 'external', amount: 640_000 }]), label: 'Spa', contentKey: 'spa', units: 5, vatProfile: 'standard' },
			{ ...allocation(50_000, 0, [{ kind: 'external', amount: 50_000 }]), label: 'Gift', contentKey: 'gift', units: 1, vatProfile: 'exempt', voucherId },
		] } });
		await voucherEntry(ctx, voucherId, 'issue', 0, 50_000);
		await payment(ctx, issuing, { method: 'card', amount: 690_000 });

		const service = await order(ctx, 98_000, { vatVersion: 2, affiliateSnapshot, amendedTenders: [{ method: 'cash', amount: 48_000 }] });
		const serviceLine = await line(ctx, service, 'service', 60_000, {
			...snapshot(40_000, 40_000, [{ kind: 'external', amount: 30_000 }, { kind: 'voucher', voucherId, amount: 10_000 }]),
			goodwillDiscounts: [{ voucherId, amount: 20_000 }],
		});
		const productLine = await line(ctx, service, 'product', 58_000, snapshot(58_000, 58_000, [
			{ kind: 'external', amount: 18_000 }, { kind: 'voucher', voucherId, amount: 40_000 },
		]));
		await payment(ctx, service, { method: 'card', amount: 48_000 });
		await payment(ctx, service, { method: 'voucher', voucherId, amount: 50_000 });
		const creditId = await syncAffiliateCredit(ctx, { orderId: service });
		if (!creditId) throw new Error('Expected the service share to earn affiliate credit');
		await ctx.db.patch(creditId, { state: 'approved', approvedNet: 30_000 });
		await ctx.db.insert('voucherEntries', {
			voucherId, kind: 'spend', sourceKey: 'mixed-spend', createdAt: soldAt, actor: email, guestFact: '',
			before: { paid: 50_000, goodwill: 20_000 }, after: { paid: 0, goodwill: 0 },
		});
		await ctx.db.insert('commerceAdjustments', {
			targetType: 'voucher', targetId: voucherId, kind: 'addGoodwill', before: {}, after: {},
			revisionBefore: 1, revisionAfter: 2, paidLiabilityDelta: 0, goodwillFaceValueDelta: 20_000, quantityDelta: 0,
			reasonCode: 'service_recovery', reasonText: 'Private notes', actor: email, actorLabel: email,
			requesterKey: email, clientKey: 'goodwill', fingerprint: 'goodwill', recordedAt: soldAt, businessDate: saleDay,
		});
		const returnId = await ctx.db.insert('orderReturns', {
			orderId: service, key: 'return', fingerprint: 'return', parts: [{ kind: 'line', lineId: productLine, units: 1 }, { kind: 'line', lineId: serviceLine, units: 1 }],
			effectsApplied: [], claims: [{ key: 'cash', method: 'cash', amount: 48_000, operator: email, state: 'instructed', dueAt: paidBackAt }],
			voucherCredits: [{ voucherId, paid: 50_000, goodwill: 20_000 }], status: 'authorized',
			operator: email, tillId: 'one', operatorRevision: 0, reason: 'Return items', createdAt: soldAt,
		});
		return { issuing, service, serviceLine, productLine, returnId, voucherId, creditId };
	});
	expect(await t.run(ctx => creditMoney(ctx, { orderId: seeded.issuing }))).toEqual({ eligible: false, net: 0 });
	expect(await t.run(ctx => creditMoney(ctx, { orderId: seeded.service }))).toEqual({ eligible: true, net: 30_000 });
	const authorized = await report(saleDay);
	expect(authorized.events).toEqual([
		{ saleId: seeded.issuing, kind: 'payment', day: saleDay, amount: 690_000 },
		{ saleId: seeded.service, kind: 'payment', day: saleDay, amount: 48_000 },
	]);
	expect(authorized.sales).toMatchObject([
		{ id: seeded.issuing, saleValue: 690_000, vatBase: 640_000, vat: 41_869, refunded: 0 },
		{ id: seeded.service, saleValue: 98_000, vatBase: 98_000, refunded: 0 },
	]);
	expect(authorized).toMatchObject({
		tenderByDay: [
			{ day: saleDay, method: 'card', moneyIn: 690_000, moneyOut: 0 },
			{ day: saleDay, method: 'cash', moneyIn: 48_000, moneyOut: 0 },
		],
		goodwillByDay: [{ day: saleDay, target: 'voucher', reasonCode: 'service_recovery', units: 0, faceValue: 20_000 }],
		voucherByDay: [
			{ day: saleDay, kind: 'issued', paid: 50_000, goodwill: 0 },
			{ day: saleDay, kind: 'redeemed', paid: 50_000, goodwill: 20_000 },
		],
	});
	expect(JSON.stringify(authorized)).not.toContain('Private notes');

	vi.setSystemTime(paidBackAt);
	await t.run(async ctx => {
		const { service: orderId, serviceLine, productLine, returnId, voucherId } = seeded;
		await ctx.db.insert('returnPayouts', {
			returnId, key: 'completed-cash', destinationKey: 'cash', amount: 48_000, method: 'cash', businessDate: payoutDay,
			sourceOwner: { kind: 'pos' }, operator: email, createdAt: paidBackAt,
		});
		const mirror = { orderId, returnId, currency: 'THB', reason: 'Return', createdBy: email, createdByEmail: email, createdAt: paidBackAt, businessDate: payoutDay };
		await ctx.db.insert('orderRefunds', { ...mirror, lineId: productLine, amount: 18_000, method: 'cash', idempotencyKey: 'external-product' });
		await ctx.db.insert('orderRefunds', { ...mirror, lineId: serviceLine, amount: 30_000, method: 'cash', idempotencyKey: 'external-service' });
		await ctx.db.insert('orderRefunds', { ...mirror, lineId: productLine, amount: 40_000, method: 'voucher', voucherId, idempotencyKey: 'voucher-product' });
		const replacement = await voucher(ctx, { kind: 'refund_credit', voucherId, orderId, returnId }, 50_000);
		await voucherEntry(ctx, replacement, 'issue', 0, 50_000);
		await ctx.db.patch(orderId, { returnedTotal: 48_000 });
		const item = (await ctx.db.get(returnId))!;
		await ctx.db.patch(returnId, { status: 'completed', completedAt: paidBackAt, claims: item.claims.map(claim => ({ ...claim, state: 'given' })) });
		await syncAffiliateCredit(ctx, { orderId });
		await syncAffiliateCredit(ctx, { orderId });
	});
	expect((await report(saleDay)).events).toEqual(authorized.events);
	const completed = await report(payoutDay);
	expect(completed.events).toEqual([{ saleId: seeded.service, kind: 'refund', day: payoutDay, amount: 48_000 }]);
	expect(completed).toMatchObject({
		tenderByDay: [{ day: payoutDay, method: 'cash', moneyIn: 0, moneyOut: 48_000 }],
		voucherByDay: [{ day: payoutDay, kind: 'credited', paid: 50_000, goodwill: 0 }],
	});
	expect((await report(saleDay, saleDay, 'cohort')).sales).toMatchObject([
		{ id: seeded.issuing, refunded: 0 },
		{ id: seeded.service, refunded: 48_000 },
	]);
	expect(await t.run(ctx => creditMoney(ctx, { orderId: seeded.service }))).toEqual({ eligible: false, net: 0 });
	expect(await t.run(ctx => ctx.db.get(seeded.creditId))).toMatchObject({ state: 'reversed', eligibleNet: 0, approvedNet: 0, revision: 1 });
});

it('reports a pre-commerce refund unchanged and reads zero of 900 unrelated old refunds', async () => {
	const { t } = await setup();
	const refundFields = { currency: 'THB', method: 'cash' as const, reason: 'Return', createdBy: email, createdByEmail: email };
	const orderId = await t.run(async ctx => {
		const orderId = await order(ctx, 90_000);
		const lineId = await line(ctx, orderId, 'extra', 90_000);
		await payment(ctx, orderId, { method: 'cash', amount: 90_000 });
		await ctx.db.insert('orderRefunds', { ...refundFields, orderId, lineId, amount: 5000, createdAt: soldAt, businessDate: saleDay, idempotencyKey: 'pre-commerce' });
		return orderId;
	});
	const args = { from: saleDay, to: saleDay, basis: 'cash' as const };
	const before = new ReadBudget();
	const baseline = await t.run(ctx => readMarketingReport(ctx, args, before));
	const oldAt = Date.parse('2025-11-08T00:00:00Z');
	vi.setSystemTime(oldAt);
	await t.run(async ctx => {
		const oldOrderId = await order(ctx, 10_000);
		const lineId = await line(ctx, oldOrderId, 'extra', 10_000);
		for (let i = 0; i < 900; i++) {
			await ctx.db.insert('orderRefunds', { ...refundFields, orderId: oldOrderId, lineId, amount: 1, createdAt: oldAt, businessDate: '2025-11-08', idempotencyKey: `old-${i}` });
		}
	});
	vi.setSystemTime(soldAt);
	const after = new ReadBudget(10, 50, 10_000);
	const actual = await t.run(ctx => readMarketingReport(ctx, args, after));
	expect(actual).toEqual(baseline);
	expect(actual.truncated).toBe(false);
	expect(actual.events).toEqual([
		{ saleId: orderId, kind: 'payment', day: saleDay, amount: 90_000 },
		{ saleId: orderId, kind: 'refund', day: saleDay, amount: 5000 },
	]);
	expect({ documents: after.documents, ranges: after.ranges, bytes: after.bytes }).toEqual({
		documents: before.documents, ranges: before.ranges, bytes: before.bytes,
	});
	expect(after.documents).toBeLessThanOrEqual(5);
});

it('reports the frozen VAT on a prepaid session taxed at use without adding cash', async () => {
	const { t, report } = await setup();
	const orderId = await t.run(async ctx => {
		const orderId = await order(ctx, 0, { vatVersion: 2 });
		await line(ctx, orderId, 'appointment', 0, {
			...snapshot(0, 50_000, []),
			terms: { ...terms, packageVatTiming: 'atUse' },
		});
		return orderId;
	});
	const result = await report(saleDay);
	expect(result.sales).toMatchObject([{ id: orderId, collected: 0, saleValue: 0, vatBase: 50_000, vat: 3271 }]);
	expect(result.events).toEqual([]);
});

it('projects a return-tagged appointment mirror once from the payout, keeping the original date for pre-commerce refunds', () => {
	const projection = projectTender({
		refunds: [
			{ method: 'card', date: redeemedAt, amount: 260_000, returnId: 'appointment-mirror' },
			{ method: 'cash', date: soldAt, amount: 20_000 },
		],
		payouts: [{ method: 'card', businessDate: payoutDay, amount: 60_000 }],
	});
	expect(projection.refunded).toBe(80_000);
	expect(projection.moneyOut).toEqual([
		{ kind: 'refund', method: 'cash', day: saleDay, amount: 20_000 },
		{ kind: 'refund', method: 'card', day: payoutDay, amount: 60_000 },
	]);
});
