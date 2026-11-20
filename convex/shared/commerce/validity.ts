/*
 * Kept free of imports so the checkout's first screen can format validity without loading the rules.
 */

/**
 * The last moment a benefit can be used. Stored ends are exclusive: a voucher ending at 00:00 Bangkok
 * on 19 Feb is active until 23:59:59.999 on 18 Feb (benefitState), so every screen and slip shows the
 * Bangkok date of this moment ("Valid through 18 Feb 2027"), never the first expired day.
 */
export const lastUsableAt = (expiresAt: number) => expiresAt - 1;
