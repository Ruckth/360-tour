# Architecture and feature recipe

Read this before changing application code. The [plan](docs/plans/scalable-architecture-plan.html) records the migration decisions; [implementation records](docs/architecture/phase3f-implementation.md) record evidence, not permanent source snapshots. `.arch-phase` is **3**: domain boundaries, local development and live seeded Preview/auth/rebuild acceptance are proven. Phase 4 contracts and measured hot spots remain.

## Ownership and useful interfaces

| Owner | Responsibilities |
| --- | --- |
| `convex/auth` | Identity, staff grants, capabilities, admin policy and access builders |
| `convex/catalog` | Properties, tour scenes, reviews, review stats and OTA rates |
| `convex/bookings` | Stays, availability, date blocks, iCal, stay payments/refunds and Stripe |
| `convex/services` | Services, staff/rosters/time off, appointments and their finance |
| `convex/pos` | Orders/lines/payments/refunds, customers, tills, displays and approval requests |
| `convex/marketing` | Campaigns/links/attribution, coupons, affiliates and credits |
| `convex/messaging` | Conversations/messages, guest credentials, durable channel ingress and delivery |
| `convex/concierge` | Turn orchestration, context, prompts, model/tool execution |
| `convex/settings` | Configuration, cashier rules, configuration and record history |

Each domain owns `tables.ts`, endpoint registrations and its ctx implementations. Other backend domains import **only `model.ts`**, including for types. A model is a small, named interface over actual plain implementations; private implementation files may compose useful internal seams. Do not add forwarding endpoints or a generic architecture framework. Registrations belong to their domain, never a new root or `lib` file. Maintenance scripts/seed scenarios live under `convex/maintenance`; focused tests and harnesses may cross private seams intentionally. Production never imports tests.

`convex/schema.ts` assembles domain tables; `http.ts` assembles routes and the messaging ingress factory; `crons.ts` registers schedules. `auth.config.ts` and `convex.config.ts` configure the backend. Root declaration files supply types. The only current `convex/lib` infrastructure is `adminEmails`, `maintenance` and invocation-scoped `readBudget`. Do not put new business ctx implementations there. A real new infrastructure need requires a deliberate, tested ownership decision, not broad directory exemptions.

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

3. Build `src/components/admin/properties/PropertyNotes.tsx` and place it in the existing property detail screen, or add a thin `src/app/admin/property-notes/page.tsx` that renders its view. Register navigation only if the feature needs a new destination. In the client view use generated references directly:

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

   Use existing UI primitives, translations, capability UI and the admin error boundary for the complete product screen. Never synthesize notes on failure. Await writes at the operation boundary and present actionable errors. Effects can explicitly `void` an operation only when its failure handling and cancellation already live inside it; `void` itself does not catch rejection. `no-floating-promises` is enabled with the installed Next TypeScript parser/plugin and an explicit lint TSConfig that includes tests/scripts; `no-misused-promises` is not enabled.

4. Validate and capture evidence. Include desktop/mobile, loading/empty/error, keyboard/focus, pending and successful save states for a changed UI. For protected screens use the actual local Clerk session; component actors are separate focused test tools. Keep authenticated artifacts private. No screenshot is needed for this Phase 3e tooling/documentation change because it changes no rendered behavior.

## Current validation commands

Use Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH` on this Mac) and `VITEST_MAX_WORKERS=4`. Vitest caps this ceiling at available CPUs. Serialize Next builds.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint                    # standard command always uses --max-warnings 0
pnpm knip
pnpm test:unit               # all three Vitest projects; full former default
pnpm test:pure               # pure/Node/tooling and pure backend leaves
pnpm test:dom <file-filter>   # DOM views, same real Convex harness
pnpm test:convex <filter>     # edge-runtime backend suites
pnpm verify:integration      # types, zero-warning lint, unit/backend, build, component UI, real Clerk E2E
pnpm arch:score --phase 3    # run on a clean committed tree
pnpm arch:score --phase3     # equivalent spelling, 30 completed-phase checks
```

A scorecard phase flag measures/reports only metrics due through that phase; omit the flag for the complete report. CI uses `.arch-phase` (currently 3), so all 30 completed-phase gates remain enforced.

`pnpm verify` runs typechecks, zero-warning lint, unit/backend tests and a production build with real configured app variables. With no configuration it must fail clearly. `pnpm verify:integration` provisions its own anonymous local Convex, seeds only that fresh backend and uses three dedicated Clerk test fields from CI or ignored mode-600 `.env.e2e.local`. Run-owned test users are removed afterward. It refuses production Clerk keys and disables outbound business providers. `pnpm test:booking-ui` covers component/browser behavior; `pnpm test:e2e` owns a complete local backend/auth/build lifecycle. Never run two Next builds concurrently.

For a refactor that claims unchanged backend contracts, compare to its **explicit reviewed parent**, not an old universal snapshot:

```sh
node scripts/schema-equivalence.mjs --base <reviewed-parent> --out output/schema-equivalence
node scripts/check-function-contracts.mjs --base <reviewed-parent>
# Optional metadata evidence, captured privately from that same local backend:
node scripts/check-function-contracts.mjs --base <reviewed-parent> --local-spec <private-function-spec.json>
```

The first compares actual schema exports offline; the second checks registration initializers/builder bindings and full HTTP/scheduler source for that refactor. These are equivalence tools, not restrictions against adding features. For an intentional contract change, review the actual schema/data rollout and update coverage/inventory deliberately. Active reset/maintenance artifact generation, rollback safety and historical schema restoration tests remain supported; follow the [reset runbook](docs/architecture/phase1-reset-runbook.md) for authorized operations. One-shot Phase 3b/3c move generators and fixed-base source proofs are historical, retired in 3e and recoverable from git. Their old commands are not current validation.

`pnpm dev` now owns one private persistent checkout-local anonymous Convex and Next lifetime; it requires mode-600 `.env.dev.local`, explicit Clerk test owners and no inherited deployment target, and seeds only an empty database. `pnpm test:dev` exercises restart/auth/SIGINT/failure behavior with unique run-owned users. See the [Phase 3f operations runbook](docs/architecture/phase3f-operations.md) for command interfaces, focused Vitest projects, guarded deploy→seed→Next Preview ordering and conservative offline retention. Root owns actual key/environment settings, live Preview acceptance and all retention deletion. Phase 4 still owns the public return-validator sweep, read budgets/performance changes and audit-writer changes. A passing static Phase 3 report does not prove those exits, live deployment acceptance or provider delivery.
