# Rich reply cards for LINE and WhatsApp (pre-designed card, dynamic message)

Prepared: 2026-11-03. Status: plan.

## Goal

When the concierge answers on LINE or WhatsApp, send the AI's written reply **plus** a fixed, brand-designed card (villa, quote, booking summary, confirmation and payment, services, time slots). The card layout never changes. Its fields come from the turn's **tool results** (current records), not from the model's prose. Build a preview first so the cards can be checked against real AI turns before any guest sees them.

## Where things are today

| Piece | File | Today |
|---|---|---|
| Shared reply seam | `src/lib/chat/messaging-reply.ts` | Returns `responseText` only, plus LINE quick-reply chips |
| LINE delivery | `src/app/api/line/webhook/route.ts:146,304` | One `text` message with quick replies. Postbacks are already parsed. |
| WhatsApp delivery | `src/app/api/whatsapp/webhook/route.ts:175` | One `text` message. Inbound accepts `type === "text"` only (`:133`), so button taps are dropped as unsupported. |
| Concierge | `convex/chatAi.ts:606` | Returns `{ response, model, committed? }`. Tool calls are already recorded in `toolTrace` (`:552`). |
| Tools that carry card data | `convex/lib/chatTools.ts` | `list_properties`, `get_property_details`, `check_availability`, `calculate_price`, `prepare_booking`, `confirm_booking`, `list_services`, `check_service_availability`, `prepare_service_booking`, `confirm_service_booking`, `get_my_bookings` |
| Eval turn (no delivery) | `convex/chatEval.ts:47` `messagingTurn` | Same pipeline as the webhooks, returns `toolTrace` |
| Stored message | `convex/schema.ts:1085` `chatMessages` | Text plus an `action` literal. No card payload. |

## Design

### 1. One channel-neutral card model

New pure module `convex/lib/replyCards.ts`:

```ts
type ReplyCard =
  | { kind: "villas"; items: VillaCardItem[] }              // list_properties
  | { kind: "villa"; item: VillaCardItem }                  // get_property_details
  | { kind: "quote"; villa; checkIn; checkOut; guests; total; currency; available } // check_availability / calculate_price
  | { kind: "bookingSummary"; ...; confirmLabel }           // prepare_booking
  | { kind: "bookingConfirmed"; reference; paymentUrl; status } // confirm_booking
  | { kind: "services"; items: ServiceCardItem[] }          // list_services
  | { kind: "slots"; service; date; times: string[] }       // check_service_availability
  | { kind: "serviceSummary" | "serviceConfirmed"; ... }    // prepare/confirm_service_booking
  | { kind: "myBookings"; items: BookingRow[] };            // get_my_bookings
```

`cardsFromToolTrace(trace, { locale, siteUrl })` turns the turn's tool results into **at most one card**: the last successful card-carrying tool wins, and error results produce no card. This keeps it deterministic and testable without the model. The model's text stays free-form; the card only shows values that a tool returned.

Rules:
- No card on guardrail, unknown fallback, timeout, `needs_staff` or tool failure. Plain text only, as today.
- Labels (Book, Pay now, Confirm, View 360 tour) come from a small localized copy table, like `src/lib/line/quick-answers.ts`. No policy text goes in templates.
- Prices are formatted from tool numbers with the property currency. The renderer never parses prices out of AI text.

### 2. Two renderers, one per channel

| | LINE (`src/lib/line/flex.ts`) | WhatsApp (`src/lib/whatsapp/interactive.ts`) |
|---|---|---|
| Villa list | Flex carousel, up to 12 bubbles, hero image | `interactive.carousel`: 2–10 cards, each with an image header, a 160-character body and identical buttons (quick-reply **or** one URL button, never mixed). Fewer than 2 villas falls back to a list. |
| Service list | Flex carousel with category header | `interactive.list`, up to 10 rows (24-character title, 72-character description). Lists cannot carry images, and services have no photos. |
| Quote or summary | Flex bubble with key/value rows and Confirm / Change buttons | `interactive.button`, up to 3 buttons (20-character title), image header, AI text as the body (1,024 characters max) |
| Confirmation and pay | Bubble with a Pay URI button | `interactive.cta_url` with the villa photo as the image header and a single link button |
| Time slots | Quick-reply chips (up to 13) | List rows |
| Required fallback | `altText` (400 characters max) = short summary | When the body exceeds 1,024 characters: text message first, then the interactive card with a short body |

WhatsApp rules: image headers work on reply-button, link-button and carousel messages, but not on lists. Like every non-template message, these can only be sent within the 24-hour window after the guest's last message. The concierge only ever replies to a guest message, so it is always inside that window. Meta's carousel examples use Graph API v23.0, and the webhook already defaults to v25.0. Meta's quick-reply carousel example keeps `type: "cta_url"` on each card; confirm this on the test number.

Each renderer is a pure function `(card, aiText, locale) => payload[]` with golden-JSON unit tests and limit tests (truncate titles, cap counts, image must be HTTPS).

Message order:
- **LINE:** `[text(aiText + quickReply), flex(card)]` in a single reply call (the limit is 5 messages).
- **WhatsApp:** one interactive message with the AI text as its body, so the message and buttons stay together.

### 3. Buttons go back through the AI, they don't bypass it

A card button sends a normal guest turn. It never calls a booking mutation directly.
- LINE: `postback.data = "card:<action>:<id>"`, plus `displayText` (for example "Yes, confirm"). `questionFromLinePostback` maps it to the guest-visible text.
- WhatsApp: the button `id` uses the same `card:<action>:<id>` format. Extend the inbound parser to accept `type === "interactive"` (`button_reply` / `list_reply`) and use the reply `title` as the message text.

This keeps the confirm-in-a-later-message rule, proposal checks and guardrails exactly as they are.

### 4. Plumbing

- `generateConciergeReply` returns `cards?: ReplyCard[]`, built from the `toolTrace` it already collects.
- `resolveMessagingReply` passes `cards` through. Adapters render them only when `MESSAGING_RICH_CARDS` includes the channel. This flag is the kill switch.
- If card delivery fails (a 400 from LINE or Meta), retry once as plain text. LINE reply tokens are single use, so build and validate the payload **before** sending. If validation fails, send text only.

### 5. Preview (the first deliverable)

An admin-only page, `/admin/dev/channel-preview`, behind admin auth and `noindex`:

- **Left:** a guest message box, a scenario picker and a locale switch (en / th / ko).
- **Right:** two phone frames side by side, styled as LINE and as WhatsApp. They render the **exact payload JSON** the renderers produce, so what you see is what would be sent, not a separate mock.
  - `FlexPreview`: a small React renderer for the Flex subset we use (box, text, image, button, separator, carousel).
  - `WhatsAppInteractivePreview`: header, body, footer and buttons/list/CTA.
- A "Show JSON" toggle with copy buttons, for pasting into LINE's Flex Message Simulator.
- Two modes:
  1. **Fixtures (default):** saved tool traces plus sample AI text for each card kind. No backend writes. Safe on the shared dev deployment.
  2. **Live:** calls a new internal eval action (based on `chatEval.messagingTurn`) that runs a real AI turn on an `eval:` session and returns `{ response, toolTrace, cards, linePayload, whatsappPayload }`. Delivers nothing.

Per the shared dev deployment rule, the preview must not need schema changes. Phase 1–2 add none.

## Phases

| # | Deliverable | Notes | Size |
|---|---|---|---|
| 0 | Static HTML mockup of the 6 main cards × 2 channels, for design sign-off | Brand colours/type from `src/app.css` | ½ day |
| 1 | `replyCards.ts` + `flex.ts` + `interactive.ts` + unit tests | Pure, no delivery change | 1 day |
| 2 | Preview page (fixtures + live eval mode) | Admin route + `admin-routes.ts` entry | 1 day |
| 3 | Wire into webhooks behind the flag; parse inbound WhatsApp interactive replies and LINE `card:` postbacks; plain-text retry | Webhook tests in `convex/line.test.ts`, `convex/whatsapp.test.ts` | 1 day |
| 4 | Store the card on `chatMessages` (`card: v.optional(...)`) and render it in the admin inbox | Schema change, so deploy to an isolated or prod deployment, not shared dev | ½–1 day |
| 5 | Real-device QA on the LINE OA and the WhatsApp test number (+1 555-662-0082), screen recording | Via Codex/gpt-6.1-sol for computer use; confirm cards render in iOS and Android apps | ½ day |

**Ship as two PRs.** Phases 0–2 are the preview, which is what was asked for and is risk-free. Phases 3–5 turn it on for guests.

## Decisions to confirm

1. **One card per reply** (recommended) or several (for example a quote plus a villa photo)?
2. **Text and card** (recommended: the AI text stays the main message) or the AI text only inside the card body?
3. Should the Pay button open the existing payment URL directly? (Recommended: yes. It is already the `paymentUrl` that `confirm_booking` returns.)
4. Are villa hero images reachable as public HTTPS URLs? Both LINE and WhatsApp fetch them from their own servers.
5. Is Messenger/Instagram in scope later? The card model is channel-neutral, so it would mean adding one more renderer.

## Risks

- **Card contradicts the text:** the model says one total, the card shows another. Mitigation: the card shows tool numbers only, and an eval check compares numbers in the AI text against the card.
- **WhatsApp limits** (3 buttons, 20-character titles, 1,024-character body) and LINE `altText` limits: handled in the renderers and covered by tests.
- **Stale buttons:** tapping Confirm on an old summary. This is already safe, because the AI re-runs `confirm_booking` against the current proposal. The card adds no new write path.
- **Reply-token expiry on LINE** if rendering adds latency: rendering is synchronous and pure, so the cost is negligible.
