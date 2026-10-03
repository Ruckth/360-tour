# Codebase optimization plan

Audit date: 2 October 2026. Base commit: `ae5c123`, including the current working tree.

Start by completing the Q&A retirement already in progress and restoring passing validation. Then reduce public-page JavaScript and tour startup work, consolidate messaging reply generation, and simplify the chat module. Further Convex restructuring should follow measured read cost and invalidation frequency.

This is a plan based on source inspection and local checks. Application code was not changed. Effort estimates assume one developer familiar with the project and exclude deployment coordination and collecting representative traffic.

## Evidence and current validation

Checks were repeated with the project's required Node 22, using the installed Node 22.22.3 binary and existing dependencies.

| Check | Observed result | Implication |
| --- | --- | --- |
| Root TypeScript check | Fails with six diagnostics | Finish the current transition before starting unrelated refactors |
| ESLint | Passes | Maintain this gate during each change |
| Unit tests | 619 pass and 66 fail out of 685, across 78 files | Failures are concentrated in seven suites exercising legacy Q&A behavior |
| Root TypeScript file inventory | Five source files, all 48 test files, and three TypeScript scripts are absent | Broaden validation coverage explicitly |
| Configured Convex deployment insights | One `chat.touchSession` OCC retry warning in the last 72 hours | Insufficient evidence for an immediate presence-table migration |
| Production build and browser tests | Not run during this audit | Validate these after resolving the TypeScript baseline |

The insights command inspected `optimistic-turtle-573`, the configured development deployment. It does not establish production performance or parity with local changes. The Node 22 test report is available locally at `/tmp/360-tour-optimization-tests-20261002.json`; it is a temporary audit artifact.

The two concrete TypeScript causes are:

- `convex/chatSuggestions.ts`: the retirement branch of `listCuratedMissingTranslations` returns an array, while its action caller expects `{ total, batch }`. The remaining implicit-any diagnostics follow from that inconsistent result shape.
- `src/lib/chat/messaging-reply.ts`: the new shared resolver imports `questionFromLinePostback`, which is not exported by `src/lib/line/quick-answers.ts`.

The tests still exercise writing and resolving saved answers, while `convex/lib/legacyQa.ts` now permanently disables those operations. Each failed assertion needs classification against the accepted retirement behavior; a failing count alone does not establish a runtime regression.

The existing [Convex implementation report](./convex-query-optimization-implementation.md) and [review](./convex-query-optimization-review.md) already cover shared read budgets, overlapping bookings, monthly availability reads, calendar completeness, paginated transcripts, and resumable migrations. Preserve those protections and avoid repeating that work.

## Priorities and estimated effort

| Order | Work | Main benefit | Estimate |
| --- | --- | --- | --- |
| 1 | Complete retirement integration and restore validation | Reliable behavior and regression detection | 1–3 days |
| 2 | Establish route, tour, AI, and backend baselines | Evidence for choosing and evaluating changes | 0.5–1 day |
| 3 | Reduce locale payloads and make optional chat loading intentional | Lower public-page download and hydration cost | 1–2 days |
| 4 | Load panoramas progressively and evaluate idle rendering | Faster first room and lower GPU work | 1–2 days |
| 5 | Connect every messaging channel to the shared resolver | Less duplicated routing and avoidable work | 1–3 days |
| 6 | Separate chat session behavior from viewport and navigation behavior | Safer changes and clearer state ownership | 2–3 days |
| 7 | Optimize measured Convex hotspots and remaining admin modules | Lower backend cost where traffic justifies it | 1–3 days, conditional |

Items 3 and 4 can proceed independently after the baseline. Messaging consolidation is part of the existing retirement objective and should be finished earlier if that transition is being prepared for release. Ship each item as a small, independently reviewable change.

## Restore validation and complete the current transition

Use [AI context retirement](./ai-context-retirement.md) as the behavioral specification. The current web concierge already retrieves facts through tools, while the messaging routes still contain legacy answer routing. The shared messaging resolver exists but has no channel callers yet.

1. Give retired queries consistent return shapes and make their callers handle retirement deliberately. Complete and type the postback-to-question conversion used by the shared resolver.
2. Update tests to assert retirement: old writers cannot publish, old exact/semantic readers cannot answer, queued workers and seeds cannot recreate saved answers, and business-fact retrieval remains scoped and bounded. Keep authorization, booking, takeover, and archive behavior covered. Use direct historical fixtures where a test must prove that existing data stays inert.
3. Replace old admin authoring paths according to the accepted retirement plan. Preserve unknown-question review and archived records. Do not delete legacy tables until remaining readers, writers, migrations, and rollback requirements are understood.
4. Expand the root check to include all source entrypoints. The five currently missing files are `src/proxy.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/i18n/request.ts`, and `src/i18n/navigation.ts`. Add a separate test/script TypeScript configuration where their runtime globals differ. Retain a dedicated Convex TypeScript check in verification.
5. Separate the local Next server command from Convex synchronization. `playwright.config.ts` currently starts `pnpm dev`, which runs `convex dev --once` before Next. Give browser tests a deterministic demo server command and a distinct explicitly configured integration mode.
6. Extend `.github/workflows/verify.yml` with browser smoke coverage and failure artifacts. Keep the existing typecheck, lint, unit, and build gates.

Acceptance: all intended tests pass, all source entrypoints are checked, the production build passes, and browser smoke tests run without synchronizing a deployment. Live integration checks remain a separate stage with configured services.

## Establish comparable performance measurements

Measure a production build with fixed fixtures, viewport, browser, and network/CPU conditions. Keep cold and warm runs separate and use at least five repetitions for local comparisons. Local samples are development benchmarks; production percentiles require enough real traffic.

| Flow | Measurements |
| --- | --- |
| Home and villa detail | Transferred JavaScript by route, locale bytes, LCP, interaction latency, hero-media requests |
| Open a 360 tour | Click to first usable room, initial panorama bytes, peak texture count, GPU memory estimate, idle frame activity |
| Open chat and submit a message | Chunk loading, session initialization requests, reply latency, recovery requests, unnecessary rerenders |
| Messaging reply | Event claim to acknowledgement, claim to delivered reply, model/tool request count, timeouts and duplicates |
| Admin inbox and calendar | Query documents/bytes read, reruns during heartbeats, payload size, render duration |

Add a correlation identifier for a turn and stage timings around retrieval, model requests, tools, and delivery. Record counts and durations without logging guest text or credentials. Existing Sentry initialization disables tracing, so establish an explicit bounded measurement approach rather than assuming timings already exist.

Use these results to set budgets. Proposed initial goals are at least 20% less JavaScript on an affected public route and at least 25% faster cold tour opening on the same mobile profile. These are planning targets, not measured promises; revise them after collecting the baseline.

## Reduce public route download and hydration work

`src/lib/i18n/public-content.ts` statically imports all 11 locale JSON files and is imported by client modules including the hero, footer, villa detail, booking funnel, and tour helpers. The JSON files total approximately 0.41 MiB on disk. That size is not the compressed browser transfer size, but the import graph is a concrete candidate for bundle analysis.

Move locale loading into the server request path. Pass localized data into client modules, or read the active locale's messages from the existing next-intl provider. Split pure formatting helpers from locale-data loading so importing a helper cannot pull every dictionary into a client chunk. Where worthwhile, pass only the namespaces a route needs. Confirm fallback behavior and all 11 locales before removing synchronous helpers.

`SiteShell.tsx` already dynamically imports the chat widget, but `useDeferredReady` mounts it as soon as the browser is idle, with a 900 ms timeout. Evaluate loading the widget on launcher intent or activation while retaining the existing usable launcher link. Measure first-open latency, focus handling, property context, and mobile behavior alongside initial-page savings.

The root also enables Clerk and Convex across routes when configured. Inspect their actual route contribution before changing provider placement; public chat handoff and authenticated admin behavior can depend on shared state.

Acceptance: selected-locale rendering remains correct, unrelated dictionaries are absent from affected initial client chunks, chat opens correctly, and the measured route budget improves.

## Make tour loading proportional to the current room

`TourCanvas.tsx` passes every room image to one `useLoader(TextureLoader, paths)` call. First render therefore waits for all room textures. The Canvas uses the default continuous render loop, and `TourViewer.tsx` adds a minimum 1,100 ms intro plus a 400 ms transition delay even when textures arrive sooner.

1. Load the current room first. Prefetch likely next rooms with bounded concurrency and keep a bounded texture cache sized from mobile measurements. Keep the previous texture during a transition.
2. Define texture ownership before adding eviction: release textures after their final user stops using them, and verify reopen and property switching. The loader's cache must not retain everything indefinitely.
3. Evaluate demand rendering with explicit invalidation for camera damping, loading, resize, hotspots, and crossfades. Preserve interaction smoothness before adopting it.
4. Replace the fixed minimum wait with readiness-driven progression, retaining a short visual transition only if needed.
5. Profile panorama dimensions and mobile variants. Existing large assets include a roughly 2.95 MiB garden panorama; several smaller room images are also substantial.

Acceptance: the first usable room does not wait for unrelated rooms, transitions never flash a missing texture, idle frame activity decreases, and memory stays bounded over repeated tours. Verify touch, keyboard, low bandwidth, load failure, and reopening.

For the home hero, measure the two videos totaling approximately 8.48 MiB. Their sources become available after 900 ms regardless of viewport or reduced-motion preference. Evaluate a static poster on constrained devices and reduced motion, plus loading only the active media. Keep image quality and LCP part of the comparison.

## Consolidate messaging reply generation

LINE, Facebook, Instagram, and WhatsApp still perform their own combinations of guardrails, exact answers, semantic answers, property reads, and concierge generation. Facebook and Instagram each contain more than 700 lines of route code; length is a maintenance signal, not proof of slowness.

Use `src/lib/chat/messaging-reply.ts` as the shared reply seam after completing its types and behavior. Give it a small interface for a normalized incoming message and typed reply result. Keep signature verification, event deduplication, claim/retry state, booking capabilities, channel reply windows, and delivery inside channel adapters.

Switch one channel at a time. Remove obsolete saved-answer queries only after parity tests prove the replacement path. Align outer timeouts with the concierge's existing 20-second deadline. A `Promise.race` timeout does not cancel a running action: ensure late results cannot cause duplicate delivery, and preserve authoritative outcomes when a booking tool already committed. Keep write tools sequential and avoid automatic write retries.

Webhook handlers currently await event processing sequentially before responding. Measure acknowledgement delays first. If they cause retries, design durable processing after an atomic event claim; preserve ordering within one conversation and bound concurrency between conversations. LINE reply-token expiry must be evaluated before moving it to background processing.

Acceptance: one routing implementation serves all four channels, the retired semantic-matching call is absent, channel-specific delivery rules still hold, and redelivery, timeout, takeover, and postback cases do not produce duplicate messages or bookings.

## Give chat state clear ownership

`useChatSession.ts` is approximately 1,981 lines and combines session initialization, persistence, message recovery, live subscriptions, suggestion interactions, viewport measurements, keyboard handling, external-browser handoff, and contact capture.

Preserve its external interface while extracting internal modules for session transport and recovery, transcript/cache reconciliation, viewport and keyboard behavior, and browser handoff. Each module should own its timers, cancellation, and state transitions. Keep pure measurements and normalization separately testable. Introduce an explicit session state machine only where it replaces ambiguous combinations of readiness flags.

Keep current subscriptions gated by an open chat and ready session. Heartbeats run every 30 seconds while chat is open; consider suspending them for hidden tabs, with an immediate resume update, only after defining presence semantics. Profile updates before adding memoization.

Replace source-text assertions only where extraction makes them brittle. Use behavior tests for session restore, a late reply after restart, takeover while a reply is pending, reconnect, and timer/subscription cleanup. Retain mobile keyboard and LINE/Facebook browser checks; desktop emulation alone does not reproduce those environments.

Acceptance: the public hook contract stays stable, each state transition has one owner, restart/unmount leaves no active recovery loop, and existing public-chat and booking handoff behavior passes.

## Optimize remaining backend and admin work when measured

`touchSession` already patches only changed context fields, but always writes presence onto `chatSessions`. Inbox list/detail and public session readers can therefore rerun on heartbeat updates. The transcript query already avoids reading the session; preserve that improvement.

Start with query read sets, payloads, and unchanged-write detection. Split presence from stable session data only if measured reruns or conflicts justify the migration. Add compound inbox indexes only for frequently used filters shown to scan too many rows. Maintain pagination completeness and cursor behavior; do not shorten scans by silently dropping records.

Revisit the existing deferred candidates: upcoming-appointment counts, open-slot read reuse, review-summary updates, and redundant indexes. Check ordering requirements before removing an index, since a prefix index can sort differently from a longer index. Use the existing migration component and staged rollout for any new stored field or table.

For maintainability, extract booking calendar event transformation and filtering from `AdminBookingsView.tsx` and `AdminStaffBookingsView.tsx` after the chat work. Keep vendored `src/components/reui` changes targeted to reproduced problems. Calendar module size alone does not justify rewriting its dependency.

Acceptance: affected queries show fewer reads or reruns under the same workload, results and completeness flags remain correct, and rollout tests cover historical rows.

## Delivery and verification

For every change, record the problem, touched flow, before/after measurement where relevant, behavior tests, and remaining limitations. Complete the affected checks first, then run the full typecheck, lint, unit tests, production build, and relevant browser suite before integration. Repeat broader checks when a subsequent change warrants it.

Keep booking amounts, availability validation, confirmation requirements, ownership, and staff takeover authoritative on the server. Preserve bounded reads, fail-closed availability, sequential transaction writes, and migration resumption throughout optimization.

Avoid a framework/backend replacement, a broad vendored-calendar rewrite, speculative memoization, or a model/provider switch as part of this plan. PDF fonts are approximately 47 MiB for the three CJK files, but the document helper fetches the selected font on demand; they are a separate download optimization candidate, not evidence of a 47 MiB initial-page payload.

Supporting guidance was checked against [Convex best practices](https://docs.convex.dev/understanding/best-practices/) and [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading). Project-specific findings above come from the inspected source and checks, not those external documents.
