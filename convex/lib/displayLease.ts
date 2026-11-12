/**
 * The driving checkout's lease on the customer display (convex/pos/displays.ts). An open order stays on
 * the guest's screen only while the checkout that published it keeps renewing, so a crashed,
 * closed or signed-out tab stops exposing it within one lease. Shared with the checkout's renewal
 * timer (src/components/admin/useShowOrderOnDisplay.ts).
 */

/** How long a publish or renewal keeps an open order on the display. */
export const DRIVER_LEASE_MS = 90_000;

/**
 * How often the checkout renews: three tries per lease, and still inside one lease when a
 * background tab's timers are throttled to once a minute.
 */
export const DRIVER_RENEW_MS = 30_000;
