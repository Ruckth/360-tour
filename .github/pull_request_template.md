## Change and ownership

Describe the user-visible result, owning domain, access policy and any schema/contract rollout. Link the issue or design. Identify intentional endpoint/table/inventory changes.

## Validation

- [ ] Bun 1.4.5 and Node 22; frozen install; `VITEST_MAX_WORKERS=4`; serial Next builds
- [ ] `bun check`, `bun run knip`
- [ ] Meaningful focused tests and full `bun run test:unit` (or included in integration)
- [ ] `bun run verify:integration` with the real isolated backend and dedicated Clerk test tenant
- [ ] Clean committed tree: `bun run arch:score --phase $(cat .arch-phase)`
- [ ] For unchanged-contract refactors: explicit-parent schema equality and registration/HTTP/scheduler comparison
- [ ] Describe failures, skipped checks, remaining limits and any required root-owned CI/Preview/live acceptance

## Screenshots and interaction evidence

- [ ] Changed UI: desktop and mobile; loading, empty, error, pending and success states
- [ ] Changed interaction: keyboard/focus and relevant money/access/refund regression
- [ ] Protected UI uses actual local Clerk authentication; component actors are identified separately
- [ ] Keep authenticated state/traces private; attach only reviewed evidence safe to share
- [ ] Or explain why no rendered UI changed

See [ARCHITECTURE.md](../ARCHITECTURE.md). Record runtime and deployment evidence separately from static gates.
