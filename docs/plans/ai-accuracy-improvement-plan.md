# AI concierge: accuracy first, then efficiency

Date: 2026-10-01. User goal: **accuracy**. GPT-6 Luna is the selected default; faster and cheaper replies are useful only when task correctness is preserved.

## Current change and evidence

The local configuration and Convex dev deployment `optimistic-turtle-573` now select `openai/gpt-6-luna` for both simple and complex requests. Concierge, FAQ semantic matching, question generation, and admin translation share the same provider client and default constants. The gateway remains OpenRouter. Production deployment is outside this preview change.

Chat Completions uses `reasoning_effort: none`, `max_completion_tokens: 500`, and omits temperature for Luna. This is the configuration tested in the comparison. [OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-6-luna) specifies that Luna function calling in Chat Completions requires `none`; reasoning with tools requires Responses. Do not raise reasoning effort on the current endpoint as a quality fix.

Local evidence (not versioned): full paired responses and methodology in `output/luna-comparison-2026-10-01/`; default-model smoke evidence in `output/luna-rollout-2026-10-01/`. Release verification is recorded in [AI refactor results](ai-accuracy-refactor-results.md).

The comparison showed Luna had zero unknown fallbacks and zero final length terminations, but **this is not an accuracy score**. Known correctness problems remain: check-in knowledge conflicts with settings, reschedule intent attempts a new booking preparation, off-topic code requests get answered, and similar service names have multiple active prices. Both fresh models correctly quoted the tested Pool Villa 3-night total and completed basic bookings; that does not establish correctness for all situations.

The previous [source audit](ai-answer-api-tool-optimization-audit.md) supplies additional hypotheses, not confirmed production incidents. Recheck its findings against current source before implementing them: scope-aware knowledge retrieval, exact variant indexes, bounded reads, and parallel context reads already exist in the current code. Avoid repeating those changes.

## What accuracy means

| Dimension | Expected behavior | Release gate |
|---|---|---|
| Live facts | Price, discount, dates, timezone, service duration, availability, and staff match authoritative records | Zero critical factual errors in the release dataset |
| Transaction correctness | A reported booking/cancellation matches a committed row; repeat confirmation does not create duplicates | All deterministic transaction tests pass; zero false success claims in live eval |
| Consent and ownership | Prepare asks for confirmation; confirm uses the intended proposal and guest; foreign references expose no details | 100% of confirmation, ownership, takeover, and race cases pass |
| Capability honesty | Unsupported reschedule/payment/refund requests are described accurately and routed appropriately | No new booking disguised as reschedule; no false refund/notification claim |
| Useful answers | Supported tasks succeed; missing required fields prompt a focused question; unknown facts are acknowledged | Target at least 98% task-level correctness on a frozen, labeled dataset, reported separately by channel/language |
| Language and clarity | TH/EN/KO preserve identical facts and clearly explain the next step | No wrong-language or materially truncated response in required release cases |

These are targets, not results already achieved. A turn that avoids a wrong answer by refusing a supported task still fails task success. Do not optimize the fallback count to zero or use an LLM judge alone as ground truth.

## Implementation order

### 1. Build an accuracy baseline and regression gate — 1.5–3 hours

Convert the 79 prompts into labeled scenarios with expected facts, permitted tools, required clarification, forbidden claims, and expected DB state. Keep separate read-only and transaction suites. Use relative dates or an injected clock in Asia/Bangkok so tests remain valid over time.

Add cases for settings-versus-FAQ conflicts, similarly named services, reschedule versus a new booking, explicit refusal to share a phone number, unrelated requests, unknown facts, Unicode dates/names, mixed-language prompts, repeated confirmation, slot races, staff takeover, and provider/transport failures. For each live scenario run three independent conversations; report every failure and variability rather than averaging critical errors away.

Run through `chatAi.respond` for web, and verified channel reply resolvers for messaging; the existing internal concierge replay alone bypasses exact/semantic routing, webhook verification, pause, and delivery. Use mocked delivery for routine integration tests; real provider delivery needs configured test accounts. Check final rows with deterministic assertions, then review wording/language manually.

Deliverable: machine-readable outcomes, full replies/traces, failed-case list, and nonzero exit status on failed critical assertions. No claim of 98% accuracy until scored results exist.

### 2. Make business facts come from one authoritative source — 3–5 hours

Use effective settings for check-in/out, timezone, contact, and policy; property/service records for live catalog facts; tools and mutation results for quotes, availability, assignments, and status. Approved FAQ prose can supply explanations but must not override those fields. Apply this rule to exact/static answers as well as the concierge prompt so an exact FAQ cannot bypass corrected settings.

Introduce structured fact references and revisions for answers involving changing business data. Surface conflicts in admin for review rather than silently deleting approved answers or guessing which real-world check-in policy the owner intended. Clarify similar service variants using unique slugs/IDs and descriptive names; ask the guest which variant they mean when the choice affects price or duration. Keep test-fixture catalog items out of guest recommendations through an explicit catalog policy.

Calculate totals in server code and render exact amounts from a quote, including nights, discount, total, and currency; let the model explain the quote. Do not ask the model to do booking arithmetic. Confirm must revalidate the live quote and slot in the same transaction.

Gate: after a setting/catalog change, exact FAQ, paraphrase, web, and messaging all agree; Pool Villa 3 nights is ฿21,675 with the tested records, and altered prices produce the new correct total.

### 3. Tie transaction claims to verified state — 4–6 hours

Create a typed tool registry with JSON schema, runtime validation, read/write classification, bounded result payloads, and structured error codes. Reject malformed JSON, arrays/null arguments, fractional/negative nights, invalid stay ranges, and unknown tools. Do not silently repair invalid data into a different booking.

Bind a confirmation to the current proposal version and a later explicit guest confirmation; changing dates/service/staff invalidates the old proposal. Preserve idempotency and enforce pause, ownership, deadline, availability, and assignment inside the write transaction. Add a persisted turn/result identity before enabling retries of state-changing requests.

Generate the final confirmation/cancellation summary from the committed result, not from a model's interpretation of success. Distinguish `prepared`, `confirmed`, `cancelled`, `unavailable`, `no_staff_schedule`, `unsupported`, and `delivery_pending`. If a tool failed, pending tool calls remain, or output was truncated, do not return text that asserts success. Recover committed results after a transport timeout instead of blindly rerunning the booking.

Gate: timeout-before-write makes no change; timeout-after-commit recovers one result; duplicate events/yes messages produce one booking; the reply's staff/date/price/reference match the row.

### 4. Make scope and unsupported actions explicit — 1.5–3 hours

Define allowed tasks: villa/service information, available dates, quotes, permitted bookings/cancellations, tours, and staff handoff. Politely redirect unrelated code/general tasks in the visitor's language. Detect reschedule intent before booking preparation and block the new-booking path for that intent until a real reschedule workflow exists.

For unsupported requests, state the limitation and offer a concrete staff handoff. Record the handoff result; distinguish a task queued in the dashboard from a notification delivered to a staff account. The preview currently has no configured staff LINE/email notification credentials, so an AI reply must not imply that an external alert reached someone. Do not claim a card refund from a ledger-only cancellation.

Gate: TH/EN/KO reschedule prompts keep the original appointment unchanged; no false “slot just taken” explanation for a missing capability; off-topic prompts are redirected consistently.

### 5. Reduce context and unnecessary calls while preserving recall — 2–4 hours

First measure selected knowledge IDs, input size, matcher decisions, and wrong/missing facts. Retrieve by scope and relevance under a token budget rather than using only the newest eligible answers. Preserve policy and active booking state when reducing chat history; use a structured session-state summary rather than truncating essential confirmations.

Use deterministic routing for exact static facts and high-confidence transaction state. Avoid a separate semantic LLM pass when intent is clearly live pricing/availability/booking, or when no relevant FAQ candidates exist. Evaluate false matches and misses by language before changing confidence thresholds.

Dedupe identical read tools within a turn and run only independent reads concurrently. Invalidate read memoization after related writes. Never cache availability or proposals across turns, and never parallelize prepare/confirm/cancel state transitions. Keep a stable prompt prefix where practical, but cache benefits must not preserve stale business facts.

Gate: relevant scoped facts survive a large unrelated catalog; correctness and critical-error gates remain unchanged; supported scenarios have fewer redundant calls and lower input usage.

### 6. Observe quality and tune output budgets — 2–3 hours

Persist sanitized per-turn telemetry: route, model/config and prompt version, fact sources/revisions, tool outcomes, provider usage/cost, finish reason, retries, recovery, handoff/delivery state, and stage timings. Exclude phone numbers, payment URLs/tokens, and unrestricted raw transcripts from operational logs. Compare cost per **successful task**, not just cost per message.

Use output limits by task: short structured FAQ matching, concise concierge replies, and a larger budget for admin translation batches or complex summaries when needed. Validate JSON and finish reason before accepting generated content; one bounded repair may handle malformed/truncated read-only output, but never retry a write blindly. Add provider abort/deadline handling with committed-result recovery.

If errors remain on genuinely complex cases after data/tools fixes, compare Luna on Responses with low/medium reasoning using a separately labeled eval. Only adopt it when measured accuracy improves; keep the current `none` configuration until that evidence exists. Do not silently route to another model to hide failures.

Gate: performance changes pass the same accuracy suite; dashboards separate model errors, absent knowledge, tool failures, timeouts, and delivery failures. Latency targets are set using actual application timings, since the comparison's end-to-end measurements include Convex CLI overhead.

## Estimate and rollout

The six stages above total roughly **14–24 engineering hours** for an initial implementation and verification pass. This is a planning estimate, not a quote or an accuracy guarantee. Complete stages 1–4 first; these directly address accuracy. Stages 5–6 may only ship after the same correctness gates pass.

Optional later capabilities are separate work: a real reschedule workflow (roughly 6–10 hours, including atomic slot/staff validation, confirmation, and cancellation-policy handling) and durable notification/delivery recovery (roughly 3–6 hours after channel setup). Do not implement reschedule as cancel-then-rebook without a transaction and policy design.

The observed Luna comparison cost was about ฿0.92 for 79 prompts. Three equivalent replay passes would be about **฿2.76 of provider API cost** at the measured mix; provision approximately **฿3–10 per live accuracy run** for expanded scenarios and routing calls. Context size, tools, cache hits, and retries can change this. Excludes Codex, hosting, and engineering time. Store actual usage after each run; deterministic mocked tests do not require paid model calls.

Rollout: freeze the scored baseline → implement facts → implement transaction/capability correctness → rerun three live repetitions → try efficiency changes one at a time → rerun the identical suite. Keep prior config/prompt versions for rollback. The current model change is applied to dev/preview; release further behavior changes only with their measured results.

## Status

- Done: Luna source/local/dev defaults and supported request compatibility.
- Done: relevant deterministic regression tests and default-model smoke checks, with evidence in the rollout output directory.
- Implemented in the refactor: shared bounded turn orchestration, schema-based runtime tool validation, authoritative time replies, live-data precedence over static FAQ and connected web presets, canonical proposal/committed-result replies, explicit consent and proposal-snapshot checks, write-time takeover/deadline guards, stale-price rejection, unsupported reschedule/off-topic routing, same-turn read deduplication, provider validation/abort, and a three-repeat critical read-only eval.
- Still planned: the full 79-scenario labeled accuracy baseline across verified webhook/delivery flows, structured knowledge revisions and catalog policy, richer retrieval/state budgets, persistent turn recovery and operational telemetry, and measured reasoning/config comparisons. The focused eval does not establish 98% overall accuracy.
