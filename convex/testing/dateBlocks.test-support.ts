import type { TestConvexForDataModel } from 'convex-test';
import type { DataModel, Id } from '../_generated/dataModel';
import { api } from '../_generated/api';

/** Single-villa fixtures use the production batch command and surface its per-villa failure. */
export async function addTestDateBlock(client: TestConvexForDataModel<DataModel>, args: {
  propertyId: Id<'properties'>; start: string; end: string; reason: string;
}) {
  const { propertyId, ...range } = args;
  const [result] = await client.mutation(api.bookings.calendar.addDateBlocks.addDateBlocks, { propertyIds: [propertyId], ...range });
  if (!result.blockId) throw new Error(result.error ?? 'Date block was not created');
  return result.blockId;
}
