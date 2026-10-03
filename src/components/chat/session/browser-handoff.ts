/**
 * Browser handoff claim gate.
 *
 * When a guest is bounced out of an in-app browser into a real browser we carry a
 * one-time `handoff` token in the URL. The receiving page must claim that token at
 * most ONCE — re-claiming on every render/effect would be wasteful and could race.
 *
 * This gate records the last token it allowed through so a given token is claimed a
 * single time. It owns no timers or subscriptions; the hook keeps the ref and the
 * effect that actually performs the claim. (The URL parsing/stripping lives in
 * `@/lib/chat/external-browser`.)
 */

export class BrowserHandoffClaimGate {
  private claimedToken: string | null;

  constructor(initial: string | null = null) {
    this.claimedToken = initial;
  }

  /**
   * Returns true the first time it sees `token` (and records it), false for a
   * repeat of the same token or a null/empty token. A different token resets the
   * gate — each distinct handoff is claimable once.
   */
  shouldClaim(token: string | null | undefined): token is string {
    if (!token) return false;
    if (this.claimedToken === token) return false;
    this.claimedToken = token;
    return true;
  }

  get claimed() {
    return this.claimedToken;
  }
}
