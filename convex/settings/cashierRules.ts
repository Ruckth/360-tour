import { ConvexError, v } from 'convex/values';
import { staffMutation, staffQuery } from '../auth/model';
import { cashierRulesFields } from '../shared/staffTypes';
import { cashierRules } from './cashierPolicy';
import { appendRecordHistory } from './recordWriter';

export const getCashierRules = staffQuery({
  capability: 'manageTeam', args: {}, handler: async ctx => {  return await cashierRules(ctx); } });

export const updateCashierRules = staffMutation({
  capability: 'manageTeam', args: { expectedRevision: v.number(), ...cashierRulesFields }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const before = await cashierRules(ctx);
  if (args.expectedRevision !== before.revision) throw new ConvexError({ code: 'STALE_RULES', message: 'Cashier rules changed. Reload and try again.' });
  const limit = args.discountLimitPercent;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) throw new ConvexError('Use 0–100%, up to two decimals.');
  const { discountLimitPercent, voidPaidSale, customPrice, paymentFix } = args;
  const rules = { discountLimitPercent, voidPaidSale, customPrice, paymentFix, refund: args.refund ?? before.refund };
  const fields = { ...rules, revision: before.revision + 1, updatedAt: Date.now(), updatedByEmail: actor.email };
  const row = await ctx.db.query('cashierRules').withIndex('by_key', q => q.eq('key', 'default')).unique();
  const id = row ? row._id : await ctx.db.insert('cashierRules', { key: 'default', ...fields });
  if (row) await ctx.db.patch(id, fields);
  await appendRecordHistory(ctx, { entityType: 'cashierRules', entityId: id, actor: actor.email, kind: 'updated', before, after: fields });
  return { ...rules, revision: fields.revision };
} });
