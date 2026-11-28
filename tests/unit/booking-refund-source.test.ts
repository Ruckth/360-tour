import { expect, it } from 'vitest';
import type { FunctionReturnType } from 'convex/server';
import type { api } from 'convex/_generated/api';
import { bookingRefundSources } from '@/components/admin/BookingRefundSource';

type Financials = NonNullable<FunctionReturnType<typeof api.bookings.admin.bookingFinancials>>;
const at = (date: string) => Date.parse(`${date}T10:00:00+07:00`);
const payment = { origin: 'manual', amount: 500000, currency: 'THB', method: 'cash', recordedAt: 0, recordedBy: 'desk', status: 'recorded', order: null, amendBlocker: null, cancelBlocker: null };

it('F8: equal-value refund sources show payment date and refundable remainder, plus a reference when they still collide', () => {
  const data = { payments: [
    { ...payment, _id: 'pay_aaaaaa111111', effectiveAt: at('2026-10-20'), refunded: 0, refundable: 500000 },
    { ...payment, _id: 'pay_bbbbbb222222', effectiveAt: at('2026-10-21'), refunded: 200000, refundable: 300000 },
    { ...payment, _id: 'pay_cccccc333333', effectiveAt: at('2026-10-22'), refunded: 0, refundable: 500000 },
    { ...payment, _id: 'pay_dddddd444444', effectiveAt: at('2026-10-22'), refunded: 0, refundable: 500000 },
  ] } as unknown as Financials;
  const labels = bookingRefundSources(data).map(source => source.label);
  expect(labels[0]).toMatch(/paid 20 Oct.*refundable/);
  expect(labels[1]).toMatch(/paid 21 Oct · ฿3,000(\.00)? refundable$/);
  expect(labels[0]).not.toContain('ref …');
  expect(labels[2]).toContain('ref …333333');
  expect(labels[3]).toContain('ref …444444');
  expect(new Set(labels).size).toBe(4);
});
