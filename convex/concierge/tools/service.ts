import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { humanToolResult, presentMutationToolResult } from './presentation';
import type { ToolArgs, ToolContext } from './types';
export async function listServices(ctx: ActionCtx, fnArgs: ToolArgs, toolContext: ToolContext): Promise<string> {
  const filters = {
    ...(typeof fnArgs.category === 'string' ? { category: fnArgs.category } : {}),
    ...(typeof fnArgs.query === 'string' ? { query: fnArgs.query } : {}),
    ...(typeof fnArgs.limit === 'number' ? { limit: fnArgs.limit } : {})
  };
  const result = await ctx.runQuery(internal.services.publicServices.browseForChat, filters);
  const search = new URLSearchParams();
  if (filters.category) search.set('category', filters.category);
  if (filters.query) search.set('q', filters.query);
  return humanToolResult({ ...result, catalogUrl: `${toolContext.siteUrl?.replace(/\/+$/, '') ?? ''}/services${search.size ? `?${search}` : ''}` });
}

export async function checkServiceAvailability(ctx: ActionCtx, fnArgs: ToolArgs): Promise<string> {
  return humanToolResult(await ctx.runQuery(internal.services.serviceBookings.checkServiceAvailability, {
    serviceSlug: String(fnArgs.serviceSlug ?? ''), date: String(fnArgs.date ?? ''),
    ...(typeof fnArgs.time === 'string' ? { time: fnArgs.time } : {})
  }));
}

export async function prepareServiceBooking(ctx: ActionCtx, fnName: 'prepare_service_booking', fnArgs: ToolArgs, toolContext: ToolContext): Promise<string> {
  const summary = await ctx.runMutation(internal.services.serviceBookings.prepareChatServiceBooking, {
    sessionId: toolContext.sessionId,
    ...(toolContext.durableTool ? { durableTool: toolContext.durableTool } : {}),
    ...(toolContext.deadlineAt !== undefined ? { deadlineAt: toolContext.deadlineAt } : {}),
    serviceSlug: String(fnArgs.serviceSlug ?? ''), date: String(fnArgs.date ?? ''),
    time: String(fnArgs.time ?? ''), guestName: String(fnArgs.guestName ?? ''),
    ...(typeof fnArgs.guestPhone === 'string' ? { guestPhone: fnArgs.guestPhone } : {}),
    ...(typeof fnArgs.staffPreference === 'string' ? { staffPreference: fnArgs.staffPreference } : {})
  });
  return presentMutationToolResult({ name: fnName, result: summary }, toolContext.siteUrl);
}

export async function confirmServiceBooking(ctx: ActionCtx, fnName: 'confirm_service_booking', toolContext: ToolContext): Promise<string> {
  const result = await ctx.runMutation(internal.services.serviceBookings.confirmChatServiceBooking, {
    sessionId: toolContext.sessionId,
    ...(toolContext.durableTool ? { durableTool: toolContext.durableTool } : {}),
    expectedProposal: toolContext.serviceProposal ?? '',
    ...(toolContext.deadlineAt !== undefined ? { deadlineAt: toolContext.deadlineAt } : {})
  });
  return presentMutationToolResult({ name: fnName, result }, toolContext.siteUrl);
}
