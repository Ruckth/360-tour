import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { catalogueFields } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { logService, validateService } from './administration';
import { serviceOptions } from '../../shared/serviceOptions';

type Service = Doc<'services'>;
type ServicePatch = Partial<Omit<Service, '_id' | '_creationTime' | 'createdAt' | 'updatedAt' | 'revision'>>;

export async function prepareServiceEdit(
  ctx: MutationCtx, before: Service, patch: ServicePatch, actor: string, kind = 'updated',
) {
  const { imageUrl, imageStorageId, ...fields } = patch;
  const photo = 'imageUrl' in patch ? { imageUrl: imageUrl ?? null, imageStorageId: imageStorageId ?? null } : {};
  return {
    ...await catalogueFields({ ...before, options: serviceOptions(before) }, {
      ...fields, ...photo, ...('options' in fields ? { options: serviceOptions({ ...before, ...fields }) } : {}),
    }),
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
  const options = service.options?.map(option => option.durationMin === service.durationMin ? { ...option, price } : option);
  const terms = validateService({ ...service, price, options });
  return prepareServiceEdit(ctx, service, terms, actor);
}
