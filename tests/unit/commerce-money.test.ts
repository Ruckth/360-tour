import { expect, test } from 'vitest';
import {
  allocateGoodwillDiscount, allocateSalePayments, apportionMoney, assertCommerceCaps, assertExternalCorrection,
  assertStandaloneVoucherPrice, benefitExpiresAt, canSpendVoucher, commerceLineEligibility, COMMERCE_LIMITS,
  DEFAULT_COMMERCE_SETTINGS, freezePackageVatBases, freezeRowVatBase, incrementalShare, quotePackageVoucherReturn,
  quoteSessionReturn, routeReceiptRefund, splitPackagePrice,
  type CommerceCapsInput, type CommerceLine, type CommerceTender, type TenderCells,
} from '../../convex/shared/commerce';

test('sale, package, return and catalogue caps accept the boundary and reject overflow', () => {
  const { sale, product, category } = COMMERCE_LIMITS;
  const saleAtLimit = { kind: 'sale', ...sale, productQuantities: [99], rowSnapshotBytes: [8192] } satisfies CommerceCapsInput;
  const packageAtLimit = { kind: 'package', contents: 20, choosableProducts: 3, servicesPerGrant: [10], productQuantities: [99] } satisfies CommerceCapsInput;
  const returnAtLimit = { kind: 'return', ...COMMERCE_LIMITS.return } satisfies CommerceCapsInput;

  for (const cap of [saleAtLimit, packageAtLimit, returnAtLimit, { kind: 'product', ...product }, { kind: 'category', ...category }] satisfies CommerceCapsInput[]) {
    expect(() => assertCommerceCaps(cap)).not.toThrow();
    for (const [field, value] of Object.entries(cap)) {
      if (typeof value === 'number') expect(() => assertCommerceCaps({ ...cap, [field]: value + 1 })).toThrow(field);
    }
  }
  expect(() => assertCommerceCaps({ ...saleAtLimit, rowSnapshotBytes: [8193] })).toThrow('rowSnapshotBytes');
  expect(() => assertCommerceCaps({ ...saleAtLimit, productQuantities: [100] })).toThrow('productQuantity');
  expect(() => assertCommerceCaps({ ...packageAtLimit, servicesPerGrant: [11] })).toThrow('servicesPerGrant');
  expect(() => assertCommerceCaps({ ...packageAtLimit, contents: 0 })).toThrow('contents');
});

test('discounts and voucher spend preserve existing rules and exclude issuing carts and stays', () => {
  const cases: [CommerceLine, boolean, boolean, boolean][] = [
    [{ kind: 'service' }, true, true, true],
    [{ kind: 'appointment' }, true, true, true],
    [{ kind: 'appointment', fee: true }, false, true, true],
    [{ kind: 'appointment', covered: true }, false, false, false],
    [{ kind: 'extra' }, false, true, true],
    [{ kind: 'booking' }, false, false, false],
    [{ kind: 'room' }, false, true, false],
    [{ kind: 'product', roomCharge: true }, false, true, false],
    [{ kind: 'product' }, false, true, true],
    [{ kind: 'package' }, false, true, true],
    [{ kind: 'package', issuesVoucher: true }, false, true, false],
    [{ kind: 'voucher' }, false, false, false],
  ];
  for (const [line, coupon, staffDiscount, voucherSpend] of cases) {
    expect(commerceLineEligibility(line)).toEqual({ coupon, staffDiscount, voucherSpend });
  }
  expect(canSpendVoucher([{ kind: 'product' }, { kind: 'package' }])).toBe(true);
  expect(canSpendVoucher([{ kind: 'product' }], 'booking')).toBe(false);
  expect(canSpendVoucher([{ kind: 'product' }, { kind: 'voucher' }])).toBe(false);
  expect(canSpendVoucher([{ kind: 'product' }, { kind: 'room' }])).toBe(false);
  expect(canSpendVoucher([{ kind: 'appointment', covered: true }])).toBe(false);
});

test('allocation rejects inconsistent rows, tenders and goodwill capacities', () => {
  const voucher = { method: 'voucher', voucherId: 'a', amount: 1 } as const;
  expect(() => allocateSalePayments([{ net: 2 }], [voucher, voucher])).toThrow('only once');
  expect(() => allocateSalePayments([{ net: 1, deposit: 2 }], [])).toThrow('deposit');
  expect(() => allocateSalePayments([{ net: 2, contentPaidShares: [1] }], [{ method: 'cash', amount: 2 }])).toThrow('capacity');
  expect(() => allocateSalePayments([{ net: 1 }], [{ method: 'cash', amount: 2 }])).toThrow('capacity');
  expect(() => allocateGoodwillDiscount(2, [1])).toThrow('eligible');
  expect(allocateGoodwillDiscount(1, [1, 1])).toEqual([1, 0]);
  expect(allocateSalePayments([{ net: 0 }], [])).toEqual({ receipt: { vouchers: [], external: 0 }, rows: [{ cells: { vouchers: [], external: 0 } }] });
});

test('money wrappers enforce frozen sale and reversal boundaries', () => {
  const voucher = { contentKey: 'gift', kind: 'voucher', face: 100 } as const;
  const product = { contentKey: 'product', kind: 'product', quantity: 1, variantUnitPrice: 10 } as const;
  expect(() => assertStandaloneVoucherPrice(100, 100)).not.toThrow();
  expect(() => assertStandaloneVoucherPrice(100, 99)).toThrow('face value');
  expect(() => splitPackagePrice({ price: 99, contents: [voucher, product] }, DEFAULT_COMMERCE_SETTINGS)).toThrow('below its voucher');
  expect(() => splitPackagePrice({ price: 101, contents: [voucher] }, DEFAULT_COMMERCE_SETTINGS)).toThrow('positive normal price');
  expect(() => splitPackagePrice({ price: 100, contents: [voucher, voucher] }, DEFAULT_COMMERCE_SETTINGS)).toThrow('unique');
  expect(() => apportionMoney(1, [0, 0])).toThrow('positive weight');
  expect(() => apportionMoney(0.5, [1])).toThrow('decimal places');
  expect(() => incrementalShare(1, { unitsSold: 2, unitsBefore: 1, unitsThrough: 0 })).toThrow('Target units');
  expect(() => quotePackageVoucherReturn({
    paidShare: 90, face: 100, faceSpent: 60, faceReturned: 20, faceThrough: 41,
  })).toThrow('face to revoke');
  expect(quoteSessionReturn({
    paidShare: 100, normalUnitPrice: 110, paidUnitsUsed: 1, unitsSold: 2, unitsBefore: 0, unitsThrough: 1,
  }, { sessionRefundMode: 'normal_price' })).toEqual({ amount: 0, total: 0 });
  expect(() => assertExternalCorrection(1, [{ method: 'cash', amount: 2 }], 1)).toThrow('match');
  expect(() => assertExternalCorrection(2, [{ method: 'cash', amount: 1 }, { method: 'card', amount: 1 }], 2)).toThrow('at most three');
  expect(() => routeReceiptRefund({ amount: 2, vouchers: [], externalTenders: [{ method: 'card', amount: 3 }], externalRefunded: 2 })).toThrow('remaining');
  expect(routeReceiptRefund({
    amount: 2,
    vouchers: [],
    externalTenders: [{ method: 'card', amount: 1 }, { method: 'cash', amount: 1 }, { method: 'cash', amount: 1 }],
    externalRefunded: 0,
  }).external).toEqual({ method: 'cash', amount: 2 });
  expect(benefitExpiresAt(Date.parse('2026-11-18T18:00:00Z'), 'sessions', DEFAULT_COMMERCE_SETTINGS, 1))
    .toBe(Date.parse('2026-11-20T17:00:00Z'));
  expect(freezeRowVatBase({ kind: 'voucher', net: 100 })).toEqual({ vatBase: 0, deferredVatBase: 0 });
  expect(freezePackageVatBases([
    { kind: 'product', paidShare: 100, vatExempt: true },
  ], DEFAULT_COMMERCE_SETTINGS)).toMatchObject({ vatBase: 0, deferredVatBase: 0 });
});

function seeded(seed: number) {
  return (bound: number) => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return Math.floor(seed * bound / 0x100000000);
  };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const values = (cells: TenderCells) => [...cells.vouchers.map(({ amount }) => amount), cells.external];

test('seeded sale allocations conserve every row, column, and content capacity', () => {
  const next = seeded(0x31f803);
  for (let trial = 0; trial < 160; trial++) {
    const rows = Array.from({ length: 1 + next(8) }, () => {
      const contentPaidShares = Array.from({ length: 1 + next(5) }, () => next(50));
      const deposit = next(10);
      return { net: sum(contentPaidShares) + deposit, deposit, contentPaidShares };
    });
    const paid = sum(rows.map(({ net, deposit }) => net - deposit));
    const first = next(paid + 1);
    const second = next(paid - first + 1);
    const tenders: CommerceTender[] = [
      { method: 'voucher', voucherId: 'second-id', amount: first },
      { method: 'voucher', voucherId: 'first-id', amount: second },
      { method: 'cash', amount: paid - first - second },
    ];
    const allocation = allocateSalePayments(rows, tenders.filter(({ amount }) => amount > 0));
    const receipt = values(allocation.receipt);
    expect(sum(receipt)).toBe(paid);
    for (const [column, amount] of receipt.entries()) {
      expect(sum(allocation.rows.map(({ cells }) => values(cells)[column]))).toBe(amount);
    }
    allocation.rows.forEach(({ cells, contents }, index) => {
      if (!contents) throw new Error('Expected content cells');
      expect(sum(values(cells))).toBe(rows[index].net - rows[index].deposit);
      for (const [column, amount] of values(cells).entries()) {
        expect(sum(contents.map((content) => values(content)[column]))).toBe(amount);
      }
      expect(contents.map((content) => sum(values(content)))).toEqual(rows[index].contentPaidShares);
      expect(contents.flatMap(values).every((cell) => Number.isInteger(cell) && cell >= 0)).toBe(true);
    });

    const contents = [
      { kind: 'sessions', contentKey: 'session', units: 1 + next(9), serviceUnitPrices: [1 + next(1000), 9999] },
      { kind: 'product', contentKey: 'product', variantUnitPrice: next(1000), quantity: 1 + next(3) },
      { kind: 'voucher', contentKey: 'voucher', face: 101 },
    ] as const;
    const price = 101 + next(10000);
    for (const packageSplit of ['voucher_face_value', 'relative_standalone'] as const) {
      const quote = splitPackagePrice({ price, contents, staffDiscount: { type: 'amount', value: next(200) } }, { packageSplit });
      expect(sum(quote.shares.map(({ paidShare }) => paidShare))).toBe(quote.net);
      expect(sum(quote.shares.map(({ grossShare }) => grossShare))).toBe(price);
      expect(quote.shares[2].staffDiscount).toBe(0);
      expect(quote.shares.every(({ paidShare }) => Number.isInteger(paidShare) && paidShare >= 0)).toBe(true);
    }
  }
}, 2000);

test('seeded return sequences converge exactly, with zero replay increments and no goodwill payout', () => {
  const next = seeded(0x84ee31);
  for (let trial = 0; trial < 180; trial++) {
    const paidShare = next(10000);
    const unitsSold = 1 + next(16);
    const voucherPaid = next(paidShare + 1);
    const externalPaid = paidShare - voucherPaid;
    let voucherCredited = 0;
    let externalRefunded = 0;
    let unitsBefore = 0;

    while (unitsBefore < unitsSold) {
      const unitsThrough = unitsBefore + 1 + next(unitsSold - unitsBefore);
      const result = incrementalShare(paidShare, { unitsSold, unitsBefore, unitsThrough });
      expect(result.amount).toBeGreaterThanOrEqual(0);
      expect(result.total).toBe(voucherCredited + externalRefunded + result.amount);
      const refund = routeReceiptRefund({
        amount: result.amount,
        vouchers: voucherPaid > 0 ? [{ voucherId: 'gift', paid: voucherPaid, credited: voucherCredited, status: 'expired' }] : [],
        externalTenders: externalPaid > 0 ? [{ method: 'cash', amount: externalPaid }] : [],
        externalRefunded,
        goodwill: [{ voucherId: 'gift', amount: 1000, status: 'active' }],
      });
      voucherCredited += sum(refund.voucherCredits.map(({ amount }) => amount));
      externalRefunded += refund.external?.amount ?? 0;
      expect(voucherCredited).toBeLessThanOrEqual(voucherPaid);
      expect(externalRefunded).toBeLessThanOrEqual(externalPaid);
      expect(voucherCredited + externalRefunded).toBe(result.total);
      expect(refund.goodwillCredits).toEqual([{ voucherId: 'gift', amount: 1000 }]);
      expect(incrementalShare(paidShare, { unitsSold, unitsBefore: unitsThrough, unitsThrough })).toEqual({
        amount: 0, total: result.total,
      });
      unitsBefore = unitsThrough;
    }
    expect(voucherCredited).toBe(voucherPaid);
    expect(externalRefunded).toBe(externalPaid);
  }
}, 2000);
