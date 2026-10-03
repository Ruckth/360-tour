/**
 * Pure decision for whether the home hero should load video at all. Kept framework-free so it
 * can be unit-tested without a DOM. The hero shows a static poster (identical in appearance to
 * the first video frame) and only upgrades to video when none of the constraints below apply:
 *
 * - prefers-reduced-motion: the guest asked for less motion — poster only, no video source.
 * - Save-Data: the guest opted into data saving — poster only.
 * - a slow effective connection (2g / slow-2g) — poster only.
 *
 * When video is skipped the inactive AND active sources are never attached, so the ~8.48 MiB of
 * hero video is not downloaded on constrained devices.
 */
export type HeroVideoConditions = {
  reducedMotion?: boolean;
  saveData?: boolean;
  /** navigator.connection.effectiveType, e.g. "4g", "3g", "2g", "slow-2g". */
  effectiveType?: string | null;
};

const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);

export function isSlowEffectiveType(effectiveType?: string | null): boolean {
  return !!effectiveType && SLOW_EFFECTIVE_TYPES.has(effectiveType);
}

export function shouldLoadHeroVideo({
  reducedMotion = false,
  saveData = false,
  effectiveType = null,
}: HeroVideoConditions = {}): boolean {
  if (reducedMotion) return false;
  if (saveData) return false;
  if (isSlowEffectiveType(effectiveType)) return false;
  return true;
}
