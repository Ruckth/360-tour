# Next worktree / session — setup & merge checklist

Read this before you start a new worktree off `best-of` (or anything merging to `main`). It captures the known-good dev loop, the fixes this branch carries, and what needs attention before merging.

---

## 1. First-time setup in a fresh worktree

Run these in order. Assumes `pnpm` and `npx convex` are installed globally.

```bash
# 1. Install deps
pnpm install

# 2. Copy environment file from main repo (or re-create from .env.example)
cp /Users/ruck/Developer/360-tour/.env.local ./.env.local
# If you don't have it, at minimum set:
#   CONVEX_DEPLOYMENT=dev:optimistic-turtle-573
#   PUBLIC_CONVEX_URL=https://optimistic-turtle-573.eu-west-1.convex.cloud
#   PUBLIC_CONVEX_SITE_URL=https://optimistic-turtle-573.eu-west-1.convex.site
#   OPEN_ROUTER_API_KEY=...
#   RESEND_API_KEY=...
#   PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder   # placeholder OK for now — auth not wired
#   CLERK_JWT_ISSUER_DOMAIN=https://example.clerk.accounts.dev

# 3. Push Convex schema + regenerate api types
npx convex dev --once
# If this fails with "CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set":
npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://placeholder.clerk.accounts.dev"
npx convex dev --once

# 4. Seed the database (idempotent — skips if already seeded)
npx convex run seed:seedAll '{}'

# 5. Start the dev server
pnpm dev
# Opens http://localhost:3000/
```

**Smoke test after startup:**
- `/` — homepage renders with Seaview Residence hero (no dividing line between the two mobile hero images, nav has mobile menu support)
- `/booking?unit=pool-villa` — jumps straight to the Dates step (this was broken before; the date-picker crash is now fixed)
- `/rooms/pool-villa` — detail page with a dedicated **Explore in 360°** button directly below the image gallery
- Open the chat bubble on `/` — the three quick-reply chips return **instant canned answers** (no AI round-trip)

---

## 2. What this branch (`best-of`) changes vs `main`

### Bug fixes (keep, real bugs)
- **[convex/schema.ts](../convex/schema.ts:207)** — `chatSessions.propertyId` is now `v.optional(v.id('properties'))`. Was required, but the widget sends `undefined` on non-property pages → every chat session creation failed.
- **[src/lib/components/ui/date-picker/date-picker-field.svelte:35](../src/lib/components/ui/date-picker/date-picker-field.svelte)** — `{#each segments as seg, i (i)}` (was `(seg.part)`). `seg.part === 'literal'` repeats for the `/` separators, so the previous key caused `each_key_duplicate`, which crashed the whole page whenever a date picker mounted (this is what made `/booking?unit=X` look "broken").
- **[src/routes/booking/+page.svelte](../src/routes/booking/+page.svelte)** — rewritten state machine using `class:hidden={...}` instead of an `{#if}/{:else if}` chain. Ran into a Svelte 5 quirk where transitioning into a never-previously-rendered branch didn't mount it. All step blocks mount once and toggle visibility via CSS. URL params (`unit`, `checkin`, `checkout`, `guests`) read synchronously at module init so step 2 renders immediately for `?unit=<slug>` links.

### UX improvements (keep)
- **[src/routes/+layout.svelte](../src/routes/+layout.svelte)** — `const solid = $derived(scrolled || !isHome || mobileMenuOpen)` — nav now matches the mobile menu dropdown instead of floating transparent above it.
- **[src/routes/+page.svelte](../src/routes/+page.svelte)** — removed 1px divider between mobile hero halves; removed ken-burns zoom (was snapping back during transitions).
- **[src/routes/rooms/[id]/+page.svelte](../src/routes/rooms/[id]/+page.svelte)** — added a standalone "Explore in 360°" button directly below `ImageGallery` (was previously only reachable via swiping to the gallery's last slide).
- **[src/lib/components/chat/AIChatWidget.svelte](../src/lib/components/chat/AIChatWidget.svelte)** — quick-reply chips now carry an `answer` field and call a new `sendPreset()` helper that writes user + canned assistant messages straight through `api.chat.addMessage`, bypassing `api.chat.respond`. Instant, free, and reliable vs the AI path.

### Scaffolding (decide before merging to main)
These are untracked / WIP files — the Clerk + users.ts path is not wired into the UI and not usable without real Clerk credentials:
- `convex/auth.config.ts` — references `process.env.CLERK_JWT_ISSUER_DOMAIN`
- `convex/users.ts` — `store` mutation that depends on `ctx.auth.getUserIdentity()`
- `src/lib/components/auth/AuthNav.svelte`, `ConvexClerkAuth.svelte`
- `src/routes/sign-in/+page.svelte`, `src/routes/sign-up/+page.svelte`
- `package.json` — `svelte-clerk` dependency
- `src/routes/+layout.svelte` — imports `ClerkProvider` but never renders it

**Recommendation:** either **finish wiring Clerk** (wrap layout in `<ClerkProvider>`, set real keys, actually use `AuthNav`) or **delete the auth scaffolding** before merging. Leaving half-wired dead code in `main` will bite.

### Generated/infra (keep but verify)
- `convex/_generated/api.d.ts` — regenerated by `npx convex dev`; includes the `users` module now.
- `.claude/launch.json` — lets `preview_*` MCP tools start the vite server on port 3000. Safe to commit.

---

## 3. Known gotchas

- **`npx convex dev --once` will block `pnpm dev`** if `CLERK_JWT_ISSUER_DOMAIN` isn't set in the Convex cloud env. Either set it (step 3 above) or, if auth is ripped out, delete `convex/auth.config.ts` before running.
- **HMR duplicate-instance shimmer.** During this session we saw Svelte 5 dev mode running effects 3–6× per mount while fiddling with `+page.svelte`. Full page reload (`location.reload()` in the iframe) clears it. If you see logs firing N× more than expected, that's why — not a real bug.
- **Booking page `{#if}` chain.** Don't revert to the `{:else if currentStep === X}` style. We tried twice, and a first-paint branch that was never true would fail to mount later. The `class:hidden` pattern stays.

---

## 4. Merge checklist (`best-of` → `main`)

Before opening the PR:

- [ ] Decide auth: wire it up or remove it (see §2 "Scaffolding")
- [ ] Review `.env.local` — never commit it (`.env.*` is in `.gitignore`)
- [ ] Review `.claude/worktrees/` — currently untracked; don't commit worktree copies
- [ ] Confirm `convex/_generated/api.d.ts` regenerated cleanly (`npx convex dev --once` succeeds with no schema drift)
- [ ] Regenerate `pnpm-lock.yaml` on clean install if you removed `svelte-clerk`
- [ ] Run the smoke test from §1 — all four flows pass
- [ ] `pnpm build` succeeds (worth a dry-run before merge)

**Merge strategy:** squash-merge if the branch has exploratory commits; keep commits if they're already story-sized. Don't force-push main.

---

## 5. If you're starting from scratch

If for some reason you want to start fresh in a new worktree off `main` and re-apply just the safe bug fixes (not the auth scaffolding):

1. `git checkout main && git pull`
2. `git worktree add ../<dirname> -b <branchname>`
3. Cherry-pick or manually copy just:
   - `convex/schema.ts` chatSessions change
   - `src/lib/components/ui/date-picker/date-picker-field.svelte` key fix
   - `src/routes/booking/+page.svelte` class:hidden rewrite
   - `src/routes/+layout.svelte` solid derived + menu color fix
   - `src/routes/+page.svelte` divider + ken-burns removal
   - `src/routes/rooms/[id]/+page.svelte` 360 button
   - `src/lib/components/chat/AIChatWidget.svelte` presets
4. Run §1 setup
5. Smoke test, then PR.
