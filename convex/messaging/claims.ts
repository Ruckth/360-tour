import { ConvexError, v, type Infer } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
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

function invocationIndex(event: Doc<'channelEvents'>, tool: DurableTool) {
  const index = event.toolResults?.findIndex(result => result.key === tool.key) ?? -1;
  if (index >= 0) {
    if (event.toolResults![index].name !== tool.name) throw new Error('Tool identity mismatch');
    // Retrying an old preparation must neither clear nor report a newer proposal.
    if (tool.name.startsWith('prepare_') && event.toolResults!.slice(index + 1).some(result => result.name === tool.name)) {
      throw new Error('This preparation was superseded. Show the latest proposal.');
    }
  }
  return index;
}

/** Record replacement intent atomically with invalidation, even if parsing/preparation never finishes. */
export async function startDurablePreparation(ctx: MutationCtx, sessionId: Id<'conversations'>, tool: DurableTool) {
  const event = await currentClaim(ctx, tool.eventId, tool.claimToken);
  if (event.sessionId !== sessionId) throw new Error('Tool conversation mismatch');
  if (invocationIndex(event, tool) >= 0) return false;
  if ((event.toolResults?.length ?? 0) >= 16) throw new Error('Tool write budget exceeded');
  await ctx.db.patch(event._id, { toolResults: [...(event.toolResults ?? []), {
    key: tool.key, name: tool.name, pending: true,
    resultJson: JSON.stringify({ ok: false, error: 'The replacement preparation did not complete.' }),
  }] });
  return true;
}
/** Tool effects and their result commit in the SAME transaction. Old claims cannot write. */
export async function withDurableTool<T>(ctx: MutationCtx, sessionId: Id<'conversations'>, tool: DurableTool | undefined, execute: () => Promise<T>): Promise<T> {
  if (!tool) return await execute(); // Internal evals and existing trusted callers.
  const event = await currentClaim(ctx, tool.eventId, tool.claimToken);
  if (event.sessionId !== sessionId) throw new Error('Tool conversation mismatch');
  const index = invocationIndex(event, tool);
  const cached = index >= 0 ? event.toolResults![index] : undefined;
  if (cached && !cached.pending) {
    return JSON.parse(cached.resultJson) as T;
  }
  if (!cached && (event.toolResults?.length ?? 0) >= 16) throw new Error('Tool write budget exceeded');
  const result = await execute();
  const results = [...(event.toolResults ?? [])];
  const completed = { key: tool.key, name: tool.name, resultJson: JSON.stringify(result ?? null) };
  if (index >= 0) results[index] = completed;
  else results.push(completed);
  await ctx.db.patch(event._id, { toolResults: results });
  return result;
}
