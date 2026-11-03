# LINE and WhatsApp reply cards

`MESSAGING_RICH_CARDS` is a comma-separated server environment variable. Set it to
`line`, `whatsapp`, or `line,whatsapp` to enable cards for those channels. Empty or
unset keeps text replies. Enable on a preview/test account first, then production
after validating the rendered payloads and account permissions.

Cards use the latest eligible successful tool result from the current concierge
turn. They never parse prices, dates, availability, or payment URLs from model
prose. Failed turns, handoffs, policy replies and outer timeouts stay text-only.

Supported cards: villa gallery/details, price quote, villa proposal and payment,
service gallery, service proposal and confirmation. Availability/time-slot answers,
booking history and cancellation currently retain the existing text flow. Galleries
are capped at ten items. Service category browsing is a separate follow-up.

## Channel formats

- LINE sends AI text and one Flex bubble/carousel together using one reply token.
  Only an explicit HTTP 400 rejection allows a text-only fallback. The fallback
  places signed payment links before the text so truncation cannot remove them.
- WhatsApp sends a media carousel for 2–10 photo cards. One item uses an image
  header with reply buttons or a CTA URL. A collection missing photos uses a list;
  items without representable callbacks fall back to text rather than disappear.
  Long AI text precedes the card in a separate message. Only explicit invalid-payload
  responses (HTTP 400, code 100 or 131009) allow a text fallback. A previously sent
  introduction is not repeated.
- WhatsApp button/list IDs map to allowlisted browsing requests. Callback titles
  are ignored. A villa confirmation button opens its exact signed proposal URL;
  service confirmation remains a separate typed guest reply, because a generic
  yes callback on an old card could confirm a newer proposal.
- WhatsApp rejects missing/invalid/stale inbound timestamps and checks the 24-hour
  window again before each send, including fallbacks.

Images use a signed conversion endpoint that produces a bounded JPEG from the
stored photo. The endpoint verifies an HMAC before fetching, refuses redirects,
limits upstream size/time and decoded pixels, and caches the converted image.
This supports existing WebP service uploads and bounds larger villa photos.
`CONVEX_SERVER_SECRET` must be configured to generate signed image URLs.

## Delivery and rollout

Both channels claim an event atomically and reserve delivery in Convex before the
first provider request. `deliveryStartedAt` is optional for historical records;
no backfill or destructive migration is needed. Once an attempt starts, a failed
or ambiguous delivery cannot be replayed by webhook redelivery. Failures remain
visible to staff. This favors avoiding duplicate messages; staff must reconcile
uncertain deliveries instead of automatically resending them.

Signatures, inbound transcript recording, staff-takeover checks, late-result
suppression and the existing booking/payment mutations remain in the delivery path.
The deployment must update Convex before the Next.js webhook handlers; the existing
Vercel build runs them in that order.

Validation covers renderer bounds, signed-link preservation, localized callbacks,
actual webhook handlers with mocked provider requests, and Convex event transitions.
No real guest messages are sent by tests. A local LINE payload validation attempt
returned HTTP 401 (invalid local token), so account-level acceptance remains unverified.
WhatsApp has been checked against the official schema and mocked HTTP behavior;
device rendering and live account acceptance still require a test account.

## Provider references

- [LINE Flex messages](https://developers.line.biz/en/docs/messaging-api/using-flex-messages/)
- [LINE Messaging API and validation endpoint](https://developers.line.biz/en/reference/messaging-api/)
- [Meta interactive media carousel](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-media-carousel-messages)
- [Meta CTA URL messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages)

Checked 2026-11-04. Carousels use Meta's documented `cta_url` card type with
`quick_reply` actions; ordinary single-card reply buttons use `button`/`reply`.
