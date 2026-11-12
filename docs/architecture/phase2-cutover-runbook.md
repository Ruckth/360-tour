# Phase 2 messaging cutover

This procedure is parent-owned. Implementation used only an anonymous local backend in this checkout; it did not deploy, reset or change secrets on shared `optimistic-turtle-573` or production `wary-toad-189`. No live social message was sent. Phase 1 remains the dependent base, including `a08175a` and its cutoff correction.

## Before deploying

1. Complete and accept Phase 1's reset/cutover separately. Preserve its reviewed export/rollback artifacts. `ARCH_MONEY_CUTOVER_AT` must precede the FIRST ingress block, including a Vercel pause; never reset it to a later export/seed time. Post-cutoff financial orphans must remain failed Stripe deliveries. Phase 2 leaves Stripe and calendar endpoints unchanged.
2. Pause social provider callbacks, guest/staff writes, and use `ARCH_RESET_PAUSED=1`. Every new HTTP handler and guest builder respects it; claims, recovery, commits, proposal/booking writes, unknown-question writes and dispatch authorization also check it. Existing Phase 1 cron/iCal/display maintenance behavior stays intact.
3. Drain or cancel old scheduled actions before deployment. The old Next webhook request must not still be generating or delivering a reply. Export the current database and preserve the old frontend/backend commits. Do not assume cancelling a scheduler invocation interrupts a provider request already in flight.
4. Keep the existing `channelEvents` rows; no Phase 2 reset is needed. New optional event fields and indexes widen the Phase 1 schema. Root tables remain **74**. Rate-limiter component tables belong to the component namespace, not the root schema. Keep the root `rateLimits` table for live booking, session-creation and staff-alert limits.

## Configuration and callback switch

Configure the following in **Convex** before resuming:

- LINE: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`.
- Facebook: `FACEBOOK_APP_SECRET` (or `META_APP_SECRET`), `FACEBOOK_VERIFY_TOKEN`, `FACEBOOK_ACCESS_TOKEN`, optional `FACEBOOK_GRAPH_API_VERSION`.
- Instagram: equivalent `INSTAGRAM_*` variables; its graph host is `graph.instagram.com`, not Facebook's host.
- WhatsApp: equivalent `WHATSAPP_*` variables and fallback `WHATSAPP_PHONE_NUMBER_ID`. The signed inbound account ID is persisted on each event.
- `SITE_URL`: the public website origin, required for absolute confirmation/payment/catalogue links. `MESSAGING_RICH_CARDS=line,whatsapp` opts into rich payloads.
- `MESSAGING_IMAGE_SECRET`: a dedicated JPEG-conversion capability key matching Vercel. It never grants access to event mutations. Missing it removes social image headers while preserving text/actions.
- Existing AI and staff-notification settings remain in Convex. `ARCH_RESET_PAUSED` also stops the new recovery cron. No worker requires a webhook API shared secret.

Retain provider access tokens/graph versions in Vercel for the existing JWT-authenticated staff reply route. Signature secrets and verification tokens for automatic ingress now belong in Convex. Remove the retired webhook API shared-secret variable from both platforms after the old deployment is drained. Never paste values into review comments, commands recorded in git, or logs.

Callbacks for the parent-verified mapping:

| Channel | Production | Shared development |
| --- | --- | --- |
| LINE | `https://wary-toad-189.convex.site/line/webhook` | `https://optimistic-turtle-573.convex.site/line/webhook` |
| Facebook | `https://wary-toad-189.convex.site/facebook/webhook` | `https://optimistic-turtle-573.convex.site/facebook/webhook` |
| Instagram | `https://wary-toad-189.convex.site/instagram/webhook` | `https://optimistic-turtle-573.convex.site/instagram/webhook` |
| WhatsApp | `https://wary-toad-189.convex.site/whatsapp/webhook` | `https://optimistic-turtle-573.convex.site/whatsapp/webhook` |

Deploy the reviewed frontend/backend together, installing the pinned rate-limiter component. Verify each Meta GET challenge with the matching Convex token, and verify signed POSTs from a dedicated provider test account. LINE health GET does not replace a signed POST acceptance test. Keep client-certificate attachment off unless validation is separately implemented. The removed `/api/<channel>/webhook` paths must no longer be configured.

## Acceptance and delivery reconciliation

1. While the website is still paused, clear the backend pause for controlled acceptance. Use notification-free test data and dedicated provider test accounts. Send a web message; refresh and reopen with its session credential; confirm only one guest/assistant exchange exists. Try a repeated client identifier, a foreign token, handoff rotation, and a staff reply.
2. Replay a signed webhook. It must acknowledge the duplicate without creating another event, message, turn or delivery. Verify typed messages, follows/postbacks, unsupported media, echo/delivery receipts and WhatsApp allowlisted card buttons.
3. Confirm booking proposal → separate guest yes → one booking, coupon review, service booking, cancellation confirmation/deadline, payment link, static suggestions and unknown-question/staff behavior. Stored amounts remain integer satang; tool/rendered amounts are baht. Test cards with the actual configured providers before enabling the rich-card flags.
4. Inspect `channelEvents` and the staff inbox. Pending processing owns a token and lease. Only the current token can commit. Stale pre-dispatch work retries in conversation order, with a bounded attempt budget. A recorded booking-tool result is reused without another model/tool write. Explicitly rejected sends retry the persisted reply with backoff and no extra admission charge; uncertain/partial sends do not retry.
5. **A `reconciliation` event is not proof of failure.** The provider may have accepted its persisted response before the process stopped. The inbox displays “needs delivery review” and a check-before-resending explanation; staff takeover is enabled. Compare provider delivery history, recipient/account and the event's response/booking tool results. Do not replay the callback to force a send. If delivery is confirmed, settle the conversation; if definitively undelivered, send a deliberate staff reply after checking any committed booking. No automatic reconciliation/resend endpoint is exposed.
6. LINE uses the stored reply token, even if local age suggests expiry. Push is permitted only after an explicit expired-reply-token rejection. Generic “Invalid reply token” may mean already used and remains uncertain. Timeout/crash never triggers automatic push. A crash between the expiry rejection and push is conservatively reviewed rather than replayed.
7. Resume provider callbacks and guest traffic only after acceptance. Observe rejected/uncertain events and the one-minute recovery cron. Existing events with `deliveryStartedAt` are conservatively reconciled on stale takeover. Root owns actual callback migration, secrets, provider-console acceptance and production observation.

## Rollback

Pause ingress/writes and the recovery cron using the maintenance flag, then drain external sends. Export the widened schema including rate-limiter component state. Preserve reconciliation events and booking effects: rolling code back cannot undo provider delivery. Deploy the recorded Phase 1 backend/frontend, remove or pause new scheduled work, and restore provider callback URLs only after the old pipeline is ready. Review schema narrowing against existing new event states (`web`, `reconciliation`); do not deploy a narrower schema blindly. Prefer rolling forward if any Phase 2 turns have committed. Never reset shared data merely to remove component state.
