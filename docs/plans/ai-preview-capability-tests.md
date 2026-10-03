# AI capability testing in preview

Prepared: 2026-10-01. Status: audit executed; results and remaining limitations are in [the evidence report](../../output/ai-capability-2026-10-01/REPORT.md).

## Estimate

- Quick demonstration: 30–45 minutes for 8 representative scenarios.
- Recommended capability audit: 2–3 hours for the 24 scenarios below, selective repeats, backend verification, and an evidence report.
- If a preview-visible messaging simulator needs adapting: add 30–60 minutes. Missing AI credentials, backend access, or admin login are dependencies, not included setup time.
- Fixing defects and testing real messaging delivery are separate work.
- Record model, requests, and usage when available. Monetary cost needs the actual configured provider/model and token usage; do not infer it from old recordings.

## Surfaces and evidence

1. Actual website chat and booking card in the T3 collaborative preview.
2. Messaging AI pipeline through the existing internal `chatEval:messagingTurn` helper, displayed in a clearly labeled preview simulator. This exercises real model/tool behavior but does not prove LINE/Meta webhook handling or message delivery.
3. Admin chat inbox and Staff bookings calendar to verify stored messages, appointments, assignments, times, payment status, and cancellations.

The current code offers booking mutation tools only to messaging channels. Website chat can answer and check availability but uses the booking card for booking. Test these as different product flows.

Use a local/development Convex deployment with synthetic guests, services, staff, and known availability. Verify the backend destination before any writes. Disable external email/message sending or use controlled test recipients. Tag the created data for cleanup, and avoid broad reseeding of existing records.

Before starting, verify the app loads, the AI is configured, the admin is accessible, and the test data matches the active deployment. Use dates computed from the test date in Asia/Bangkok. Existing evals include hard-coded September/October 2026 dates and need refreshing before reuse.

## Scenario matrix

| # | Surface | Scenario | Expected behavior / evidence |
|---|---|---|---|
| 1 | Web | Check-in and pet policies | Answers agree with configured knowledge; identify saved answer versus AI where observable. |
| 2 | Web | Villa details and capacity | Correct amenities and capacity; no invented details. |
| 3 | Web | Price and direct discount | Matches an independently calculated total from configured prices. |
| 4 | Web | Available versus blocked villa dates | Correct date/year and availability; no booking row created. |
| 5 | Web | List services and prices | Uses active service data, correct prices and durations. |
| 6 | Web | Direct booking request | Uses the supported booking card path; never falsely claims an AI-created booking. |
| 7 | Web | Thai and Korean policy/price questions | Relevant response in the requested language; no spurious demo disclaimer. |
| 8 | Web/mobile | Vague, unknown, and off-topic requests | Clarifies or explains limits; readable composer/cards; no invented policy or action. |
| 9 | Messaging | Full villa booking | Checks availability, prepares summary, waits for later agreement, creates one pending booking, gives actual reference/payment link. |
| 10 | Messaging | Full service booking without preferred staff | Creates one booked/unpaid appointment, assigns a qualified free staff member, returns SVC reference. |
| 11 | Messaging | Request a particular staff member | Honors a qualified available person; reports unavailable or unknown preference accurately. |
| 12 | Messaging | Missing name or phone | Requests missing fields; no appointment or booking before required details and confirmation. |
| 13 | Messaging | Too many villa guests | Refuses invalid capacity and offers a suitable alternative if available. |
| 14 | Messaging | Date/time change and change of mind | Refreshes summary/price; no stale or unwanted booking. |
| 15 | Messaging | List own bookings | References/status agree with rows accessible to that guest/session. |
| 16 | Messaging | Cancel unpaid future service or eligible villa | Separate cancellation confirmation; status changes and availability is freed. |
| 17 | Messaging | Ask, then say yes without valid summary | No booking from availability-only questions, missing summaries, or expired preparation. |
| 18 | Messaging | No roster versus fully occupied staff | Distinguishes unscheduled from fully booked; offers valid alternatives. |
| 19 | Messaging | Bangkok times and relative dates | “Tomorrow” and clock time resolve consistently across reply, tool arguments, row, and calendar. |
| 20 | Messaging | Repeated yes / another guest takes prepared slot | One booking for repeated confirmation; occupied slot rejected on recheck. Verify transaction behavior with backend tests as well. |
| 21 | Messaging | Paid/past service cancellation and rescheduling request | Paid/past cancellations refused as appropriate; explains unsupported rescheduling rather than claiming a change. |
| 22 | Messaging | Other guest's reference / override rules request | No unauthorized disclosure or cancellation; no invented discount, payment, or success after a tool error. |
| 23 | Admin | Visibility and assignment | Created appointment appears under assigned staff at the correct date/time; chat appears in inbox; identify actual notification behavior separately. |
| 24 | Admin | Operational handoff | Admin can move an eligible booking to another qualified free person and record arrival, service, completion, and payment. Label these as admin actions, not AI capabilities. |

## Execution order

1. Verify environment and prepare deterministic test fixtures: 15–25 minutes.
2. Run website scenarios 1–8: 20–30 minutes.
3. Run messaging scenarios 9–22 with tool traces: 40–60 minutes.
4. Verify admin scenarios 23–24 and booking side effects: 15–25 minutes.
5. Repeat six critical conversations three times total, document evidence, and clean up tagged data: 30–40 minutes.

Critical repeats: villa confirmation, service confirmation, change of mind, occupied/unscheduled time, timezone/relative dates, and misleading claims after tool errors. Reset fixtures/session state between runs. This is a sampled audit, not proof that every phrasing works.

Reuse existing unit/Convex tests for deterministic validation. Existing browser tests can use placeholder backend configuration, so their success alone does not establish live AI capability. Run only relevant backend tests to supplement the live audit.

## Reporting

For every scenario record prompt, response, surface, language, tool calls/results when available, response duration, observed row/status, and screenshot or short recording for key outcomes.

Classify separately:

- Works: supported behavior demonstrated and side effects verified.
- Correctly refuses: a prohibited/invalid request is handled without unwanted changes.
- Not implemented: no capability/tool exists in this surface.
- Bug: intended supported behavior fails or reports an action incorrectly.
- Not verified: dependencies or unavailable external delivery prevent observation.

Prioritize retesting the historical findings in `docs/ai-demo/REPORT.md`: service timezone conversion, incorrect year/availability, Korean disclaimer matching, saved-answer translation, and booking cards obscuring messages. These are historical findings, not asserted current defects.

Deliver a capability scorecard, reproducible failing prompts, selected preview screenshots/videos, and remaining limitations. Keep messaging simulation results distinct from actual LINE/WhatsApp/Messenger delivery results. Do not claim refunds, payment collection, owner notifications, or staff acceptance occurred without evidence of those actions.
