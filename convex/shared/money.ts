/** All persisted amounts are integer satang; all percentages are integer basis points. */
export const BASIS_POINTS = 10_000;
export function assertSatang(amount: number): number {
  if (!Number.isSafeInteger(amount)) throw new Error('Money must be safe integer satang');
  return amount;
}
/** One rounding rule: nearest integer, ties away from zero. */
export function roundRatio(numerator: number | bigint, denominator: number | bigint): number {
  const n = typeof numerator === 'bigint' ? numerator : BigInt(assertSatang(numerator));
  const d = typeof denominator === 'bigint' ? denominator : BigInt(assertSatang(denominator));
  if (d <= 0n) throw new Error('A money divisor must be positive');
  const magnitude = n < 0n ? -n : n;
  const result = Number((magnitude * 2n + d) / (d * 2n)) * (n < 0n ? -1 : 1);
  return assertSatang(result);
}
export function roundMoney(amount: number): number {
  if (Number.isSafeInteger(amount)) return amount;
  if (!Number.isFinite(amount)) throw new Error('Money must be finite');
  return assertSatang(Math.sign(amount) * Math.round(Number(Math.abs(amount).toPrecision(15))));
}
export function percentageOf(amount: number, basisPoints: number): number {
  assertSatang(amount);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS) throw new Error('Percentage must be 0–10000 basis points');
  return roundRatio(BigInt(amount) * BigInt(basisPoints), BASIS_POINTS);
}
/** Only human input, display, and external providers using major currency units use these adapters. */
export const bahtToSatang = (baht: number) => roundMoney(Number((baht * 100).toPrecision(15)));
export const satangToBaht = (satang: number) => assertSatang(satang) / 100;
export const percentToBasisPoints = bahtToSatang;
export const basisPointsToPercent = satangToBaht;
