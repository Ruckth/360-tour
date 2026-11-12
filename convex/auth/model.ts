/** Shared registration seam. Internal maintenance/seed functions remain available during cutover. */
import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import type { HttpActionBuilder } from 'convex/server';
import { ConvexError } from 'convex/values';
import { action as rawAction, httpAction as rawHttpAction, mutation as rawMutation, query as rawQuery } from '../_generated/server';
export * from '../_generated/server';

function operational() {
  if (process.env.ARCH_RESET_PAUSED === '1') {
    throw new ConvexError({ code: 'MAINTENANCE', message: 'The resort is temporarily unavailable for maintenance. Please try again shortly.' });
  }
  return {};
}
export const query = customQuery(rawQuery, customCtx(operational));
export const mutation = customMutation(rawMutation, customCtx(operational));
export const action = customAction(rawAction, customCtx(operational));
export const httpAction: HttpActionBuilder = handler => rawHttpAction((ctx, request) =>
  process.env.ARCH_RESET_PAUSED === '1'
    ? Promise.resolve(new Response('Temporarily unavailable for maintenance', { status: 503, headers: { 'Retry-After': '60' } }))
    : handler(ctx, request),
);
