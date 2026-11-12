# Phase 2 implementation evidence

Base: local Phase 1 `a08175a`, including the exact `convex-helpers@0.1.120` pin and corrected Stripe cutoff timing. This implementation is restricted to the prepared isolated checkout. Root owns independent review, shared/production cutover, retargeting and merge.

## Behavior and contracts

- Four signed Convex HTTP ingresses replace the Next webhook folders and all shared-secret event APIs. Raw bytes are verified with WebCrypto. One awaited internal mutation deduplicates and records a delivery, creates the guest message/session if applicable, and schedules the turn before HTTP 200. Failed persistence returns 503. GET verification, unsupported/echo/receipt handling, postbacks and WhatsApp browsing IDs are preserved.
- `messaging/worker.ts` owns claim tokens, leases, bounded retry/backoff, a one-minute recovery sweep and conversation ordering. Dispatch intent and response persist before external sends. Every provider request rechecks ownership, staff takeover and maintenance; multipart requests renew the lease. Explicit rejection can retry saved content. Possible delivery, partial acceptance or a crash after dispatch starts becomes owner-visible reconciliation, without automatic resend.
- Booking tool effects and bounded event/tool results commit in the same transaction. Old claims cannot invalidate proposals, execute tools, record unknown questions or commit replies. Recovery renders recorded tool facts instead of asking the model to replay booking actions. A real prepare/confirm/crash/recovery test verifies no additional booking and presentation-only satang conversion.
- Adapters expose verify/normalize/send/replyWindowMs. Shared Meta code selects Facebook versus Instagram hosts. LINE retains reply token and arrival time; only explicit expiry rejection permits push. Rich cards and the restricted JPEG proxy retain separate media capabilities. Best-effort profile enrichment happens after durable admission.
- The internal `concierge/runTurn.runTurn` serves web/social generation. `loadTurnContext`, pure `buildPrompt`, existing `runConciergeTurn` and token-fenced `commitTurn` divide the pipeline. Five channel prompt snapshots pin live-fact, coupon, booking, cancellation and locale guidance. Queued future guest messages are excluded while previous turn answers remain visible. Fixed locale/capability/booking copy uses the centralized locale detector.
- Web `chat.sendMessage` is a real token-enforcing guestMutation. Admission, client-idempotency, guest insertion and enqueue are atomic. The connected transcript renders from `useQuery`; acknowledged replies are never synthesized from action responses. Credentials remain scoped to each session, and only unsent/retriable drafts are stored. Old transcript caches, polling recovery and generation-token helpers are deleted. Session, transcript, viewport, handoff and suggestions are separate hooks; disconnected demo mode remains explicit until Phase 3.
- `@convex-dev/rate-limiter@0.3.2` is pinned for Convex 1.34 compatibility. It retains 20/session/hour and 500/global/hour, with ten global shards. Duplicate/retried admissions are not charged again. Shards can conservatively reject while another shard has capacity; they do not raise the configured upper bound. The other live limits retain the root `rateLimits` table. Root table count is unchanged at 74.

## Validation

Final command results and local browser evidence are recorded below after completion. No shared backend deploy/reset or real social send is part of these checks.

The retired provider-route and client-cache tests were replaced with signed HTTP, worker, dispatch uncertainty and reactive-transcript tests. Existing booking/service/coupon/fact suites still exercise the shared generation helper; web integration suites exercise genuine guest admission, claims, internal generation and commit. No source gate or named-test requirement was weakened. Repeated hand-written `ImportMeta.glob` declarations were consolidated to Vite's canonical type when registering the real component test modules.

The local deployment is anonymous, checkout-local, with no provider/AI/email credentials configured. Component codegen uses the real local CLI, rather than handwritten generated API declarations. The browser test exposed and fixed unsupported dynamic imports in the deployed Convex guest builder, which convex-test alone did not catch.

## External steps

Use [the cutover runbook](phase2-cutover-runbook.md) for callback URLs, configuration, drain/maintenance checks, provider acceptance, delivery reconciliation and rollback. Live provider rich-card acceptance, owner-console callbacks/secrets, shared/prod deployment, and actual Clerk staff browser sign-in remain parent-owned external work. The local web check uses a deterministic policy reply with no model credential, not a claim of live model/provider coverage. Disconnected smoke tests remain labeled as such.
