/** A positive stock balance at or below its configured reorder point. */
export function isLowStock(onHand: number, reorderPoint?: number): boolean {
  return onHand > 0 && reorderPoint !== undefined && onHand <= reorderPoint;
}
