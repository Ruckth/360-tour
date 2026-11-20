import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';

export function assertVisitReturnAvailable(visit: Doc<'appointments'> | null, returnId?: Id<'orderReturns'>) {
  if (visit?.pendingReturn && visit.pendingReturn.returnId !== returnId) {
    throw new ConvexError({ code: 'RETURN_IN_PROGRESS', message: 'Return in progress', returnId: visit.pendingReturn.returnId });
  }
}
