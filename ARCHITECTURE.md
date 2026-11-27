# Architecture and feature recipe

Read this before changing application code. The [plan](docs/plans/scalable-architecture-plan.html) records the migration decisions; [implementation records](docs/architecture/phase3f-implementation.md) record evidence, not permanent source snapshots. `.arch-phase` is **4**: domain ownership, local development, seeded Preview/auth/rebuild acceptance, no-login return contracts and measured hot spots are implemented and verified. The Phase 4 production initialization preserves source data and existing public responses.

## Frontend entry

TanStack Start is the only frontend entry. It lives in `src/start-app`, with flat file routes in `src/start-app/routes`. Shared views live in `src/components` and import framework services (auth, image, intl, link, navigation, dynamic) through `@/platform`, which holds the Start adapters. The Start adapter caches raw anonymous villa data across locales. Fresh entries last 60 seconds, then can serve for an additional hour while a worker refreshes them. [Cache state and recovery](docs/plans/benchmarks/room-preview-cache.md). The Next app entry was retired in the Phase 4 PR's last commit. Its final source is that commit's parent, the Preview-accepted dual-entry Start-default checkpoint, recorded as a full commit SHA in `scripts/dual-entry-checkpoint.mjs`; route parity tooling reads that tree from git. Old live Next stays the production alias until the Phase 4 cutover.

Use Bun 1.4.5 with Node 22. Run `bun check` to type-check the app, tests and Convex, then run lint. Run `bun run test:e2e` to build and exercise Start with the local seeded backend and Clerk test identities, then run `bun run bench:routes` against the resulting assets. The [route inventory](docs/plans/benchmarks/start-routes.md) records HTTP and rendering contracts. The [Preview QA instructions](tests/e2e/preview-qa.md) cover the authenticated workflows.

`bun run dev`, `bun run build` and `bun run preview` serve Start, and `bun run verify` builds it. On Vercel, `vercel.json` selects the Other framework preset (`"framework": null`) so the Nitro Build Output API is used, and `bun run vercel-build` builds Start; `FRONTEND=next` fails before any deploy and names the dual-entry checkpoint SHA. The build takes the Convex URL from the verified deployment callback. `FRONTEND_ONLY_CONVEX_URL` builds only the frontend against an already deployed backend, with no Convex deploy or seed: production accepts only the production URL, Preview only a preview URL. Vercel runs the Nitro function on Bun 1.4.x by default. The protected Start Preview passed on Bun 1.4.4. Set `START_SSR_RUNTIME=node` on an individual build to use the Node 22 fallback. The public build keys are listed in `vite.start.config.ts`. To return to Next, use Instant Rollback to a recorded Next deployment, or build the dual-entry checkpoint (or an older revision) through that revision's own commands (see the [Phase 4 cutover runbook](docs/architecture/phase4-cutover-runbook.md) §7). `scripts/cutover-rehearsal.mjs` builds each rehearsed revision through its own frontend selection, including an OLD revision's explicit Next rebuild.

## Ownership and useful interfaces

| Owner | Responsibilities |
| --- | --- |
| `convex/auth` | Identity, staff grants, capabilities, admin policy and access builders |
| `convex/branches` | Branch identity, issuer details, lifecycle, and branch access checks |
| `convex/catalog` | Properties, tour scenes, reviews, review stats and OTA rates |
| `convex/bookings` | Stays, availability, date blocks, iCal, stay payments/refunds and Stripe |
| `convex/services` | Services, staff/rosters/time off, appointments and their finance |
| `convex/pos` | Orders/lines/payments/refunds, customers, tills, displays and approval requests |
| `convex/commerce` | Product catalog, branch stock and its movement ledger, supplier purchasing, lot custody and stock reservations |
| `convex/marketing` | Campaigns/links/attribution, coupons, affiliates, credits and service profitability. Finance owns effective-dated service costs and monthly service accounts. |
| `convex/messaging` | Conversations/messages, guest credentials, durable channel ingress and delivery |
| `convex/concierge` | Turn orchestration, context, prompts, model/tool execution |
| `convex/settings` | Configuration, cashier rules, configuration and record history |

Each domain owns `tables.ts`, endpoint registrations and its ctx implementations. Other backend domains import **only `model.ts`**, including for types. A model is a small, named interface over actual plain implementations; private implementation files may compose useful internal seams. Do not add forwarding endpoints or a generic architecture framework. Registrations belong to their domain, never a new root or `lib` file. Maintenance scripts/seed scenarios live under `convex/maintenance`; focused tests and harnesses may cross private seams intentionally. Production never imports tests.

`convex/schema.ts` assembles domain tables; `http.ts` assembles routes and the messaging ingress factory; `crons.ts` registers schedules. `auth.config.ts` and `convex.config.ts` configure the backend. Root declaration files supply types. The only current `convex/lib` infrastructure is `maintenance` and invocation-scoped `readBudget`. Do not put new business ctx implementations there. A real new infrastructure need requires a deliberate, tested ownership decision, not broad directory exemptions.

`convex/shared` owns pure rules: money/rounding, fixed UTC+7 resort time, dates, phone, pricing, overlap, scheduling and time off. It receives data and returns results, with no server ctx, environment, network, registration builders, backend lib or browser implementation. Its runtime imports are shared leaves, `convex/values` validators and the existing pure `libphonenumber-js/min` parser. Generated data-model imports must be type-only. New external shared dependencies need an explicit purity review. Browser Date adapters and Intl presentation stay in `src`; database reads and side effects stay in the owning backend domain. Use `shared/pricing.calculateDirectQuote` for actual quote calculations and `shared/money` for integer **satang** and basis points. Do not duplicate financial policy in UI fixtures.

Browser code imports `convex/shared`, generated `api` references and generated data types, plus the Convex client SDK. Never import backend `model`, `private`, endpoint or `lib` code into `src`, even as types. Use `FunctionArgs`/`FunctionReturnType` and `Doc`/`Id` when needed. Backend code never imports `src`. Components call `useQuery`, `useMutation`, `useAction` or a real Convex client directly. Keep the mandatory Clerk provider, real empty/error states and existing per-record tokens; do not add optional clients, demo success or backend wrappers.

Only **`convex/auth/model.ts`** imports raw public builders. Endpoint files use its explicit public/guest/device/authenticated/staff/admin/marketing builders or internal builders. Internal reexports in this model deliberately retain existing behavior. When adding an access builder, register its verified policy in the source inspector; unknown registration-looking factories fail explicitly. Public reason, staff capability and marketing permission declarations remain explicit; guest/device/per-record authorization is still required. Actions authenticate without a database context. HTTP uses the model's maintenance-aware `httpAction`.

The source guards resolve relative paths, directory imports, aliases, type imports, dynamic imports, `require`, renamed bindings, namespaces and reexports across `.ts`, `.tsx`, `.js` and `.mjs`. They scan the complete installed Convex entry-extension list; `.cjs`, `.mts`, `.cts` and `.jsx` backend entries fail explicitly until their inspection is supported. Folder names such as `testing` do not exempt deployed files from builder checks. Test infrastructure may compose private helpers, but cannot register endpoints. Prefer named static builder imports and `export const name = builder({ ... })`. Unsupported indirect builder bindings or computed module paths fail with guidance instead of disappearing from counts. The existing fixed-path locale JSON loader is the narrow exception. Type-only imports do not create runtime cycles. Model exports may expose a plain helper that shares a source file with an endpoint (the existing concierge turn); they must not forward the registered endpoint itself.

## Worked feature recipe: property notes

This example adds a bounded admin-only note list to **catalog**. It is documentation, not a shipped schema change. Follow the same sequence for a real feature and update the reviewed table target/inventory when the product feature actually changes them; never adjust a target just to hide a failure.

1. Add the table to `convex/catalog/tables.ts`, using `defineTable` from `convex/server` and `v` from `convex/values`. Root schema already spreads `catalogTables`.

   ```ts
   propertyNotes: defineTable({
     propertyId: v.id('properties'),
     text: v.string(),
     createdAt: v.number(),
   }).index('by_propertyId', ['propertyId']),
   ```

   Keep one note per document. Add an appropriate index before adding a query. Assess existing data before making required-field changes; do not reset a populated deployment to make a feature pass.

2. Register actual implementations in `convex/catalog/propertyNotes.ts`. This uses the existing admin policy. A feature intended for desk roles must choose the relevant staff capability instead of widening admin access.

   ```ts
   import { v, ConvexError } from 'convex/values';
   import { adminMutation, adminQuery } from '../auth/model';

   export const list = adminQuery({
     args: { propertyId: v.id('properties') },
     handler: async (ctx, { propertyId }) =>
       ctx.db.query('propertyNotes')
         .withIndex('by_propertyId', q => q.eq('propertyId', propertyId))
         .order('desc').take(50),
   });

   export const add = adminMutation({
     args: { propertyId: v.id('properties'), text: v.string() },
     returns: v.id('propertyNotes'),
     handler: async (ctx, { propertyId, text }) => {
       const trimmed = text.trim();
       if (!trimmed || trimmed.length > 2000) {
         throw new ConvexError({ code: 'INVALID_NOTE', message: 'Enter a note of 1–2,000 characters.' });
       }
       if (!await ctx.db.get(propertyId)) {
         throw new ConvexError({ code: 'NOT_FOUND', message: 'Property not found.' });
       }
       return ctx.db.insert('propertyNotes', { propertyId, text: trimmed, createdAt: Date.now() });
     },
   });
   ```

   Add an explicit list return validator for its intended projection, especially if exposing data without login. Keep authorization and transaction logic in the registration until a plain helper earns a useful interface. If another domain needs note behavior, expose the actual plain helper through `catalog/model.ts`; do not import this registration or make a forwarding endpoint. Regenerate types against your explicitly selected isolated local backend. Update `docs/architecture/phase3a-access-inventory.md` with every new access-builder registration (including admin, staff and guest) and its policy, then add meaningful authorization, invalid-input, ordering and bounded-list tests using the real schema/harness.

3. Build `src/components/admin/properties/PropertyNotes.tsx` and place it in the existing property detail screen, or add a thin `src/start-app/routes/admin.property-notes.tsx` route that renders its view. Register navigation only if the feature needs a new destination. In the client view use generated references directly:

   ```tsx
   'use client';
   import { useState } from 'react';
   import { useMutation, useQuery } from 'convex/react';
   import { api } from 'convex/_generated/api';
   import type { Id } from 'convex/_generated/dataModel';

   export function PropertyNotes({ propertyId }: { propertyId: Id<'properties'> }) {
     const notes = useQuery(api.catalog.propertyNotes.list, { propertyId });
     const add = useMutation(api.catalog.propertyNotes.add);
     const [text, setText] = useState('');
     const [pending, setPending] = useState(false);
     const [error, setError] = useState('');
     async function submit(event: React.FormEvent<HTMLFormElement>) {
       event.preventDefault();
       setPending(true);
       setError('');
       try {
         await add({ propertyId, text });
         setText('');
       } catch {
         setError('Could not save this note. Try again.');
       } finally {
         setPending(false);
       }
     }
     return <form onSubmit={submit}>
       <label>Note<textarea value={text} onChange={event => setText(event.target.value)} /></label>
       <button disabled={pending}>Save note</button>
       {error && <p role="alert">{error}</p>}
       {notes === undefined ? <p>Loading notes…</p>
         : notes.length === 0 ? <p>No notes yet.</p>
         : <ul>{notes.map(note => <li key={note._id}>{note.text}</li>)}</ul>}
     </form>;
   }
   ```

   Use existing UI primitives, translations, capability UI and the admin error boundary for the complete product screen. Never synthesize notes on failure. Await writes at the operation boundary and present actionable errors. Effects can explicitly `void` an operation only when its failure handling and cancellation already live inside it; `void` itself does not catch rejection. `no-floating-promises` is checked by type-aware oxlint through `bun run lint:types`, including app/backend/tests/scripts; ESLint runs without a type program; `no-misused-promises` is not enabled.

4. Validate and capture evidence. Include desktop/mobile, loading/empty/error, keyboard/focus, pending and successful save states for a changed UI. For protected screens use the actual local Clerk session; component actors are separate focused test tools. Keep authenticated artifacts private. No screenshot is needed for this Phase 3e tooling/documentation change because it changes no rendered behavior.

## Tour room limits and legacy data

A new or duplicated tour can contain up to 50 rooms. On reads, the catalog orders each villa's rooms by its saved `tourRoomIds`, then by creation order for unlisted rooms. The public endpoint returns the first 50 in that order. The staff editor can inspect, reorder and remove imported rooms up to a 500-row, 2 MiB indexed read budget. Duplicate and add operations cannot extend a tour beyond 50.

The 2 MiB limit is inclusive. An optional `tourScenes.ordinaryTourCertified` marker records that the scene belongs to a tour with at most 50 current scenes. Adding a room proves the total through a bounded indexed read. Duplicating a tour copies all scenes only after a bounded read verifies the size. The empty-database fixture knows exactly which scenes it inserts. Removing scenes can only reduce the count, and the application cannot grow a certified tour past 50.

A growing edit to an unmarked room can mark that room only after an indexed read reaches the end of a range with at most 50 scenes. The same transaction writes the marker, edited room and audit. A short-circuited read leaves the room unmarked. Edits to certified rooms use the scene already read, with no parent read or tour-size traversal. An oversized tour still checks its shared headroom against the indexed range. Non-growing name and image edits need no scene scan. Hotspot edits reuse their target-validation scan.

Older rows have no marker and need no required migration or reset. The [certificate recovery runbook](docs/architecture/tour-certificate-recovery.md) covers partial imports, manual writes and rollback. None of those paths may resume ordinary writes with stale markers.

Room history retains the full before and after snapshots when they fit in a Convex document. Larger entries retain changed fields only. A changed value that still cannot fit is recorded with a bounded preview, its size and a SHA-256 fingerprint. Large room names use a shortened label in history discovery, including after deletion.

An import exceeding the recovery budget produces an explicit error. Recover from a verified data export on an isolated target: reduce the affected villa to at most 50 rooms, remove retired slugs from the order list and remove their hotspot and snippet references before importing. Verify the ordered guest response and editor against the corrected export before any shared-target change.

## Current validation commands

Use Bun 1.4.5 (see `.bun-version`), Node 22 and `VITEST_MAX_WORKERS=2` locally (CI defaults to four). Vitest caps this ceiling at available CPUs. Heavy commands enter the shared three-slot queue.

```sh
bun install --frozen-lockfile
bun check                   # full static gate
bun run check:fast              # TS 7 types, typed oxlint, cached untyped ESLint
bun run typecheck               # app/test/Convex TS 7 checks in parallel
bun run lint                    # untyped ESLint --max-warnings 0 + typed oxlint
bun run knip
bun run test:unit               # all four Vitest projects, queued; full former default
bun run test:pure               # pure/Node tests and pure backend leaves
bun run test:guards             # serial CLI/repository guards, 60-second default timeout
bun run test:dom <file-filter>   # DOM views, same real Convex harness
bun run test:convex <filter>     # edge-runtime backend suites
bun run verify:integration      # types, zero-warning lint, unit/backend, build, component UI, real Clerk E2E
bun run arch:score --phase 4    # clean-tree is reported, not gated
bun run arch:score --phase4     # equivalent spelling, 31 completed-phase gates
```

GitHub runs the Start integration suite on its own fresh backend and checks the bundle produced by that build. In CI, E2E specs use one Playwright worker by default to stay within the shared Clerk sign-in quota. The allowlisted anonymous specs overlap on up to two additional workers and use seeded inventory or isolated browser and guest state. Playwright builds the component fixture pages with production React before starting Chromium. Vite Preview serves the same browser assets throughout the run, while the checkout fixture API uses the SSR loader for the test database. Component CI distributes source lines from each fixture across eight runners and checks the selected Playwright case IDs before execution. The development restart test has its own runner and the static job covers Convex typechecking. The final `verify` job requires every lane to succeed. Keep rule permutations in Vitest or the Convex harness. Use Playwright for behavior that depends on Chromium, such as focus, layout, touch, printing and multiple tabs. To capture the optional evidence images while running the booking, payment, returns or marketing-spend specs, set `CAPTURE_SCREENSHOTS=1`.

A scorecard phase flag measures/reports only metrics due through that phase; omit the flag for the complete report. CI uses `.arch-phase` (currently 4), so all 31 completed-phase gates remain enforced. The `clean-tree` count of modified tracked files is advisory and never fails a phase run, and required test files execute in one bounded Vitest run and count only with nonzero cases all passing (no skipped, pending or todo cases). Each file must also report every explicitly required regression title as passed; deleting or renaming a required case fails the gate even if its remaining cases pass. The 16 required titles are listed with their owning files in `scripts/arch-scorecard.mjs`. Phase 0 requires one file, Phase 1 two, Phase 2 two and Phase 4 one. This adds a small backend-suite run to static CI and scorecard invocations.

`bun run verify` holds one machine-wide heavy slot while running typechecks, zero-warning lint, all four test projects and the Start production build with the configured app variables. The full static gate runs once per verification. On Vercel, the wrapper checks the frontend and test projects, then Convex checks its own project during deployment. With no configuration it must fail clearly. `bun run verify:integration` provisions its own anonymous local Convex, seeds only that fresh backend and uses three dedicated Clerk test fields from CI or ignored mode-600 `.env.e2e.local`. Run-owned test users are removed afterward. It refuses production Clerk keys and disables outbound business providers. `bun run test:booking-ui` covers component/browser behavior; `bun run test:e2e` owns a complete local backend/auth/build lifecycle. Heavy commands use `scripts/heavy.mjs` (three shared slots; nested calls reuse their slot). Keep this checkout’s heavy commands sequential and set `VITEST_MAX_WORKERS=2` locally; CI defaults to four workers and bypasses the machine queue.

For a refactor that claims unchanged backend contracts, compare to its **explicit reviewed parent**, not an old universal snapshot:

```sh
node scripts/schema-equivalence.mjs --base <reviewed-parent> --out output/schema-equivalence
node scripts/check-function-contracts.mjs --base <reviewed-parent>
# Optional metadata evidence, captured privately from that same local backend:
node scripts/check-function-contracts.mjs --base <reviewed-parent> --local-spec <private-function-spec.json>
```

The first compares actual schema exports offline; the second checks registration initializers/builder bindings and full HTTP/scheduler source for that refactor. These are equivalence tools, not restrictions against adding features. For an intentional contract change, review the actual schema/data rollout and update coverage/inventory deliberately. Active reset/maintenance artifact generation, rollback safety and historical schema restoration tests remain supported; follow the [reset runbook](docs/architecture/phase1-reset-runbook.md) for authorized operations. One-shot Phase 3b/3c move generators and fixed-base source proofs are historical, retired in 3e and recoverable from git. Their old commands are not current validation.

`bun run dev` now owns one private persistent checkout-local anonymous Convex and Start lifetime; it requires mode-600 `.env.dev.local`, explicit Clerk test owners and no inherited deployment target, and seeds only an empty database. `bun run test:dev` exercises restart/auth/SIGINT/failure behavior with unique run-owned users. See the [Phase 3f operations runbook](docs/architecture/phase3f-operations.md) for command interfaces, focused Vitest projects, guarded deploy→seed→Next Preview ordering and conservative offline retention. Root owns actual key/environment settings, live Preview acceptance and all retention deletion. The [Phase 4 implementation record](docs/architecture/phase4-implementation.md) documents return contracts, measured read budgets, additive initialization and the canonical appointment audit. A passing static report does not prove live initialization, deployment acceptance or provider delivery.


No-login return validators live in the owning domain's `validators.ts`; reuse appropriate stored shapes while explicitly selecting public fields. Projection-only fields stay off admin browser responses; Web delivery/tool evidence remains on the event. Message writes update the conversation head through `patchSessionAfterMessages`; channel-event inserts/patches use the messaging projection writers. The existing `inboxState` is the canonical staff-work state. Missing projection versions retain live reads until bounded initialization completes; preserve cursor source indexes through cutover. Cross-domain callers use `messaging/model.ts`, including the guarded eval writer's initialized projection refresh. Review writers adjust exact sum/count in the owning transaction before changing the review. New appointment history writes one typed `recordChanges.appointmentAudit` payload; retain the merged historical reader and widened schema during rollback. Follow the Phase 4 runbook before any populated deployment cutover.

The endpoint caller guard checks supported static call/reference wiring, following local reference aliases. It does not prove runtime reachability or that a caller branch executes. Dead strings, imports and reference declarations alone do not establish a caller.

Caller inspection recognizes named Convex hooks (including pagination and useQueries request objects), client/ctx calls, scheduler and cron arguments, HTTP route handlers and the two existing eval CLI wrappers. Local aliases and literal API property paths are resolved within a file. This is syntactic wiring evidence: it does not perform cross-file data-flow, scope/type checking of same-named client methods, arbitrary wrapper inference or control-flow reachability. The five manual operator exemptions retain their existing reasons.
