import type { Doc } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { humanToolResult } from './presentation';
import { ToolArgs, ToolContext } from './types';
import { toolError, validateToolArgs } from './validation';

export async function executeTool(
  ctx: ActionCtx,
  fnName: string,
  input: unknown,
  properties: Doc<'properties'>[],
  toolContext: ToolContext
): Promise<string> {
  let fnArgs: ToolArgs;
  try { fnArgs = validateToolArgs(fnName, input); }
  catch (error) { return toolError('INVALID_ARGUMENTS', error instanceof Error ? error.message : 'Invalid tool arguments'); }
  try {
    return await executeValidatedTool(ctx, fnName, fnArgs, properties, toolContext);
  } catch (error) {
    return toolError('TOOL_FAILED', error instanceof Error ? error.message : 'Tool failed');
  }
}

import { cancelBooking, confirmBooking, getMyBookings, prepareBooking, previewCoupon } from './booking';
import { searchBusinessFacts } from './facts';
import { calculatePrice, checkAvailability, getPropertyDetails, listProperties } from './property';
import { checkServiceAvailability, confirmServiceBooking, listServices, prepareServiceBooking } from './service';

async function executeValidatedTool(ctx: ActionCtx, fnName: string, fnArgs: ToolArgs, properties: Doc<'properties'>[], toolContext: ToolContext): Promise<string> {
  switch (fnName) {
    case 'search_business_facts': return searchBusinessFacts(ctx, fnArgs, toolContext);
    case 'list_services': return listServices(ctx, fnArgs, toolContext);
    case 'check_service_availability': return checkServiceAvailability(ctx, fnArgs);
    case 'prepare_service_booking': return prepareServiceBooking(ctx, fnName, fnArgs, toolContext);
    case 'confirm_service_booking': return confirmServiceBooking(ctx, fnName, toolContext);
    case 'check_availability': return checkAvailability(ctx, fnArgs, properties);
    case 'calculate_price': return calculatePrice(ctx, fnArgs, properties);
    case 'get_property_details': return getPropertyDetails(fnArgs, properties);
    case 'list_properties': return listProperties(properties);
    case 'preview_coupon': return previewCoupon(ctx, fnArgs, toolContext);
    case 'prepare_booking': return prepareBooking(ctx, fnName, fnArgs, toolContext);
    case 'confirm_booking': return confirmBooking(ctx, fnName, toolContext);
    case 'get_my_bookings': return getMyBookings(ctx, toolContext);
    case 'cancel_booking': return cancelBooking(ctx, fnName, fnArgs, toolContext);
    default: return humanToolResult({ error: `Unknown function: ${fnName}` });
  }
}
