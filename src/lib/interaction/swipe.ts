export type SwipePoint = { x: number; y: number };

export function isHorizontalSwipe(
  start: SwipePoint,
  end: SwipePoint,
  minDistance = 40,
  dominanceRatio = 1.2,
): boolean {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return Math.abs(deltaX) > minDistance && Math.abs(deltaX) > Math.abs(deltaY) * dominanceRatio;
}

export function swipeDirection(start: SwipePoint, end: SwipePoint): -1 | 1 {
  return end.x - start.x > 0 ? -1 : 1;
}

export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

export function wrapIndex(index: number, length: number): number {
  return (index + length) % length;
}
