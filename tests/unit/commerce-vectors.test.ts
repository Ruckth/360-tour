import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  allocateGoodwillDiscount, allocateSalePayments, assertExternalCorrection, benefitExpiresAt, benefitState,
  canSpendVoucher, canTransferSessions, DEFAULT_COMMERCE_SETTINGS, freezePackageVatBases, freezeRowVatBase,
  incrementalShare, isProtectedUnusedRefund, pointsExpireOn, quotePackageVoucherReturn, quoteSessionReturn,
  quoteStandaloneVoucherReturn, receiptVat, refundDueOn, routeReceiptRefund, splitBenefitUse,
  splitPackagePrice, splitPointsSpend,
  type BenefitState, type CommerceLine, type CommerceSettings, type CommerceTender, type ExternalTender,
  type FrozenVatBase, type PaymentRow, type ReceiptVatInput, type SessionRefundMode, type TenderCells,
  type VoucherRefundStatus,
} from '../../convex/shared/commerce';

type Sale = ReturnType<typeof splitPackagePrice>;
type Refund = ReturnType<typeof routeReceiptRefund>;
type Vat = ReturnType<typeof receiptVat>;

type Step =
  | { kind: 'package'; input: Parameters<typeof splitPackagePrice>[0]; expect: { price: number; discount: number; weights: number[]; gross: number[]; discounts: number[]; paid: number[] } }
  | { kind: 'packageVat'; expect: FrozenVatBase & { contents: FrozenVatBase[]; vat: number } }
  | { kind: 'vat'; input: ReceiptVatInput; expect: Vat }
  | { kind: 'allocate'; rows?: PaymentRow[]; tenders: CommerceTender[]; expect: { receipt: number[]; rows: number[][]; contents: (number[][] | null)[] } }
  | { kind: 'eligible'; lines: CommerceLine[]; bookingId?: string; expect: boolean }
  | { kind: 'session'; content: number; used: number; through: number; rule?: SessionRefundMode; expect: { amount: number; total: number } }
  | { kind: 'content'; content: number; through: number; spent?: number; expect: { amount: number; total: number } }
  | { kind: 'part'; key: string; share: number; units: number; through: number; expect: { amount: number; total: number } }
  | { kind: 'correct'; tenders: ExternalTender[]; expectFrozen: number[] }
  | { kind: 'refund'; expectedAmount: number; statuses?: Record<string, VoucherRefundStatus>; goodwill?: NonNullable<Parameters<typeof routeReceiptRefund>[0]['goodwill']>; expect: Refund }
  | { kind: 'benefitUse'; balances: Parameters<typeof splitBenefitUse>[0]; requested: number; expect: ReturnType<typeof splitBenefitUse> }
  | { kind: 'standalone'; input: Parameters<typeof quoteStandaloneVoucherReturn>[0]; expect: number }
  | { kind: 'state'; input: Omit<Parameters<typeof benefitState>[0], 'expiresAt'> & { expiresAt: string | null }; now: string; expect: BenefitState }
  | { kind: 'dates'; lastPurchase: string; soldAt: string; cancelledOn: string; expect: { sessions: string | null; voucher: string | null; card: string; cash: string; points: string } }
  | { kind: 'rights'; input: Parameters<typeof isProtectedUnusedRefund>[0]; expect: { protected: boolean; transfer: boolean } }
  | { kind: 'points'; net: number; spend: number; expect: Vat & { discount: number; payment: number; due: number } }
  | { kind: 'goodwill'; net: number; amount: number; expect: Vat & { due: number } }
  | { kind: 'deferredUse'; paidUses: number; expectedAmount: number; expect: Vat };

type Scenario = { name: string; settings?: Partial<CommerceSettings>; steps: Step[] };
const scenarios: Scenario[] = JSON.parse(readFileSync(new URL('../fixtures/commerce-vectors.json', import.meta.url), 'utf8'));

const cellValues = (cells: TenderCells) => [...cells.vouchers.map(({ amount }) => amount), cells.external];
const iso = (timestamp: number | null) => timestamp === null ? null : new Date(timestamp).toISOString();

test.each(scenarios)('$name', ({ settings: overrides, steps }) => {
  const settings: CommerceSettings = { ...DEFAULT_COMMERCE_SETTINGS, ...overrides };
  let sale: Sale | undefined;
  let payments: ReturnType<typeof allocateSalePayments> | undefined;
  let effectiveTenders: ExternalTender[] = [];
  let externalRefunded = 0;
  let pendingRefund = 0;
  let priorPaidUses = 0;
  const voucherCredited = new Map<string, number>();
  const priorUnits = new Map<string | number, number>();
  const sold = () => {
    if (!sale) throw new Error('Vector needs a package sale first');
    return sale;
  };
  const allocated = () => {
    if (!payments) throw new Error('Vector needs a payment allocation first');
    return payments;
  };

  for (const [index, step] of steps.entries()) {
    const message = `Step ${index + 1} (${step.kind})`;
    switch (step.kind) {
      case 'package': {
        sale = splitPackagePrice(step.input, settings);
        expect({
          price: sale.net, discount: sale.staffDiscount, weights: sale.shares.map((share) => share.normalValue),
          gross: sale.shares.map((share) => share.grossShare), discounts: sale.shares.map((share) => share.staffDiscount),
          paid: sale.shares.map((share) => share.paidShare),
        }, message).toEqual(step.expect);
        break;
      }
      case 'packageVat': {
        const bases = freezePackageVatBases(sold().shares, settings);
        const { vat } = receiptVat({ vatVersion: 2, lines: [bases] });
        expect({ ...bases, vat }, message).toEqual(step.expect);
        break;
      }
      case 'vat':
        expect(receiptVat(step.input), message).toEqual(step.expect);
        break;
      case 'allocate': {
        const rows = step.rows ?? [{ net: sold().net, contentPaidShares: sold().shares.map(({ paidShare }) => paidShare) }];
        payments = allocateSalePayments(rows, step.tenders);
        effectiveTenders = step.tenders.filter((tender) => tender.method !== 'voucher');
        expect({
          receipt: cellValues(payments.receipt), rows: payments.rows.map(({ cells }) => cellValues(cells)),
          contents: payments.rows.map(({ contents }) => contents?.map(cellValues) ?? null),
        }, message).toEqual(step.expect);
        const voucherIds = step.tenders.flatMap((tender) => tender.method === 'voucher' ? [tender.voucherId] : []);
        for (const cells of [payments.receipt, ...payments.rows.flatMap((row) => [row.cells, ...(row.contents ?? [])])]) {
          expect(cells.vouchers.map(({ voucherId }) => voucherId), message).toEqual(voucherIds);
        }
        break;
      }
      case 'eligible':
        expect(canSpendVoucher(step.lines, step.bookingId), message).toBe(step.expect);
        break;
      case 'part':
      case 'session':
      case 'content': {
        const key = step.kind === 'part' ? step.key : step.content;
        const unitsBefore = priorUnits.get(key) ?? 0;
        const unitsThrough = step.through;
        let result;
        if (step.kind === 'part') {
          result = incrementalShare(step.share, { unitsSold: step.units, unitsBefore, unitsThrough });
        } else {
          const content = sold().shares[step.content];
          if (step.kind === 'session' && content.kind === 'sessions') {
            result = quoteSessionReturn({
              paidShare: content.paidShare, normalUnitPrice: content.normalUnitPrice, paidUnitsUsed: step.used,
              unitsSold: content.units, unitsBefore, unitsThrough,
            }, { sessionRefundMode: step.rule ?? 'paid_share' });
          } else if (step.kind === 'content' && content.kind === 'voucher') {
            result = quotePackageVoucherReturn({
              paidShare: content.paidShare, face: content.face, faceSpent: step.spent ?? 0,
              faceReturned: unitsBefore, faceThrough: unitsThrough,
            });
          } else if (step.kind === 'content' && content.kind === 'product') {
            result = incrementalShare(content.paidShare, { unitsSold: content.units, unitsBefore, unitsThrough });
          } else {
            throw new Error('Return vector does not match the content kind');
          }
        }
        expect(result, message).toEqual(step.expect);
        priorUnits.set(key, unitsThrough);
        pendingRefund += result.amount;
        break;
      }
      case 'correct': {
        const receipt = allocated().receipt;
        assertExternalCorrection(receipt.external, step.tenders, receipt.vouchers.length);
        effectiveTenders = step.tenders;
        expect(cellValues(receipt), message).toEqual(step.expectFrozen);
        break;
      }
      case 'refund': {
        expect(pendingRefund, message).toBe(step.expectedAmount);
        const original = structuredClone(allocated());
        const refund = routeReceiptRefund({
          amount: pendingRefund, externalTenders: effectiveTenders, externalRefunded, goodwill: step.goodwill,
          vouchers: allocated().receipt.vouchers.map(({ voucherId, amount }) => ({
            voucherId, paid: amount, credited: voucherCredited.get(voucherId) ?? 0, status: step.statuses?.[voucherId] ?? 'active',
          })),
        });
        expect(refund, message).toEqual(step.expect);
        expect(allocated(), message).toEqual(original);
        externalRefunded += refund.external?.amount ?? 0;
        for (const { voucherId, amount } of refund.voucherCredits) {
          voucherCredited.set(voucherId, (voucherCredited.get(voucherId) ?? 0) + amount);
        }
        pendingRefund = 0;
        break;
      }
      case 'benefitUse':
        expect(splitBenefitUse(step.balances, step.requested), message).toEqual(step.expect);
        break;
      case 'standalone':
        expect(quoteStandaloneVoucherReturn(step.input), message).toBe(step.expect);
        break;
      case 'state':
        expect(benefitState({
          ...step.input, expiresAt: step.input.expiresAt === null ? null : Date.parse(step.input.expiresAt),
        }, Date.parse(step.now), settings), message).toBe(step.expect);
        break;
      case 'dates': {
        const soldAt = Date.parse(step.soldAt);
        expect({
          sessions: iso(benefitExpiresAt(soldAt, 'sessions', settings)),
          voucher: iso(benefitExpiresAt(soldAt, 'voucher', settings)),
          card: refundDueOn(step.cancelledOn, 'card', settings),
          cash: refundDueOn(step.cancelledOn, 'cash', settings),
          points: pointsExpireOn(step.lastPurchase, settings),
        }, message).toEqual(step.expect);
        break;
      }
      case 'rights':
        expect({ protected: isProtectedUnusedRefund(step.input, settings), transfer: canTransferSessions(settings) }, message).toEqual(step.expect);
        break;
      case 'points': {
        const points = splitPointsSpend(step.net, step.spend, settings);
        const base = freezeRowVatBase({ kind: 'taxable', net: step.net, pointsDiscount: points.discount });
        expect({
          ...receiptVat({ vatVersion: 2, lines: [base] }), ...points, due: base.vatBase - points.payment,
        }, message).toEqual(step.expect);
        break;
      }
      case 'goodwill': {
        const [goodwillDiscount] = allocateGoodwillDiscount(step.amount, [step.net]);
        const base = freezeRowVatBase({ kind: 'taxable', net: step.net, goodwillDiscount });
        expect({ ...receiptVat({ vatVersion: 2, lines: [base] }), due: step.net - goodwillDiscount }, message).toEqual(step.expect);
        break;
      }
      case 'deferredUse': {
        const shares = sold().shares;
        const session = shares[0];
        if (session.kind !== 'sessions') throw new Error('VAT use vector needs a session as the first content');
        const { deferredVatBase } = freezePackageVatBases(shares, settings).contents[0];
        const use = incrementalShare(deferredVatBase, { unitsSold: session.units, unitsBefore: priorPaidUses, unitsThrough: step.paidUses });
        expect(use.amount, message).toBe(step.expectedAmount);
        expect(receiptVat({ vatVersion: 2, lines: [{ vatBase: use.amount }] }), message).toEqual(step.expect);
        priorPaidUses = step.paidUses;
        break;
      }
    }
  }
  expect(pendingRefund, 'All quotes in a vector are routed').toBe(0);
});
