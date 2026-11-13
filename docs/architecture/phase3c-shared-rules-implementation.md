# Phase 3c: shared portable rules

Exact parent: `4748b630c3a4fc52cd6be3fb2c6b3b7802f5e19c`, maintenance [PR #79](https://github.com/Ruckth/360-tour/pull/79), branch `t3/complete-maintenance-ownership`. Branch `t3/phase3c-shared-rules` starts directly there in `/Users/macbook/.t3/worktrees/360-tour/t3-95a7fde2-bccfc0a15de62818`. Parent history is intact. No other checkout or subagent was used.

This implements only the plan's five-rule/domain-map Phase 3c, applying the codebase-design vocabulary: actual implementations move behind useful shared interfaces; browser input/presentation adapters and backend ctx implementations keep their own roles. There is no shared index, framework, old-file forwarding stub or backend model/private import in browser code.

## Ownership and deleted copies

The first two commits move **orderMath** (`fc67979`) and **appointmentWindow** (`02105cc`) before the remaining consolidation.

| Former implementation | Canonical shared implementation/interface |
| --- | --- |
| `lib/orderMath`, `lib/appointmentWindow` | `shared/orderMath`, `shared/appointmentWindow`; existing arithmetic, guards, VAT/refund/tender limits and lifecycle rules |
| `lib/dates`, `shared/resortLocalParts`, rosterDate, marketing-report offset, staff-booking calculations | `shared/time` fixed UTC+7/no DST (`resortTodayIso`, `resortLocalParts`, `resortDateTime`, `resortMidnight`, `resortTime24`); `shared/dates` calendar validation/ranges/addition |
| `src/lib/booking/quote`, `lib/pricing` | `shared/pricing.calculateDirectQuote(property, nights)` returning the existing seven quote fields; structural property input, satang/BPS throughout |
| `src/lib/booking/phone` | `shared/phone`; actual normalization/validation now also used by POS customer identity/merge implementation |
| Services pure schedule/overlap functions, UI `stayConflicts`, UI time-off calculations | `shared/schedule`, `shared/overlap`, `shared/timeOff`; ctx scans/writes remain in their domains |
| Auth manualReduction and checkout's copied cashier math | `shared/staffDiscount`; UI hint and fixture use the same actual backend calculation |
| UI blocked-month/calendar calculations | `shared/calendar`, including the backend's consumed villa-night budget |
| `lib/stayMoney`, `bookingMoney`, `offers`, `posCoupons` | Same actual named implementations under `shared/`; all coupon allocation, caps, rounding, refunds and notification rules retained |
| `lib/serviceSchedule`, `financeValidators`, `staffTypes`, `affiliateTypes`, `inboxTypes`, `siteSettings` | Same named shared policy/type/validator modules; generated model imports are type-only |
| `lib/chatPresence`, `chatReuse`, `chatSuggestions`, `chatWriteGuard`, `guestCouponCode`, `chatCouponCopy`, `replyCards` | Same actual shared pure implementations; old `unknownReply` alias deleted, consumers use `shared/conciergeCopy` |
| `concierge/copy`, Messaging rich-message rendering | `shared/conciergeCopy`, `shared/richMessages`; the actual environment flag stays in backend `messaging/channels/richCardsEnabled` |
| `lib/codes`, `displayTokens`, `displayLease`, `ical`, `imageUploads`, `marketingPolicy`, `marketingPrivacy`, `marketingReport`, `marketingSlugs`, `slug`, `validation` | Actual portable implementations under corresponding shared names; validation combines existing leaves, without schema-runtime imports |

All **33 retired production lib leaves** are gone. The five lib test files travel with their implementations. Each of the three remaining files was traced: `readBudget` owns invocation-scoped read/write accounting and async ranges; `adminEmails` reads the backend allowlist environment; `maintenance` reads the backend pause environment. They remain backend infrastructure/configuration and have no browser/shared consumers.

`src/lib/booking/dates` retains useful local Date-object/list and display adapters; `src/lib/staff-bookings` retains Intl presentation, labels/statuses and its React clock hook. They contain no copied date/time-off calculations. The unused frontend rich-message forwarding file is deleted. Shared contains no ctx, DB/storage/scheduler/registration builders, environment access or network/provider I/O. Existing Web Crypto operations remain portable local primitives. Existing UTC coupon-date presentation and settings timezone-name validation use Intl, not business-time calculations.

All nine domain model exported names are preserved, including POS's **twelve consumed helpers**. Shared declarations directly back relocated pure names exposed through domain models. Services photo implementations remain private. Maintenance's **eight new internal paths** remain unchanged.

## Behavior and date audit

Public booking/home/chat/date-picker today already used fixed +7 at this parent; no unsuffixed frontend `todayIso` implementation was found. The actual inconsistent callers were `AdminBookingsView`, `DateBlockDialog` and `useAdminBookingDates`, whose business today used browser-local dates. They now consume resort today. Marketing's Intl-based today and staff calendar calculations also use the same fixed arithmetic. Date-block audit timestamps use canonical resort midnight.

Browser Date-object picker conversion still uses local date parts and local midnight; it is not converted to resort timestamps. Business-day arithmetic is independent of browser DST. Empty/invalid date-input ranges remain zero nights, reversed ranges stay zero, invalid additions stay empty; backend `nightsBetween` remains signed. Strict backend ISO admission still rejects years below 0100, while picker calendar validation retains support for 0001–0099. Canonical calendar addition now handles those early years correctly instead of Date.UTC's 1900 remapping; backend admitted dates are unaffected. The former frontend night calculation also remapped early years through Date.UTC; the shared validated interface fixes that inconsistency.

The marketing quote-form night helper now rejects impossible dates instead of allowing Date.parse to normalize them. This deliberately aligns it with the existing picker input policy. Direct quotes now share the frontend's existing negative-night clamp; actual backend callers validate positive nights before pricing. No admitted booking quote changes. Satang integers, basis points, half-up rounding, discount/coupon allocation, VAT, deposit/refund caps and phone/customer identity semantics are unchanged; there is no extra currency conversion. Time-off acceptance has one rule; the UI retains detailed errors and the backend retains its existing generic refusal sentence.

## Proof and validation

The existing independent registration checker accepts an explicit base and an opt-in normalization for exactly four date-block audit timestamp expressions. Historical defaults retain their original fixed base and assertions. Against this parent, **377 registration initializers** and all builder bindings are token-identical; the other **four** differ only by `Date.parse(date + '+07:00')` becoming `resortMidnight(date)`. Their full registration options, args/returns and remaining handler tokens compare equal after that explicit adapter normalization. No token-equality claim is made for consolidated pricing/date/time-off implementations: those are checked through actual shared interfaces and existing domain tests.

Full HTTP route/ingress source and all **55 scheduler/cron calls** compare equal. Real CLI metadata independently confirms all **381 RPC identifiers**, function kinds/visibility (**295 public**) and **ten HTTP actions**. No path, registration builder, argument/return validator, HTTP route, scheduler target/arguments/time, durable identity or schema contract changes.

New ownership checks enforce all retired files, src/shared import directions, all model interfaces, POS's exact twelve exports and the entire emitted backend runtime graph without cycles. Thirty-one literal relocation pairs compare actual declaration tokens to the exact parent. Existing assertions remain, including strengthened missing-module retirement checks and unchanged explicit 30-second archive budgets. New shared tests cover UTC16:59/17:00, leap/month/year transitions, non-Bangkok local-Date semantics, exact time-off limits, half-open conflicts and quote/offer/receipt agreement.

Actual `schema.export()` equality: **74 base/current/static tables**, SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Only object keys and top-level table order normalize. Generated server/data-model files, schema/tables, dependencies/lockfile and workflows are unchanged; `.arch-phase` stays **2**.

```sh
node scripts/check-pos-closure-contracts.mjs --base 4748b630c3a4fc52cd6be3fb2c6b3b7802f5e19c --canonical-time --local-spec output/phase3c/local-function-spec.json
node scripts/schema-equivalence.mjs --base 4748b630c3a4fc52cd6be3fb2c6b3b7802f5e19c --out output/phase3c
```

Validation uses Node **22.22.3** (`/opt/homebrew/opt/node@22/bin`), frozen dependencies and disconnected app configuration with an empty inherited service environment. Next builds are serialized. Real Convex **1.34.1** initialized a fresh anonymous checkout-local deployment at **3550/3551**, with a new ignored HOME and only the deliberately nonfunctional issuer `https://phase3c-local.invalid`; component-aware generation, standalone codegen and actual function-spec capture use that backend. No seed/reset/eval or business acceptance RPC is invoked. No shared/dev/prod deploy, credential copying, real Clerk/provider/model/email/social call, message or Preview inspection/deletion/watch occurs.

Final source implementation: `d901ad30fd28aa67cdfa8503b3c2bd453d59ed60` (preceded by the two required initial moves). The later record commit changes documentation only. Logs and schema/CLI artifacts are ignored under `output/phase3c/`.

| Check | Actual result |
| --- | --- |
| Full `pnpm verify` | App/test/Convex types, lint, **242 files / 2,903 tests**, production Next build passed |
| `pnpm exec eslint . --max-warnings 0`; `pnpm knip` | Passed; zero warnings and no Knip findings/config hints |
| Focused shared/money/quote/date/phone/overlap/staff/POS/booking/service/marketing/durable/ownership suites | **42 files / 681 tests passed** |
| Existing booking UI plus new real-browser timezone cases, two workers, isolated port 4497 | **227 passed** = existing **223** + new **4**; 24 existing optional captures skipped |
| Existing smoke suite, isolated port 3097, separate serialized production build | **13 passed** |
| Exact-parent registrations/HTTP/schedulers; real standalone CLI codegen/function spec; actual schema exports | Passed, as detailed above |
| Committed historical schema/archive and CLI-gate tests | **2 files / 23 tests passed**, existing archive assertions and budgets unchanged |
| Both Phase 2 gate spellings on clean committed tree | **19/19 passed**; rerun after the documentation commit as well |

Initial full testing under unrestricted worker concurrency hit two five-second timeouts, including one existing archive test; the repeat uses `VITEST_MAX_WORKERS=4` without changing existing assertions or budgets. An initial Vite browser run overlapped source edits and lost page/focus contexts; the stable-source repeat passes every existing case. New browser test setup was corrected to supply the email required to render the notification checkbox. No production policy was changed for these test issues. The anonymous local CLI session and both local listener ports were stopped after final codegen/spec capture.

## Rollout and remaining work

Stable RPC/HTTP/scheduler contracts and equal actual schema exports support a compatible app rollout. This diff introduces no queue drain, traffic gate, reset, replay or backfill requirement. Root chooses operations from the actual deployment diff/state. Live pending/inflight/ambiguous job counts and delivery outcomes were not inspected. Supplied production is healthy at parent #78 merge `5449`, with no gate/pause; this task does not claim maintenance namespace #79 is deployed.

Parent src→convex/lib imports **70→0** and convex→src imports **1→0**. Shared→lib imports and cross-domain private leaks are **zero**; all nine domains remain. Phase **3d–f** still own wrapper/useOptional/as-never/demo/real-backend-CI removal, broad lint/architecture recipe and the dev loop. Phase **4** still owns return validators, audit-write and performance work. Remaining metrics include **24** as-never casts, **34** demo files, **three** CI placeholders, **one** file over 1,000 lines, no architecture recipe and **52** no-login return-validator gaps. The fixture's DB-like interaction simulation is retained; shared money/coupon/discount/date policies replace its relevant copied calculations. No later-phase metric or gate is relaxed.

Root owns independent Spec/Standards/financial review, parent PR79 exact-head CI/Preview acceptance, this draft's actual new Preview isolation/compatibility, production acceptance and merge. Local disconnected checks do not establish live provider, Clerk, payment/refund or delivery acceptance.
