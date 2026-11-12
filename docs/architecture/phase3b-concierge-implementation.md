# Phase 3b: concierge backend domain

Required dependent base: `68c1d799545b89152fb144d8aa58d995baeed8c0`, open POS PR [#69](https://github.com/Ruckth/360-tour/pull/69), atop merged services #68. The clean prepared `t3/concierge-phase3b-move` worktree initially pointed at `3ca332d`; it was fast-forwarded to the exact required commit before implementation. No reset, rebase, origin/main replacement or unpublished-history rewrite occurred. The original dirty `/Users/macbook/Development/360-tour` and root review checkout were not changed. This PR targets **t3/phase3b-pos-domain-move**. `.arch-phase` remains **2**. Root owns independent review, actual Preview isolation checks, live acceptance, backend cutover and merge.

## Ownership and retained scope

Rules 2–5 and Phase 3b of `docs/plans/scalable-architecture-plan.html` govern this move. Concierge owns `businessFacts`, `chatUnknownQuestions`, generation, prompts, model/tool policy, tool orchestration and result presentation. The actual implementations move; no generic forwarding wrappers or endpoint re-exports replace them.

- `concierge/businessFacts.ts` owns the original six fact registrations: five public/admin, one internal search. Revision checks, approved-only/property-scoped retrieval, bounded search and resolution batches are unchanged.
- `concierge/knowledge.ts` owns the original seven unknown-question registrations: six public/admin and one internal recorder. Normalization, grouping, bounded list/review/undo, same-session deduplication and durable claim checks are unchanged. Recording still calls the same staff-alert implementation in its transaction, through `messaging/model.ts`.
- `concierge/generation.ts` contains the original plain generation, guardrail, policy and reply-outcome functions from `chatAi.ts`. Actual model client, turn orchestration, result presentation, metrics and grouping implementations also move from `lib` into concierge. Existing `copy.ts`, `prompt.ts`, `context.ts`, `runTurn.ts` and table ownership are preserved.
- `concierge/tools/metadata.ts`, `validation.ts`, `types.ts`, `dispatcher.ts`, `property.ts`, `service.ts`, `booking.ts`, `facts.ts` and `presentation.ts` replace the mixed tool file. Metadata and JSON schemas retain their exact names/order/descriptions/bounds. The dispatcher invokes the extracted original case bodies. A tool's `fnName` parameter retains its case's literal type where presentation needs the discriminant. This introduces no tool, retry or policy change.
- `concierge/model.ts` exposes named **plain implementations**. Cross-domain callers (`chatEval`, the messaging worker/adapters and the test turn harness) use it. The two pre-existing messaging imports of concierge copy now use this seam. No browser runtime imports the backend model. Existing frontend pure-copy and `convex/lib` imports remain Phase 3c work; no shared rule was duplicated or pulled into a browser bundle through a ctx-heavy model.
- `chatAi.ts` deliberately retains its actual `consumeChatLimit` internal registration and admission call. It had no registered `respond` action at the fixed base. No replacement admission endpoint or alias is added.
- `chatKnowledge.ts` deliberately retains `asksForStaff`, the staff-request matching constants, rolling global staff-alert limiter, `queueStaffAlert`, and the actual `alertStaffForHandoff` internal registration. Its original email scheduler and handoff/inbox guards stay there. `messaging/model.ts` exposes that same plain `queueStaffAlert` implementation so unknown recording can call it transactionally. Conversation loading/commit, guest/staff APIs, inbox state and messaging worker/claim registrations keep their current paths.

The 13 moved registrations preserve **adminQuery 4, adminMutation 7, internalQuery 1, internalMutation 1**. The two retained mixed-file registrations preserve internalMutation. Registration builders, access policy, args/returns and handler statements match the fixed base. Public inventory remains **295 / raw 0**. Tool invocation keys/fingerprints, preparation invalidation, durable result recovery, proposal/review/payment links, satang conversion exactly once, turn deadlines, retries and recovery remain unchanged. No schema/data/dependency/access-policy or product behavior change is introduced.

Remaining messaging guest/staff API closure, marketing, auth, maintenance/mixed emails/crons and ctx-lib owner helpers still need separate closure PRs, in addition to settings and later shared-rule/frontend work. This move does **not** claim that Phase 2's partial messaging move finished ownership closure, that settings is done, or that Phase 3/4 is complete.

## Complete registration path mapping

Old module paths are removed only for the moved registrations. No old compatibility endpoint aliases exist. `chatAi:consumeChatLimit` and `chatKnowledge:alertStaffForHandoff` intentionally remain unchanged.

| Fixed-base RPC | New RPC |
| --- | --- |
| `businessFacts:adminList` | `concierge/businessFacts:adminList` |
| `businessFacts:adminSave` | `concierge/businessFacts:adminSave` |
| `businessFacts:search` | `concierge/businessFacts:search` |
| `businessFacts:adminSetStatus` | `concierge/businessFacts:adminSetStatus` |
| `businessFacts:adminResolveUnknownGroups` | `concierge/businessFacts:adminResolveUnknownGroups` |
| `businessFacts:adminPropertyOptions` | `concierge/businessFacts:adminPropertyOptions` |
| `chatKnowledge:recordUnknownQuestion` | `concierge/knowledge:recordUnknownQuestion` |
| `chatKnowledge:adminListUnknownQuestions` | `concierge/knowledge:adminListUnknownQuestions` |
| `chatKnowledge:adminIgnoreUnknown` | `concierge/knowledge:adminIgnoreUnknown` |
| `chatKnowledge:adminReopenUnknown` | `concierge/knowledge:adminReopenUnknown` |
| `chatKnowledge:adminListUnknownGroups` | `concierge/knowledge:adminListUnknownGroups` |
| `chatKnowledge:adminIgnoreUnknownGroups` | `concierge/knowledge:adminIgnoreUnknownGroups` |
| `chatKnowledge:adminReopenUnknownGroups` | `concierge/knowledge:adminReopenUnknownGroups` |

## Complete implementation declaration mapping

Every original top-level declaration from the moved/split sources is listed here. Re-export-only copy/prompt conveniences formerly in `chatAi.ts` now come directly from the existing copy/prompt implementations through the model. The one-line `lib/conciergePolicy.ts` alias is removed; its real policy implementation stays in `concierge/copy.ts`.

| Original source | Current owner | Original declarations |
| --- | --- | --- |
| `convex/businessFacts.ts` | `convex/concierge/businessFacts.ts` | `status`, `structuredSourceValidator`, `RESOLVE_GROUP_LIMIT`, `RESOLVE_ROW_LIMIT`, `unresolvedReports`, `text`, `adminList`, `adminSave`, `search`, `adminSetStatus`, `adminResolveUnknownGroups`, `adminPropertyOptions` |
| `convex/lib/chatLlm.ts` | `convex/concierge/llm.ts` | `DEFAULT_AI_MODEL`, `DEFAULT_AI_API_BASE_URL`, `ToolCall`, `ChatMessage`, `ToolDef`, `LlmResponse`, `LlmCallTrace`, `InvalidAiResponseError`, `validateToolCalls`, `callAI`, `classifyComplexity`, `callSol` |
| `convex/lib/chatToolPresentation.ts` | `convex/concierge/tools/presentation.ts` | `MutationResults`, `MutationToolResult`, `bookingPaymentUrl`, `proposalUrl`, `presentMutationToolResult`, `presentStoredToolResult`, `storedProposalIsCurrent`, `humanToolResult` |
| `convex/lib/conciergeTurn.ts` | `convex/concierge/turn.ts` | `TurnOptions`, `runConciergeTurn` |
| `convex/lib/conciergeReplyOutcome.ts` | `convex/concierge/outcome.ts` | `conciergeReplyOutcome` |
| `convex/lib/turnMetrics.ts` | `convex/concierge/metrics.ts` | `TurnStageName`, `ToolTiming`, `TurnMetrics`, `ConciergeTurnLog`, `createTurnId`, `startTurnMetrics`, `recordStage`, `timeStage`, `recordModelRequest`, `recordTool`, `addPromptChars`, `SAFE_NAME`, `EMAIL_RE`, `PHONE_RE`, `scrubValue`, `sanitizeName`, `serializeConciergeTurnLog`, `conciergeTurnLogLine`, `emitConciergeTurnLog` |
| `convex/lib/knowledgeGrouping.ts` | `convex/concierge/knowledgeGrouping.ts` | `UnknownStatus`, `GroupableUnknownQuestion`, `UnknownQuestionGroup`, `groupUnknownQuestions`, `STOPWORDS`, `UNSPACED_SCRIPT`, `matchTokens`, `AnswerMatchCandidate`, `createAnswerMatcher` |
| `convex/chatAi.ts` | `convex/chatAi.ts` | `consumeChatLimit` |
| `convex/chatAi.ts` | `convex/concierge/generation.ts` | `GenerateConciergeReplyArgs`, `recordUnknownFallback`, `policyReply`, `ConciergeReply`, `withReplyOutcome`, `generateConciergeReply`, `getGuardrailReply` |
| `convex/chatKnowledge.ts` | `convex/concierge/knowledge.ts` | `unknownQuestionStatusValidator`, `sanitizeRequiredText`, `sanitizeOptionalText`, `normalizeQuestion`, `resolveSessionProperty`, `reopenUnknownQuestion`, `recordUnknownQuestion`, `adminListUnknownQuestions`, `adminIgnoreUnknown`, `adminReopenUnknown`, `UNKNOWN_GROUP_SCAN_LIMIT`, `BULK_GROUP_LIMIT`, `BULK_GROUP_ROW_LIMIT`, `BULK_ID_LIMIT`, `UnknownStatus`, `bulkIds`, `groupKeys`, `unknownsInGroup`, `REMAINING_COUNT_LIMIT`, `remainingInGroups`, `adminListUnknownGroups`, `adminIgnoreUnknownGroups`, `adminReopenUnknownGroups` |
| `convex/chatKnowledge.ts` | `convex/chatKnowledge.ts` | `word`, `STAFF_VERBS`, `STAFF_PEOPLE`, `STAFF_ALONE`, `STAFF_REQUEST`, `asksForStaff`, `claimStaffAlertSlot`, `queueStaffAlert`, `alertStaffForHandoff` |
| `convex/lib/chatTools.ts` | `convex/concierge/tools/metadata.ts` | `TOOLS`, `BOOKING_TOOLS` |
| `convex/lib/chatTools.ts` | `convex/concierge/tools/types.ts` | `ToolArgs`, `ToolContext` |
| `convex/lib/chatTools.ts` | `convex/concierge/tools/validation.ts` | `toolDefinitions`, `validateToolArgs`, `toolError` |
| `convex/lib/chatTools.ts` | `convex/concierge/tools/property.ts` | `findProperty`, `ownerOtaQuotes` |
| `convex/lib/chatTools.ts` | `convex/concierge/tools/dispatcher.ts` | `executeTool` |

The original private `executeValidatedTool` switch is now the dispatcher plus these exact extracted bodies (tool semantic names are unchanged):

| Current implementation module | Tool cases |
| --- | --- |
| concierge/tools/facts.ts | search_business_facts |
| concierge/tools/property.ts | check_availability, calculate_price, get_property_details, list_properties |
| concierge/tools/service.ts | list_services, check_service_availability, prepare_service_booking, confirm_service_booking |
| concierge/tools/booking.ts | preview_coupon, prepare_booking, confirm_booking, get_my_bookings, cancel_booking |

All moved source files are below 1,000 lines; the largest moved file is **knowledge.ts, 378 lines**. Existing `copy.ts` stays 689 lines. The complete domain remains below the limit per file.

## Codemod and fixed-base evidence

`scripts/move-concierge-domain.mjs` is the explicit one-shot codemod and repeatable `--check` audit against the exact fixed base. It redistributes original declarations/case bodies, rewrites imports and `api`/`internal`/raw RPC/CLI references, updates the current 295-entry access inventory and all frontend/test/fixture/eval callers, and rejects removed paths and endpoint exports through the model. HTTP, crons and schedulers contain no direct target of a renamed concierge registration, and their transitive messaging/bookings/service references retain their paths. Historical plans and old evidence retain their original names. Negative security assertions for the already removed `chatAi:generateReply` are intentional.

The old accuracy-eval script still referenced already removed `chatAi:respond` / `chatAi:generateReply` actions at the fixed base. The codemod replaces those dead calls with the existing internal `chatEval:comparisonTurn`, explicitly selecting the same default Luna model; it adds no runtime endpoint. Its report explicitly records the forced-model override and `routingCoverage: false`: scenario model checks verify policy/forced-model outcomes, not complexity-based routing. The expected THB quote uses stored SATANG/BPS exactly once at the output boundary. That script was not run against any external deployment.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-concierge-domain.mjs --check > output/phase3b-concierge/move-audit.json
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base 68c1d799545b89152fb144d8aa58d995baeed8c0 --out output/phase3b-concierge
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/arch-scorecard.mjs --phase 2 --json
```

The audit checks **13 moved and 2 retained registration ASTs, 98 helper/private declarations, 14 exact tool bodies, dispatcher routing/parameter contracts, 4,077 resolved dependency bindings and 1,706 other production declarations**. Import/export symbols resolve to their original declarations through the model seams. Normalization ignores only comments/formatting and a lifted top-level export modifier. Exact literal/template/regex content, syntax/operators, validators, policies, returns, branches, arithmetic and bounds remain significant. It also rejects extra declarations, oversize moved files, old imports/RPC paths, browser model imports and backend imports bypassing the concierge model (schema table composition and existing pure-lib consumers are explicit existing exceptions). Generated bindings come from the real CLI, never this script.

Actual `schema.export()` values equal the fixed base: **74/74/74** base/current/static tables, identical SHA-256 **c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6**. Only object keys and top-level table order normalize; union and compound-index ordering remain significant. Schema/table sources, lockfile, dependencies, package scripts and `.arch-phase` have no diff.

## Metrics and verification

| Metric | Fixed base | This move |
| --- | ---: | ---: |
| Phase 0–2 gates on a clean committed tree | 19/19 | 19/19 |
| Public inventory / raw registrations | 295 / 0 | 295 / 0 |
| Schema tables / domain folders | 74 / 9 | 74 / 9 |
| Cross-domain imports bypassing model | 2 | 0 |
| App as-never casts | 24 | 24 |
| src imports of convex/lib | 75 | 75 |
| convex imports of src | 1 | 1 |
| Demo-mode references / CI placeholders | 34 / 3 | 34 / 3 |
| Files above 1,000 lines | 1 | 1 |
| No-login registrations lacking returns validators | 52 | 52 |
| Phase 4 required read-budget test | 0 / 1 | 0 / 1 |

The remaining long file is the existing checkout fixture. The 52 return-validator gaps and missing Phase 4 read-budget test remain visible; no detector, target, policy or gate was changed. The clean-tree gate correctly fails during uncommitted implementation and passes after committing; it was not bypassed.

All commands use Node **22.22.3** via `/opt/homebrew/opt/node@22/bin`; ignored evidence is under `output/phase3b-concierge/`.

| Validation | Result |
| --- | --- |
| pnpm verify | App/test/Convex types, lint, **232 files / 2,865 tests**, production build pass |
| pnpm exec eslint . --max-warnings 0 | Pass, zero warnings |
| pnpm knip | Pass, including configuration hints |
| Focused concierge/knowledge/facts/tool-policy/booking+service proposal/worker/recovery/security | **18 files / 276 tests passed** |
| pnpm test:booking-ui | **223 passed**, 24 existing opt-in captures skipped |
| E2E_PORT=3053 pnpm test:e2e:smoke | **13 passed**, separate serial production build |
| Fixed-base implementation comparison / actual schema exports | Equal as described above |
| Real Convex CLI codegen | Pass, isolated anonymous local backend only |

Real component-aware generation used installed Convex **1.34.1** and convex-helpers **0.1.120**, with newly initialized checkout-local anonymous state `.convex/local/default/`, deployment `anonymous:anonymous-agent`, cloud **http://127.0.0.1:3250**, HTTP actions 3251. No shared configuration/credential was copied. A nonfunctional local JWT issuer `https://concierge-local.invalid` satisfies auth-config analysis. The first invocation needed explicit anonymous mode and this local issuer; initial extracted tool parameters needed their original switch-case literal type. After these setup/extraction corrections, real `convex codegen` passed with component bindings and TypeScript. The local backend has no provider credentials and no live model request, email/social send, payment/refund or external provider operation was performed.

The UI suite uses existing browser fixtures. Smoke uses the existing disconnected demo configuration and ran only after the full verify build finished. These tests do not establish real Clerk login, provider delivery/payment, shared-data correctness or production cutover acceptance. No data reset, schema migration, shared/prod backend inspection/mutation, secret/provider-console operation, merge or live cutover was performed.

## Preview evidence checked before push

The root record `/tmp/360-arch-phase3b-pos-preview-target.json` identifies preceding POS head **361d0d2c8f1497c9ed7443868531a9564121d538**, Preview **dpl_2DmZJ6e7ahwAxXk1v7gGJAhf6BcT**, only **https://notable-manatee-107.convex.cloud**, and `sharedProductionAndDevExcluded: true`. Its ignored copy is `preceding-preview-target.json`. Read-only GitHub metadata confirms PR #69 remains open at the exact required **68c1d799545b89152fb144d8aa58d995baeed8c0** on `t3/phase3b-pos-domain-move`. Changes since the independently observed Preview are documentation/comment corrections; that older observation is evidence of preceding isolation, **not** proof of the next Preview's target.

Repository `vercel.json` still runs `pnpm vercel-build`, whose existing script invokes `convex deploy --cmd ...`. No provider environment setting or secret was accessed or changed. Root must inspect actual **new concierge Preview logs** after push and record its dedicated backend before live acceptance. Neither shared production **wary-toad-189** nor shared development **optimistic-turtle-573** was operated on. Preview #361 is not treated as permission to operate either shared backend or evidence that this new Preview is isolated.

## Stored jobs and root-owned backend-first cutover

**No first-party stored scheduler target is renamed by this concierge-only move.** None of the 13 moved registrations is referenced by a source `runAfter`, `runAt` or cron. Generation and tools are plain functions, never stored function targets. The current worker entry points, concierge `runTurn`/`load`, admission and handoff registrations keep their paths. Source codemods never rewrite stored jobs, arguments, dispatch state or durable tool results.

| Existing target / state | Mapping and exact reconciliation |
| --- | --- |
| messaging/worker:run and messaging/worker:recover; concierge/runTurn:runTurn and concierge/runTurn:load | Paths unchanged. Quiesce ingress and drain model turns before cutover; inspect received/processing events, leases, deliveryStartedAt and reconciliation state. Preserve event IDs, event keys, claim ownership, attempts, nextAttemptAt, tool invocation keys/fingerprints, preparation intents and resultJson. Never restart an already delivered/ambiguous send or replay a committed mutation by clearing durable evidence. Resume/reconcile through the existing worker rules after backend acceptance. |
| emails:sendStaffAlert | Path and zero-delay `{sessionId, channel, guestName, lastMessage}` payload unchanged in retained chatKnowledge.queueStaffAlert. Drain under the old backend or retain the unchanged job. Do not re-enqueue a second email or clear lastStaffAlertAt/global rolling timestamps. Guards remain eval-session exclusion, staffNeeded, per-session 30-minute cooldown, rolling 30/hour and send-time handoff checks. |
| chatAi:consumeChatLimit; chatKnowledge:alertStaffForHandoff | Paths and registrations unchanged. No job migration or quota/cooldown reset. Existing conversation/inbox functions remain for messaging closure. |
| Any externally stored old RPC from the 13-row mapping above, including `.js` serialized identifiers | Root must inspect actual scheduled/failed/in-progress/external calls while writers are quiesced; none are assumed absent from source inspection. Prefer drain under old code. If any exist, record original full args, scheduled time and outcome, cancel only under the gate, and reconcile each once. For recordUnknownQuestion preserve sessionId, replyToMessageId, userQuestion, topic/page/property and the durable event/claim token; never mint a new claim or blindly replay a stale durable turn. Same-session/new-status dedup and existing alert guards still apply. Admin fact saves/status changes retain expectedRevision and actor authorization; unknown review/undo batches retain exact IDs/group keys and current status. Do not blindly re-enqueue an obsolete edit, resolve/ignore/reopen operation, or search with lost session authorization; root reviews actual row/revision/event state and invokes the mapped target only when still valid. This PR adds no generic replay/migration endpoint. |

No queued jobs were rewritten or manufactured locally. No shared queue was read, so no live absence/reconciliation claim is made. Parent POS approval-expiry/display-cleanup/display-lease/customer-merge jobs and earlier bookings/services jobs still require the parent runbooks' exact reconciliation; this source-only concierge move does not dispose of them.

1. **Keep the stacked PR open for root acceptance.** Complete POS #69 acceptance/integration without replacing its unpublished history. Root owns review, retargeting and all shared/live operations. Record the actual concierge Preview isolation first.
2. **Gate traffic and quiesce writers before inspecting queues.** Stop web/social ingress, guest/staff writes, knowledge administration, evals and external RPC producers that can call old paths. Drain in-flight model/tool turns and worker delivery/claim work without discarding uncertainty. Coordinate recovery cron and parent domain/email jobs. Root must inspect the actual queue/event/tool-result state while quiesced, reconcile any old identifiers as above and arrange a coordinated client reload.
3. **Push and accept the renamed backend while traffic stays gated, before any merge-triggered frontend build.** Confirm actual unchanged schema/data, removed old fact/unknown endpoints, unchanged retained admission/handoff endpoints and actual queued-job disposition. Exercise approved/scoped fact retrieval, unknown recording/dedup/group review/undo, staff/admin authorization, claim/session mismatch fencing, alert/email limits/guards, model timeout/retry/recovery, durable proposal replacement/confirmation, satang-once live/recovered results and exact review/payment links. Do not infer this acceptance from local tests, a preceding empty queue or another domain's acceptance.
4. **Merge only after backend acceptance.** Vercel Git integration starts the frontend build when main changes. If an earlier merge is unavoidable, root disables production Git deployment first, then restores it after backend acceptance. The existing `convex deploy --cmd` runs its frontend command before final backend push and cannot perform this incompatible rename alone. Build fresh frontend against the accepted backend; invalidate/rebuild old or paused home/villa/sitemap artifacts and reload old knowledge/admin clients so cached references cannot call removed paths.
5. Root verifies frontend/knowledge/chat behavior, restores traffic/recovery jobs and records exact live operations. Coordinate frontend/backend rollback and queued-job disposition under the same gate. Preserve durable claims/results, proposal state, alert timestamps and integer money; this move requires no data reset.

No root review, live acceptance, merge or completed ownership closure beyond the concierge scope is claimed.

## Parent review

Standards, spec and independent audits found no runtime defects at `e195258`. The independent audit identified an inaccurate accuracy-eval override label; the report now records the forced model and excludes routing coverage. The parent also corrected that legacy script’s expected quote from stored satang/basis points to displayed baht. These evaluation fixes do not change the production turn engine. Syntax and fixed-base contract/dependency checks pass; no live eval was run. New Preview logs for `e195258` identify dedicated `hidden-squid-316`, excluding shared production/development. Live concierge acceptance and cutover remain pending.
