# Luna accuracy refactor verification

Date: 2026-10-01. This release includes the 12 existing local admin/calendar commits, followed by the Luna accuracy refactor. The default provider is OpenRouter and default model is `openai/gpt-6-luna`; environment overrides remain supported. Dev defaults were exercised without a model override. Production environment configuration was not independently verified.

## Behavior

- Settings take precedence over conflicting approved FAQ for check-in/out. Live pricing, availability, bookings and catalog questions bypass static exact FAQ answers and static semantic candidates. Connected web suggestion clicks now pass through the server; disconnected demo replies retain their existing behavior.
- Unsupported rescheduling and unrelated coding requests receive deterministic localized capability replies. Rescheduling does not create a replacement booking.
- Tool JSON is validated against the tool schemas. Malformed arguments, invalid dates/counts and unknown fields are rejected. A turn has a 20-second deadline, at most three tool rounds and twelve calls; identical reads are reused only within that turn, with invalidation after writes.
- Preparation returns the server quote and requests guest confirmation. Confirmation requires an unambiguous later reply bound to the initial proposal snapshot, rechecks villa prices and availability, and refuses stale or canceled proposals. Writes check staff takeover and deadline inside the mutation.
- Booking and cancellation replies are rendered from committed results, including the actual price, staff, dates, reference and payment state. Owned booking-status replies also render actual rows. Tool failures, unverified completion claims, truncated output and unexecuted pending writes do not produce an asserted success. Writes are sequential and are not automatically retried by the turn runner.
- The provider client validates the response shape, aborts timed-out requests, and excludes upstream error bodies from errors. Canonical proposal/result replies avoid an extra model call.

## Verification

Full local unit suite: 78 files / 664 tests passing after review fixes. Typecheck, lint and production build passed. Regression coverage includes stale settings and prices, malformed tool arguments, explicit consent, draft replacement, takeover/deadline races, canceled confirmations, truncation, tool budgets and committed-result recovery after trace failures.

The [versioned live report](../ai-evals/critical-read-only-v1.json) contains every prompt and response: **30/30 passing**, ten scenarios repeated in three independent conversations. It covers TH/EN/KO check-in/out, unsupported reschedule and three-night Pool Villa totals, plus an English off-topic coding request. Nine price replies used the actual default Luna model; the other 21 were deterministic guardrails. The authoritative total in the tested records was THB 21,675.

An additional [final smoke](../ai-evals/critical-read-only-final-smoke.json) repeated all ten scenarios after the review fixes: **10/10 passing**. Web cases invoke the public web responder. LINE cases invoke the reply-generation entry point directly, so these results do not verify webhook authentication or external message delivery. Live cases are read-only; transaction correctness is checked against database rows in deterministic tests. Evidence logs and earlier paired model comparison remain local under `output/`.

## Remaining work

This focused dataset does **not** establish 98% overall accuracy. The [improvement plan](ai-accuracy-improvement-plan.md) retains the full labeled 79-scenario suite, delivery tests, structured knowledge revisions, catalog cleanup, persistent turn recovery/telemetry and measured reasoning comparisons as future work. Real rescheduling remains unsupported. Persistent replay recovery and new staff notification integrations are outside this refactor.

Preview automation could not initialize in this session after retries; no new visual verification is claimed. Existing admin/calendar work has its prior verification recorded in those commits.

## Standards

The parallel standards review found no documented rule violations. Two optional smells were reported: repeated capability checks and tool/result semantics inferred from strings. The duplicate check was removed; typed metadata remains a maintainability opportunity when new capabilities are added.

## Spec

The parallel spec review found three core gaps: unverified completion wording, confirmation not bound to the initial proposal, and cancellation-policy FAQ bypass. All were fixed with regression coverage. Follow-up review prompted fixes that preserve modal/negative guidance, recover the same committed result from concurrent confirmation snapshots, accept polite Thai confirmations, and detect mixed assertion/guidance sentences.

Review result: Standards — zero rule violations, one optional maintainability observation remains; Spec — three original correctness findings resolved and follow-up regressions covered. Broader accuracy and delivery targets remain future work as described above.
