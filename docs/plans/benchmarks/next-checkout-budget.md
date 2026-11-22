# Next checkout initial-JS budget under Bun

The frozen full acceptance on `68148b8d` failed the Next checkout gzip budget: 566,968 bytes against 546,446 (base 536,206 + 10,240). Every run below used the CI integration harness (`scripts/local-integration.mjs`: fresh anonymous Convex, test Clerk tenant, production build) and `scripts/bench/route-js-size.mjs --check-budgets`. Start used `scripts/bench/start-route-js-size.mjs --browser-origin … --auth`. Artifacts are in `next-checkout-budget/`; Next `projectDir` paths are replaced by a run label, and Start artifacts replace the seeded property ID with `$id`.

## Next, gzip bytes of initial JavaScript

| Run | Home | Room | Checkout | Property editor | Checkout budget |
|---|---:|---:|---:|---:|---|
| `6e6a562c` main (pnpm) | 301,099 | 299,396 | 540,882 | 453,705 | pass |
| `ce642ea2` Bun, before | 315,047 | 313,411 | 566,965 | 476,048 | fail |
| ↳ platform `sideEffects` marker (reverted) | 314,874 | 313,247 | 566,822 | 475,899 | fail |
| ↳ auth/intl barrel split (reverted) | 317,371 | 315,735 | 569,294 | 478,377 | fail |
| `b6509f29` @clerk/shared pin | 300,650 | 299,015 | 552,568 | 461,651 | fail |
| ↳ + `linker = "isolated"` prototype | 301,356 | 299,725 | 541,140 | 453,962 | pass, but Start never became ready |
| **`1c1938b2` Clerk + Floating UI pins** | **301,621** | **299,986** | **545,536** | **454,619** | **pass, 910 bytes headroom** |

The control reproduced the frozen failure to within 3 bytes, so the QA environment was not the cause. Checkout's source graph and package versions matched main.

The excess came from Bun's hoisted layout installing byte-identical nested copies that pnpm stored once:

- **Clerk:** `@clerk/shared` 4.12.2 was nested under both `@clerk/nextjs` and `@clerk/react` (about 14.4 KB on every route).
- **Floating UI:** `@floating-ui/react-dom` and its dom tree were nested under both Radix Popper versions (admin and checkout only).

Neither barrel experiment helped, so neither was kept. On `1c1938b2` checkout remains 4,654 bytes above main, probably from other nested Radix copies (e.g. `@radix-ui/react-slot`). With only 910 bytes of headroom, any further checkout growth will fail this budget.

## Start on `1c1938b2` (clean frozen install)

All four route ceilings pass with no errors. The values are local same-build totals for the manifest closure.

| Route | Chunks | Gzip | Brotli | Brotli ceiling |
|---|---:|---:|---:|---:|
| Home | 21 | 242,730 | 206,576 | 291,840 |
| Room | 20 | 239,263 | 203,337 | 291,840 |
| Property editor | 77 | 384,769 | 332,747 | 440,320 |
| Checkout | 95 | 477,913 | 413,629 | 546,816 (gzip ≤ 546,446) |

The authenticated browser cross-check was clean on all five loads. Every chunk came over the wire, with no unexpected, duplicate or failed same-origin chunks, and decoded bytes matched the build. Only the direct tour fetched renderer chunks.

| Load | Readiness | Time |
|---|---|---:|
| Home | `section#villas` | 555 ms |
| Ordinary room | `room_hydrated` | 498 ms |
| Direct room (`?tour=1`) | `room_hydrated` and tour viewer | 800 ms |
| Property editor | "360 rooms" tab | 1,371 ms |
| Checkout | "Frequent" tab | 1,398 ms |

`start-b6509f29-clerk-pin.json` records the same passing check on the single-pin lock.

## Inherited installs

A frozen Bun install never prunes nested copies left by an earlier install. Two cases were reproduced:

- An install before the Clerk pin kept two `@clerk/shared` copies.
- A Clerk-pin-only install (`b6509f29`) kept both Floating UI trees after a frozen install of `1c1938b2`.

`scripts/shared-runtimes.mjs` detects both cases. Worktree setup repairs either one with a single clean frozen install of that checkout, which took 6.1 s here. See AGENTS.md for the one-time reinstall of a previously installed main checkout.
