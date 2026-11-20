import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { catalogueFields, catalogueRevision, recordCatalogueEdit } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { logConfiguration } from '../../settings/model';
import { amount } from '../../shared/validation';

type Property = Doc<'properties'>;
type PropertyPatch = Partial<Pick<Property,
  'slug' | 'name' | 'tagline' | 'description' | 'pricePerNight' | 'currency' | 'maxGuests' | 'bedrooms' |
  'bathrooms' | 'area' | 'amenities' | 'images' | 'directDiscountPercent' | 'status' | 'tourRoomIds'
>>;

async function preparePropertyEdit(ctx: MutationCtx, before: Property, patch: PropertyPatch, actor: string) {
  return {
    ...await catalogueFields(before, patch),
    apply: async ({ revisionAfter, recordedAt }: { revisionAfter: number; recordedAt: number }) => {
      const contentChanged = (['name', 'tagline', 'description'] as const).some(
        field => patch[field] !== undefined && patch[field] !== before[field],
      ) || (patch.amenities !== undefined && patch.amenities.join('\n') !== before.amenities.join('\n'));
      const changes = {
        ...patch, revision: revisionAfter, ...(contentChanged ? { contentEditedAt: recordedAt } : {}),
      };
      // Property, configuration history and its discovery index.
      reserveWrites(ctx, 3);
      await ctx.db.patch(before._id, changes);
      await logConfiguration(ctx, actor, 'updated', before, { ...before, ...changes }, 'property');
      return [];
    },
  };
}

export function propertyNightlyPrice(price: number) {
  return amount(price, 'Price per night', { integer: true });
}

export function preparePropertyPriceEdit(ctx: MutationCtx, before: Property, price: number, actor: string) {
  return preparePropertyEdit(ctx, before, { pricePerNight: propertyNightlyPrice(price) }, actor);
}

export async function savePropertyEdit(ctx: MutationCtx, before: Property, patch: PropertyPatch, actor: string, expectedRevision?: number) {
  const target = { targetType: 'property', targetId: before._id } as const;
  const revision = catalogueRevision(target, before, expectedRevision);
  const edit = await preparePropertyEdit(ctx, before, patch, actor);
  await recordCatalogueEdit(ctx, actor, target, revision, edit);
}
