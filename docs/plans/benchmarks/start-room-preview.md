# First TanStack room deployment

The first room slice from Phase 2 rendered the villa heading in the HTML returned by Vercel. On the Next control the same heading was inside a hidden streaming container, with the loading message visible without JavaScript. The control deployment was `dpl_8EZ5F1F2PEMVBPT1pvWwETKBPVc3`. Both Start deployments used that control's public, seeded Convex Preview data and Clerk test instance.

| Anonymous request | Node 22.23.5 | Bun 1.4.4 |
| --- | --- | --- |
| `/rooms/pool-villa?tour=1` | 200, English, visible villa heading | 200, English, visible villa heading |
| `/th/rooms/pool-villa?tour=1` | 200, Thai document | 200, Thai document |
| `/rooms/never-a-real-villa` | 404, “Property not found” | 404, “Property not found” |
| `/en/rooms/pool-villa?tour=1` | 307 | 307 |
| `/garden-image.jpg` | 308 | 308 |

The guest responses had 12 language alternatives. Repeating an English room read on Node produced an actual `x-villa-cache: hit` after a miss. The Bun deployment then read the shared Preview cache. These checks use the application data-cache header and the runtime's own version header.

Node deployment `dpl_47wdYDWYwbDmFRZb6FcTqwd5LLwo` and Bun deployment `dpl_834hoQKUiw65GdWXA8P8vR7L1bLx` used identical Nitro application function bytes. The function's runtime setting selected each arm. SHA-256 over the sorted function filenames and contents, excluding the runtime descriptor, was `7b354239fea18109345bda8be629df6a23cc5ccc62c7be528067356f099a7d3e`. Vercel selected the hosted Bun patch for `bun1.4.x`. Local and CI tooling use Bun 1.4.5.

The requests used the authenticated Vercel CLI to cross deployment protection. They had no app session cookie. Timing and the natural cache-hit rate have separate paired measurements.

## Full application with hosted Clerk and Convex

At `ccf2208cc2a2b614b382582f4464219ccbff1a92`, the full Bun Preview passed two browser runs on deployment `dpl_GoqSNQ9YTdaCfdZPQveUtYYLAHgg`. The runner verified the immutable deployment, the browser's published Convex and Clerk configuration, the seeded backend and provider isolation before creating fixtures.

| Workflow | Observed result |
| --- | --- |
| Public payment and success screens | Missing credentials produced the expected state with browser Convex traffic blocked |
| Staff authorization | Owner, cashier and nonstaff followed their respective access paths. Sign-out removed cashier access |
| Booking and chat | A booking reached the payment handoff. Reloading the chat restored its transcript |
| Live tour | Open tabs reconciled a scene reorder and archive, including a disconnected tab after it reconnected |
| Teardown | Fixture records and run-owned Clerk users were removed, the temporary cashier grant was revoked, and the original owner list was restored |

The [hosted QA runner](../../../tests/e2e/preview-qa.md) records pass or fail for each stage. The initial run also verified that the Vercel function returned HTTP 200 with `x-start-provider-isolation: verified` and `x-start-runtime: bun/1.4.4`.

The complete hosted QA suite passed again on `508d1ca5ce91ba7d2a85c68479954e61b1230bed` after the admin rendering, 404 metadata and cache generation changes. It verified the protected Preview and matching seeded backend, exercised the anonymous payment screens, owner and cashier access, sign-out, a booking hold, chat restoration and live tour changes, then removed its fixtures and run-owned test identities. The same deployment passed all 61 HTTP route checks. [Route results](start-routes.md)

The same authenticated workflows and fixture teardown passed on `20b465346d24e6313dac2eda6c308d9ef39881df` with the out-of-order recovery fix and shared-cache scope checks.

The full browser workflow passed again on protected deployment `dpl_9ag7e6fb2n6XY2CedKQxQgBUAnbX`, built from `86a3b5cddc84a4d839356518ff6b28b00d3ee9ae`. The provisioner verified the deployment and isolated backend, exercised read-only checkout, staff roles and sign-out, booking, chat restoration and live tour changes, and recorded successful teardown. This is the same application revision used for the 61-route comparison and the separate 108-response outage and recovery test. [Route results](start-routes.md) · [Authenticated cache acceptance](start-villa-preview-outage/swr/attempt6-86a3b5cd-passed.json)

On `86a3b5cd`, the deployed Vercel image optimizer fetched the same permitted Unsplash photograph used by the homepage hero. A request for 640 px at quality 75 returned HTTP 200 with `image/avif`. Sharp decoded a 640 × 720 image from 31,022 bytes. The full route report also verifies the local image and the HTTP 400 response for an unapproved host. [Image route contracts](start-routes.md)

## Local integration checks

On 22 November 2026 a clean checkout of `68148b8d` ran the release checks on Node 22.22.3 and Bun 1.4.5 with at most two local test workers. It used a seeded, checkout-local Convex backend and dedicated Clerk test identities.

| Check | Observed result |
| --- | --- |
| `check:fast`, knip and the architecture scorecard | Passed, including 32 of 32 architecture rules |
| Unit, DOM, backend and repository tests | 4,139 passed across 363 files |
| Booking UI | 814 passed |
| Next end-to-end | 76 passed, three Start-specific tests skipped |
| Start end-to-end | 79 passed |
| Smoke suite | 16 passed |

The initial Next checkout bundle at this revision measured 566,968 gzip bytes, exceeding its 546,446-byte limit by 20,522. Retaining that failure distinguishes the workflow results above from the bundle gate. The Start browser run verified the actual mounted guest pages, property editor and checkout and measured 485,814 checkout gzip bytes. [Start bundle results](start-route-js-browser.md)

## Release dependency graph

The signed-in workflows passed on `d7c965652fe2b981147660847732ca5f3173382a` after the Sentry alignment and the Clerk and Floating UI install fixes. The protected deployment used a newly seeded, commit-specific Convex Preview and the dedicated Clerk test tenant. It passed read-only checkout, owner/cashier/non-staff access, sign-out, booking through payment handoff, restored chat, live tour edits and fixture cleanup. The provisioner reported successful teardown. The separate anonymous HTTP run checked all 61 routes on `1c1938b2`; the application source and dependency lock match. [Workflow and teardown results](start-release-authenticated-qa.json) · [Route results](start-routes.md) · [Bundle measurements](next-checkout-budget.md)

The local release check used a clean frozen install of `d7c96565` with Bun 1.4.5, Node 22.22.3 and at most two Vitest workers. The integration command passed all 4,150 unit, DOM and Convex tests in 365 files, both production builds, all 814 booking component tests, and the Next end-to-end suite (76 passed, three Start-specific cases skipped). The separate Start suite passed all 79 cases, the smoke suite passed all 16, and the development lifecycle check verified shutdown, restart and fixture cleanup. The architecture scorecard passed all 32 checks with the heavy slot acquired before starting its timed subprocess. The earlier scorecard attempt exhausted its queue timeout before its required suites ran.
