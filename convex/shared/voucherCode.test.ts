import { describe, expect, it } from 'vitest';
import { containsVoucherCode, maskVoucherCodes, normalizeVoucherCode, voucherCodeMask } from './voucherCode';

/** Audit r2 blocker 1: the spellings a cashier or guest can type, all of the same code. */
const SPELLINGS = ['GV-7K2M-Q9XD', 'gv-7k2m-q9xd', 'GV7K2MQ9XD', 'gv7k2mq9xd', 'Gv-7k2M-Q9xd', 'GV 7K2M Q9XD', 'gv 7k2m q9xd', 'GV–7K2M–Q9XD', 'GV_7K2M_Q9XD', 'GV - 7K2M - Q9XD'];

describe('voucher codes', () => {
  it.each(SPELLINGS)('masks %s wherever it sits in text, keeping the last four', spelling => {
    expect(maskVoucherCodes(spelling)).toBe('GV-••••-Q9XD');
    expect(maskVoucherCodes(`Gold Wellness ${spelling}`)).toBe('Gold Wellness GV-••••-Q9XD');
    expect(maskVoucherCodes(`(${spelling}), thanks`)).toBe('(GV-••••-Q9XD), thanks');
    expect(maskVoucherCodes(`Gift·${spelling}·Maya`)).toBe('Gift·GV-••••-Q9XD·Maya');
    expect(containsVoucherCode(spelling)).toBe(true);
    expect(normalizeVoucherCode(spelling)).toBe('GV-7K2M-Q9XD');
    expect(voucherCodeMask(spelling)).toBe('GV-••••-Q9XD');
  });

  it('masks every code in a text and is idempotent', () => {
    const text = 'GV-7K2M-Q9XD then gv7k2mh3ln and GV-••••-7PAX';
    expect(maskVoucherCodes(text)).toBe('GV-••••-Q9XD then GV-••••-H3LN and GV-••••-7PAX');
    expect(maskVoucherCodes(maskVoucherCodes(text))).toBe(maskVoucherCodes(text));
    expect(containsVoucherCode(maskVoucherCodes(text))).toBe(false);
    expect(containsVoucherCode(text)).toBe(true);
    // The detector holds no state between calls (a global regex would).
    expect(containsVoucherCode(text)).toBe(true);
  });

  it.each([
    'Room 1204', 'Villa 12 · room 1204-A', '+66 81 234 5678', '081-234-5678', '฿2,600.00', '฿1,000 · Card ฿790',
    'Mia Tanaka', 'Gvantsa Beridze', 'Gvozdev Ivan', 'Thai massage 60', 'Booking SPA-2026-AB12CD',
    'CONF-2026-MAYA', 'Order #1046', 'GV-12', 'GV-••••-Q9XD', 'TH 1234 5678 9012', 'Coupon SUMMER25',
    'GOLD-X17L-V54Z', 'gv1234567', 'GV-7K2M',
  ])('leaves %s as it is', text => {
    expect(maskVoucherCodes(text)).toBe(text);
    expect(containsVoucherCode(text)).toBe(false);
  });

  it('masks a code glued to a word, as the History scrub always has', () => {
    expect(maskVoucherCodes('giftGV1234Q9XD')).toBe('giftGV-••••-Q9XD');
    expect(maskVoucherCodes('Gift for MayaGV-7K2M-Q9XD!')).toBe('Gift for MayaGV-••••-Q9XD!');
  });

  it('normalizes only a whole code and masks anything else to bullets', () => {
    expect(normalizeVoucherCode('  gv 7k2m-q9xd ')).toBe('GV-7K2M-Q9XD');
    expect(normalizeVoucherCode('GV-7K2M-Q9XD extra')).toBeNull();
    expect(normalizeVoucherCode('7K2M-Q9XD')).toBeNull();
    expect(voucherCodeMask('not a code')).toBe('••••');
  });
});
