## Change and ownership

Describe the user-visible result, owning domain, access policy and any schema/contract rollout. Link the issue or design. Identify intentional endpoint/table/inventory changes.

## Validation

- [ ] Node 22; frozen install; `VITEST_MAX_WORKERS=4`; serial Next builds
- [ ] `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm knip`
- [ ] Meaningful focused tests and full `pnpm test:unit` (or included in integration)
- [ ] `pnpm verify:integration` with the real isolated backend and dedicated Clerk test tenant
- [ ] Clean committed tree: `pnpm arch:score --phase 2` and `pnpm arch:score --phase2`
- [ ] For unchanged-contract refactors: explicit-parent schema equality and registration/HTTP/scheduler comparison
- [ ] Describe failures, skipped checks, remaining limits and any required root-owned CI/Preview/live acceptance

## Screenshots and interaction evidence

- [ ] Changed UI: desktop and mobile; loading, empty, error, pending and success states
- [ ] Changed interaction: keyboard/focus and relevant money/access/refund regression
- [ ] Protected UI uses actual local Clerk authentication; component actors are identified separately
- [ ] Keep authenticated state/traces private; attach only reviewed evidence safe to share
- [ ] Or explain why no rendered UI changed

See [ARCHITECTURE.md](../ARCHITECTURE.md). Passing a static score does not authorize a deploy, reset or Phase 3 ratchet.
