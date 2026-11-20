import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { catalogueFields } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { logService, validateService } from './administration';

type Service = Doc<'services'>;
type ServicePatch = Partial<Omit<Service, '_id' | '_creationTime' | 'createdAt' | 'updatedAt' | 'revision'>>;

export async function prepareServiceEdit(
  ctx: MutationCtx, before: Service, patch: ServicePatch, actor: string, kind = 'updated',
) {
  const { imageUrl, imageStorageId, ...fields } = patch;
  const photo = 'imageUrl' in patch ? { imageUrl: imageUrl ?? null, imageStorageId: imageStorageId ?? null } : {};
  return {
    ...await catalogueFields(before, { ...fields, ...photo }),
    apply: async ({ revisionAfter, recordedAt }: { revisionAfter: number; recordedAt: number }) => {
      const changes = { ...patch, revision: revisionAfter, updatedAt: recordedAt };
      // Service and its existing editor history.
      reserveWrites(ctx, 2);
      await ctx.db.patch(before._id, changes);
      await logService(ctx, before, { ...before, ...changes }, actor, kind);
      return [];
    },
  };
}

export function prepareServicePriceEdit(ctx: MutationCtx, service: Service, price: number, actor: string) {
  validateService({ ...service, price });
  return prepareServiceEdit(ctx, service, { price }, actor);
}
