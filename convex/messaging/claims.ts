import { ConvexError, v, type Infer } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { maintenancePaused } from '../auth/model';
export const durableTurnValidator = v.object({ eventId: v.id('channelEvents'), claimToken: v.string() });
export const durableToolValidator = v.object({ eventId: v.id('channelEvents'), claimToken: v.string(), key: v.string(), name: v.string() });
export type DurableTool = Infer<typeof durableToolValidator>;
export async function currentClaim(ctx: MutationCtx, eventId: Id<'channelEvents'>, claimToken: string) {
  const event = await ctx.db.get(eventId);
  if (maintenancePaused() || !event || event.status !== 'processing' || event.claimToken !== claimToken || (event.leaseExpiresAt ?? 0) <= Date.now()) {
    throw new ConvexError({ code: 'STALE_TURN', message: 'This turn no longer owns the event' });
  }
  return event;
}
/** Tool effects and their result commit in the SAME transaction. Old claims cannot write. */
export async function withDurableTool<T>(ctx: MutationCtx, sessionId: Id<'conversations'>, tool: DurableTool | undefined, execute: () => Promise<T>): Promise<T> {
  if (!tool) return await execute(); // Internal evals and existing trusted callers.
  const event = await currentClaim(ctx, tool.eventId, tool.claimToken);
  if (event.sessionId !== sessionId) throw new Error('Tool conversation mismatch');
  const cached = event.toolResults?.find(result => result.key === tool.key);
  if (cached) {
    if (cached.name !== tool.name) throw new Error('Tool identity mismatch');
    return JSON.parse(cached.resultJson) as T;
  }
  if ((event.toolResults?.length ?? 0) >= 16) throw new Error('Tool write budget exceeded');
  const result = await execute();
  await ctx.db.patch(event._id, { toolResults: [...(event.toolResults ?? []), { key: tool.key, name: tool.name, resultJson: JSON.stringify(result ?? null) }] });
  return result;
}
