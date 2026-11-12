import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { humanToolResult } from './presentation';
import type { ToolArgs, ToolContext } from './types';
export async function searchBusinessFacts(ctx: ActionCtx, fnArgs: ToolArgs, toolContext: ToolContext): Promise<string> {
  return humanToolResult(await ctx.runQuery(internal.concierge.businessFacts.search, {
    sessionId: toolContext.sessionId, query: fnArgs.query as string,
    ...(typeof fnArgs.propertySlug === 'string' ? { propertySlug: fnArgs.propertySlug } : {})
  }));
}
