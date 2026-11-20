import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { readBudget } from '../../lib/readBudget';
import { newVoucherCode, voucherCodeMask } from '../../shared/voucherCode';

/** One voucher-code detector for every surface: see convex/shared/voucherCode.ts. */
export { maskVoucherCodes } from '../../shared/voucherCode';

/**
 * Every writer issues a voucher's code here: the shared format ("GV-7K2M-Q9XD") and its mask, never
 * a code already on another voucher. Returns the code's row for the voucher's `activeCodeId`; the
 * caller reserves its write with the voucher's.
 */
export async function insertVoucherCode(ctx: MutationCtx, voucherId: Id<'vouchers'>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newVoucherCode();
    const budget = readBudget(ctx);
    budget.range();
    budget.assert();
    const taken = await ctx.db.query('voucherCodes').withIndex('by_code', q => q.eq('code', code)).first();
    if (taken) { budget.document(taken); continue; }
    return await ctx.db.insert('voucherCodes', { voucherId, code, mask: voucherCodeMask(code), status: 'active' });
  }
  throw new Error('Could not issue a unique voucher code.');
}
