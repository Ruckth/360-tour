# Phase 4 production acceptance

The personal demo reopened on Vercel Hobby at 15:36:26 UTC on November 22, 2026. The public domain serves TanStack Start on Bun 1.4.x at merge `4d962227`. The merge has the same source tree as approved release `5e038d6f`. The previous Next deployment remains available by its recorded ID for rollback. [Public tour](https://tour.helpgueststay.com/rooms/pool-villa?tour=1) · [Phase 4 pull request](https://github.com/Ruckth/360-tour/pull/99) · [Operational record](phase4-production-acceptance-4d962227.json)

## Deployment and traffic

| Check | Production result |
| --- | --- |
| Main and PR | All 19 PR checks passed. Post-merge CI passed on attempt 3. A different booking fixture failed in each of the first two attempts, both in the same shard. Each affected scenario passed six focused local repeats before the shard passed on CI. [Main CI](https://github.com/Ruckth/360-tour/actions/runs/45036430885) |
| Convex | Deployed in place. The certificate accepted the existing data, with all 133 table digests matching the export before and after deploying the candidate into the isolated restore. Production data stayed in place throughout the cutover. [Compatibility and rehearsal](phase4-release-5e038d6f.md) |
| Protected deployment | At 15:08:22 and 15:13:36 UTC, anonymous guest-route checks and real-browser panorama checks passed. The SSR function reported Bun 1.4.x. All Convex origins found across 252 reachable guest scripts belonged to the production backend. |
| Production domain during the hold | At 15:30:17 and 15:35:33 UTC, both passes confirmed the Start renderer, live Clerk configuration and Instagram forwarding. Each browser opened the villa, observed a settled panorama, dragged it and saw the image change. |
| Reopened site | The same guest and browser checks passed without an operator header. The cache invalidation endpoint returned 401 to an unsigned request and 204 to a signed probe on the public domain. Convex delivery uses that stable origin and the temporary staged credential was removed from Convex. |
| Settings after observation | Automatic domain assignment is enabled. The public alias points to the approved deployment, with zero queued or staged production builds. Project routes and firewall settings match the baseline. All 10 expected crons are registered. The three production environment inventories passed against the updated names-only pin. The single addition was the production-only cache invalidation secret. |

The first maintenance route returned HTTP 503 with `Retry-After: 600` on all four guest paths. Vercel also sent `x-vercel-error: SERVICE_UNAVAILABLE`, so the strict live hold check failed. The operator immediately restored the original routing and verified the old Next site before proceeding.

The documented Hobby fallback used one host-scoped firewall rule. Guest requests with a missing or incorrect operator header returned 403 on all four paths. Operator requests reached the application, the exact Instagram callback reached Convex, and both immutable deployment URLs kept their existing deployment protection. After the second post-promotion pass, the rule was removed. Provider readback confirmed zero custom rules, the original settings and no pending firewall draft. Vercel assigned a new route version when restoring the original route contents.

## Public observation

From 15:36:26 to 16:06:49 UTC, Vercel returned 76 request records, 0 HTTP 5xx responses and 0 runtime errors. The logs reported full coverage of the queried interval. Convex recorded 108 completed operations and one function failure. The staff approvals query produced the same error digest in the pre-cutover baseline and after reopening. Scheduler checks found zero failed jobs. Anonymous guest probes passed at approximately 2, 10, 20 and 30 minutes. [Operational record](phase4-production-acceptance-4d962227.json)

The observation includes operator smoke traffic. The verified Instagram challenge reached Convex. Stripe webhook invocations in the receiver logs totaled 0. Independent Stripe and messaging-provider delivery dashboards were unavailable. Payment and replay behaviour were exercised in the isolated rehearsal and signed-in workflows were tested on the dedicated Preview. [Rehearsal](../../architecture/evidence/phase4/final-rehearsal-r20261122130842-c41978.md)

The accepted mobile timing replication and backend benchmarks remain separately attributed to their controlled workloads. [Performance and independent reviews](phase4-release-5e038d6f.md) · [Catalog query measurements](catalog-load.md)
