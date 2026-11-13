# Phase 3b: Services photo ctx-helper ownership closure

> Historical implementation evidence. Fixed-base move/proof commands below were retired in Phase 3e; retrieve them from parent `6a81d1715009bcb586f1dfd08f7b613b71334223` only to reproduce that history. Use [ARCHITECTURE.md](../../ARCHITECTURE.md) for current commands and ownership rules.


Exact parent: `39204f7a66e4ed91a076f4c6604ea0ccafc3fd63`, POS [PR #77](https://github.com/Ruckth/360-tour/pull/77), branch `t3/complete-pos-ownership`. Branch `t3/complete-services-photo-ownership` starts directly at that commit in the prepared isolated checkout `/Users/macbook/.t3/worktrees/360-tour/t3-8b2ea7c7-551d09a2b7490527`. No reset, rebase, parent rewrite or other checkout was used; the original dirty development checkout and root architecture checkout were untouched. No subagents.

The plan's five rules, nine-domain map and Phase 3b put staff, services and their managed photo uploads in Services. This closes the explicit `lib/adminPhotos.ts` obligation in the [Services closure record](phase3b-services-closure-implementation.md), preserving the final twelve-helper POS model and all root follow-ups in the [POS closure record](phase3b-pos-closure-implementation.md).

## Four unchanged implementations

`convex/lib/adminPhotos.ts` is deleted. Its actual implementations and comments move unchanged to `convex/services/private/photos.ts`; only the two relative generated-type import paths change. All production consumers are inside Services and import private directly. There is no forwarding stub, duplicate implementation or new model export.

| Helper | Actual callers and preserved behavior |
| --- | --- |
| `pendingAvatarUpload` | `commands/discardStaffAvatarUpload` and private `attachPhotoUpload`; same indexed `staffAvatarUploads.by_storageId` unique lookup. |
| `deleteStoredFile` | `commands/discardStaffAvatarUpload` and private `deleteUnreferencedPhoto`; same system-storage existence check before deletion. |
| `attachPhotoUpload` | `private/administration` through `attachAvatarUpload` / `attachServiceImage`, used by the existing create/update commands; same pending-upload and storage URL checks, error, pending-record consumption and return. |
| `deleteUnreferencedPhoto` | `commands/updateStaff` and `commands/updateService`; same two-row staff avatar URL reference guard and detached-staff exception before storage deletion. |

These helpers own ctx/database/storage work, not Catalog villa media or a pure shared policy. The existing pending-upload ownership, attachment, failed-save rollback and atomic delete-on-save semantics remain in the caller transaction. No pre-existing photo behavior is corrected or broadened. Cleanup still uses its original implementation, TTL, chunk size, guards and target.

## Exact-parent evidence

The small read-only `scripts/check-services-photos-closure.mjs` compares all **699 production source files** under convex/src against the exact parent. Whole source, including comments, types, literal contents and dependency bindings, must match after reversing only this helper's two type-import paths and the four caller import paths. Missing/extra production files, duplicate helpers, forwarding stubs or changes to the model fail. It also checks unchanged package/lockfile, generated server/data-model declarations and `.arch-phase`.

All **381 RPC registrations**, **295 explicit public / zero raw**, and **55 scheduler/cron callsites** retain exact source and bindings. Full HTTP routing and ingress sources are identical. Actual anonymous local CLI metadata independently matches every RPC identifier and counts **ten HTTP actions**. Generated API changes contain only the removed lib module and added Services private module; registrations have no path, builder, capability/reason, validator, args/return, handler or authorization change.

Actual `schema.export()` values equal the exact parent: **74 base/current/static tables**, SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Only object keys and top-level table order normalize; other array ordering remains significant. Schema/data, durable keys, stored job targets/args/due times, attempts, leases and queue state are unchanged. `.arch-phase` remains **2**.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/check-services-photos-closure.mjs output/phase3b-services-photos/local-function-spec.json
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base 39204f7a66e4ed91a076f4c6604ea0ccafc3fd63 --out output/phase3b-services-photos
```

## Validation and limits

Node **22.22.3**; frozen dependencies. Real installed Convex **1.34.1** CLI initialized a new anonymous checkout-local backend at `http://127.0.0.1:3530` (HTTP 3531), `.convex/local/default/`. CLI processes used an empty inherited environment and a new ignored HOME under this checkout, with no shared credentials/config. Initial preparation required setting the deliberately nonfunctional issuer `https://services-photos-local.invalid` on that local backend; component-aware generation, standalone codegen and metadata capture then passed. The local dev session was stopped afterward. No seed, reset, eval or business acceptance RPC was run.

Existing ownership tests now reject retired `lib/adminPhotos` imports/module access for anonymous and owner callers, require photos in the actual Services runtime closure, and prevent unused photo exports. Existing behavioral assertions and explicit **30-second archive budgets** are unchanged.

| Check | Result |
| --- | --- |
| Full `pnpm verify` | Pass: app/test/Convex types, lint, **239 files / 2,886 tests**, production Next build |
| `pnpm exec eslint . --max-warnings 0`; `pnpm knip` | Pass, zero warnings and no Knip findings/config hints |
| Focused Services/admin/roster/photo/booking/POS/durable/ownership suites | **32 files / 607 tests passed** |
| `pnpm test:booking-ui --workers=2` | **223 passed**, 24 existing opt-in captures skipped |
| `E2E_PORT=3093 pnpm test:e2e:smoke` | **13 passed**, separate serialized production build after verify |
| Exact-parent source/binding proof, actual schema exports, real CLI codegen/metadata | Pass as above |

Ignored logs, schema exports and CLI metadata are under `output/phase3b-services-photos/`. Committed-tree archive/gate results are recorded in the PR handoff after committing this source.

## Compatible rollout and remaining debt

Equal registration/HTTP/scheduler contracts and actual schema exports support a normal compatible rollout with **no gate, drain, queue replacement, reset or backfill** introduced by this move. Refer to the linked Services/POS records for the unchanged job inventories and runbooks; do not apply historical namespace-retirement operations to these unchanged contracts. Root's supplied baseline is healthy Services production at `ce7b1c4`, with no gate or pause; this task did not inspect live state or claim any queue. Pending/in-progress/failed/ambiguous job counts and external delivery outcomes remain unknown.

Root owns reviews, the **actual new Preview** isolation/acceptance, production operations and merge. Disconnected UI and local convex-test/CLI results do not establish live Clerk, provider, payment/refund or delivery acceptance. No shared/dev/prod deployment, secret access, live provider/model/email/social call or external message occurred.

Phase 3 is not complete. Pure `lib/imageUploads` policy, dates/resort-time, money, validation and other shared/frontend rule consolidation remain **3c**; generic maintenance and seed/eval organization follow later. Existing metrics, gates, archive/eval/retirement fixes and policy debt remain unchanged.
