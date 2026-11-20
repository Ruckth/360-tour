import { ConvexError, convexToJson, v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { resolveCommerceSettings, type CommerceSettings } from '../validators';
import { adjust, type AdjustmentCommand, type AdjustmentWriter } from './adjustments';
import { settingsDocument } from './readSettings';

export const settingsEditArgs = {
  expectedRevision: v.number(),
  clientKey: v.string(),
  reason: v.string(),
};

export const settingsEditResult = v.object({
  status: v.literal('applied'),
  revision: v.number(),
  adjustmentId: v.id('commerceAdjustments'),
});

type SettingsEdit = Pick<AdjustmentCommand, 'expectedRevision' | 'clientKey' | 'input' | 'kind'> & { reason: string };

export async function editCommerceSettings(
  ctx: MutationCtx, actor: StaffActor, { reason, ...edit }: SettingsEdit,
  changes: (current: CommerceSettings) => Promise<Partial<CommerceSettings>>,
  afterApply?: () => Promise<void>,
) {
  const row = await settingsDocument(ctx);
  const current = resolveCommerceSettings(row);
  if (!row) reserveWrites(ctx, 1);
  const targetId = row?._id ?? await ctx.db.insert('commerceSettings', { key: 'default', ...current });

  const writer: AdjustmentWriter = {
    assertScope: async (_ctx, _actor, { target }) => {
      if (target.targetType !== 'settings' || target.targetId !== targetId) {
        throw new ConvexError({ code: 'SETTINGS_SCOPE_DENIED', message: 'Checkout settings could not be found.' });
      }
    },
    prepare: async () => {
      const patch = await changes(current);
      const before: AdjustmentCommand['input'] = {};
      const after: AdjustmentCommand['input'] = {};
      for (const [key, value] of Object.entries(patch)) {
        const previous = current[key as keyof CommerceSettings] ?? null;
        const next = value ?? null;
        if (JSON.stringify(convexToJson(previous)) !== JSON.stringify(convexToJson(next))) {
          before[key] = previous;
          after[key] = next;
        }
      }
      if (!Object.keys(after).length) {
        throw new ConvexError({ code: 'SETTINGS_UNCHANGED', message: 'These checkout settings are already saved.' });
      }
      return {
        before, after,
        apply: async ({ revisionAfter }) => {
          reserveWrites(ctx, 1);
          await ctx.db.patch('commerceSettings', targetId, { ...patch, revision: revisionAfter });
          await afterApply?.();
          return [];
        },
      };
    },
  };
  const result = await adjust(ctx, actor, {
    ...edit, target: { targetType: 'settings', targetId }, reasonCode: 'other', reasonText: reason,
  }, writer);
  if (result.status !== 'applied' || result.effects.length) throw new Error('Unexpected settings adjustment result');
  return { status: result.status, revision: result.revision, adjustmentId: result.adjustmentId };
}
