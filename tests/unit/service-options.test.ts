import { describe, expect, it } from 'vitest';
import { appointmentServiceLabel, durationList, durationSpan, priceFrom, priceSpan, serviceOption, suggestedPrice } from '@/lib/service-options';

const baht = (amount: number) => `฿${(amount / 100).toLocaleString('en-US')}`;
const thai = { name: 'Thai massage', durationMin: 60, price: 80000, options: [{ durationMin: 120, price: 140000 }, { durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }] };
const legacy = { name: 'Facial', durationMin: 45, price: 150000 };

describe('service duration labels', () => {
  it('reads several lengths in order and one length as before', () => {
    expect(durationList(thai)).toBe('60 / 90 / 120 min');
    expect(durationSpan(thai)).toBe('60–120 min');
    expect(priceSpan(thai, baht)).toBe('฿800–1,400');
    expect(priceFrom(thai, baht)).toBe('from ฿800');
    expect([durationList(legacy), durationSpan(legacy), priceSpan(legacy, baht), priceFrom(legacy, baht)]).toEqual(['45 min', '45 min', '฿1,500', '฿1,500']);
    expect(priceSpan(thai, (amount) => `THB ${amount / 100}`)).toBe('THB 800–1400');
  });

  it('resolves a length, falling back to the default', () => {
    expect(serviceOption(thai, 90)).toEqual({ durationMin: 90, price: 110000 });
    expect(serviceOption(thai, 45)).toEqual({ durationMin: 60, price: 80000 });
    expect(serviceOption(legacy)).toEqual({ durationMin: 45, price: 150000 });
  });

  it('suggests the per-minute price of the shortest priced length, to ฿50', () => {
    expect(suggestedPrice(thai.options, 150)).toBe(200000);
    expect(suggestedPrice([{ durationMin: 60, price: 0 }], 90)).toBe(0);
  });

  it('adds the booked length to calendar labels only for multi-length services', () => {
    const appointment = { start: 0, end: 90 * 60_000 };
    expect(appointmentServiceLabel(thai, appointment)).toBe('Thai massage · 90′');
    expect(appointmentServiceLabel(legacy, appointment)).toBe('Facial');
    expect(appointmentServiceLabel(undefined, appointment)).toBe('Service');
  });
});
