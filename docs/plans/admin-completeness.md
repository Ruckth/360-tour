# Plan: Admin completeness → fewer steps → UI polish

Based on six research passes (2026-09-28): properties/content, hotel bookings, staff/roster (including Deputy, When I Work, Homebase, 7shifts and Fresha patterns), chat/knowledge/leads, settings/auth/channels, and admin UI quality.

> **Status (2026-09-28):** all three phases are implemented on branch `codex/admin-completeness`. They were reviewed by four parallel reviewers (Codex gpt-6-sol for the backend, Opus for the frontend); all 45 findings are fixed. Typecheck, lint, 497 unit tests and `next build` pass. Not yet verified in a browser or e2e: that needs the new Convex functions deployed.
>
> **Deploy steps:**
> 1. Set `CONVEX_SERVER_SECRET` to the same random value in Convex and Vercel (Convex first).
> 2. Deploy Convex with the frontend (`vercel-build` does this).
> 3. Run `npx convex run migrations:recomputeAllSocialProof` so villa ratings come from real reviews.

| Phase | Goal | Done when |
|---|---|---|
| **1. Make it work** | Every record an admin cares about can be created, viewed, edited, archived/restored and (where safe) deleted from `/admin`. Known bugs fixed. | Nobody needs seed files, code edits or the Convex dashboard to run the resort |
| **2. Fewer steps** | Common jobs use bulk select, copy/repeat and smart defaults | Each flow hits its click target (listed below) |
| **3. UI polish** | Contrast, layout, sizing, colour and spacing hierarchy are consistent | Every admin screen passes WCAG AA and the Phase 3 checklist |

Rules for all phases:
- **Archive, don't delete** anything that other records point to (properties, staff, services, answers, paid bookings). Archived rows get **Restore**.
- **Hard delete** only rows with no references: unpaid test bookings, leads, time off, archived answers and suggestions (with cascade).
- Every admin mutation calls `requireAdmin` and has a test in the matching `convex/*.test.ts`.
- Each numbered step is its own PR. Backend-heavy PRs go to Codex (gpt-6-sol) and are reviewed by Opus. UI and flows are done by Opus.

---

## Phase 1: Make it work

### 1.0 Fix what's broken (do first)
Security and correctness bugs found during research:

| # | Bug | Where | Fix |
|---|---|---|---|
| 1 | **Channel webhook mutations are public.** Anyone with the Convex URL can inject chat messages | `convex/line.ts`, `facebook.ts`, `instagram.ts`, `whatsapp.ts` (`claimEvent`, `recordInboundEvent`, …) | Require a shared server secret arg (or move to internal + HTTP action) |
| 2 | `seed.seedAll` is public and reseeds whenever `properties` is empty | `convex/seed.ts:54` | `requireAdmin`, or make it internal |
| 3 | Cancelling a chat booking never releases its dates, so they stay blocked forever | `bookings.ts:470`, `payments.ts:68` | Release availability in `cancelChatBooking` |
| 4 | Admin cancel of a paid booking stays `paid`, with no refund record and no guest email | `adminBookings.ts:102` | Cancel-paid flow → `refund pending/recorded` + email |
| 5 | `updatePaymentStatus` allows paid → pending and doesn't release dates | `bookings.ts:128` | Delete it, or restrict it to internal |
| 6 | iCal export takes 500 bookings with no date lower bound, so future bookings can drop out | `ical.ts:66` | Filter from today |
| 7 | Archived properties can still be booked by slug | `bookingWrites.ts:24-38` | Reject non-active properties |
| 8 | Staff dialog half-saves: time off is written before hours, so a retry duplicates it | `AdminStaffServicesManager.tsx:258` | Single mutation, or hours first |
| 9 | Thai-only service names produce an empty slug and can't be saved | `AdminStaffServicesManager.tsx:27` | Fallback slug (transliterate or random suffix) |
| 10 | Re-running the curated seed wipes admin edits | `seed.ts:148-165` | Insert-only, or skip admin-modified rows |
| 11 | `syncApprovedQuestions` hard-deletes questions still referenced by unknown questions; `resolveUnknownWithAnswer` inserts duplicates | `chatKnowledge.ts:452, 995` | Reference check + dedupe |
| 12 | Questions actions swallow errors (try/finally, no catch) | `AdminChatDashboard.tsx:2048-2091, 904` | Show errors |
| 13 | Check-in time disagrees: admin shows 14:00, AI eval answer says 3 PM | `AdminBookingsView.tsx:59`, `seeds/aiEvalData.ts:41` | One value, later moved to Settings (1.6) |

### 1.1 Admin shell and routes (enabler)
`AdminChatDashboard.tsx` (2,600 lines) currently holds the shell, sidebar switching, chats and questions, and the view lives only in `useState`.
- Split into `AdminShell` + `ChatsView`, `QuestionsView`, `AnswerFormDialog`, etc.
- Real routes: `/admin/chats`, `/admin/hotel`, `/admin/staff`, `/admin/questions`, `/admin/properties`, `/admin/settings`, `/admin/leads`. This makes views deep-linkable and keeps them across a reload.
- A shared `ConfirmDialog` replaces the 6 `window.confirm` calls, and a shared error/empty/loading pattern gives each view its own error boundary (today a Hotel error removes the whole admin).

### 1.2 Quick wins (backend mostly exists)
- **Suggestions view** (the chips shown in chat): list, create, edit, translate, archive, restore, delete archived. Wires the six unused `chatSuggestions.admin*` functions. Deletes also remove `chatQuestionInteractions`.
- **Restore** archived staff and services (`updateStaff`/`updateService` already accept `status`).
- **Reopen** ignored or resolved unknown questions (new `adminReopenUnknown`), plus an "Ignored" filter.
- **Leads view:** table with source/property filter, CSV export, delete. Fix `leads.save` so repeat sign-ups keep their source.

### 1.3 Hotel bookings
| Feature | Notes |
|---|---|
| **Edit booking** (dates, villa, guests, guest details) | One mutation: release the old availability → re-validate → block new dates if confirmed → recompute price via `lib/pricing.ts` → clear any stale Stripe checkout (refuse while a checkout is live; version the idempotency key) → send a "booking updated" email. Remove the duplicated availability helper in `adminBookings.ts:80` |
| **Delete test booking** | Only pending/cancelled with no payment intent; clears chat `pendingBookingQuote` |
| **Manual date blocks** (owner stay, maintenance) | Add / edit / remove with a reason. Replaces `seedBlockedRange`, which writes the wrong status |
| **Refunds** | Record a manual refund; cancelling a paid booking goes through it |
| **iCal** | Edit source, "Sync now" button |
| **Guest search** | By name, phone or code (search index) |
| **Booking notes + change history** | New fields |
| **Copy pay link**, **create as confirmed/paid** | Expose `accessToken` to admin; optional arg on create |

Editability: pending → edit/delete · confirmed unpaid → edit/cancel · paid → edit with price warning, cancel = refund · cancelled/refunded → read-only.

### 1.4 Staff and services
- Edit time off, and a per-staff time-off list (not only click-on-calendar). Partial days are supported in the UI.
- Edit an appointment's guest details and **notes** (new field), change service, record a refund.
- Guards: archiving a service with upcoming appointments → warn and list them. Archived staff are removed from `services.staffIds` and rejected by `validateStaffIds`. Past appointments of archived staff stay visible.
- Per-weekday hours in the staff dialog (today the form locks if days differ). This is superseded by the roster in 2.1, so keep it minimal.

### 1.5 Chat and knowledge
- **Delete answer** (archived only) with cascade: questions, scopes, topic links; referencing unknown questions are reopened.
- **Question variants:** delete, un-reject, set primary.
- **Chat session status:** open / resolved / archived, plus archive filter. Delete cascades messages, reply attempts, events, interactions, handoffs.
- **Pause AI / take over:** `aiPaused` + `assignedAdminEmail` on the session, respected by all 4 webhooks and the web chat. Today the bot keeps replying after staff step in.
- **"Needs reply" filter**, and default the inbox to it instead of "live in the last 90 s".
- **Links between chat and knowledge:** "Open chat" from an unknown question, "Save as answer" from a guest message.
- **Search + pagination** in Questions (lists are capped at 100 today).
- **Topics:** picker with autocomplete instead of a comma text box; clean up orphans.
- **24-hour channel window:** warn before sending on WhatsApp, Facebook or Instagram rather than failing after.

### 1.6 Settings
New `siteSettings` single row. The code falls back to `resort-config.ts` when it's empty.
- **Business:** name, tagline, contact email/phone/WhatsApp/LINE, address, currency, timezone, check-in/out times, cancellation policy.
- **AI:** tone, extra instructions, max words. The prompt reads discount and policy from data instead of hardcoded "15%" / "48 h" (`chatAi.ts:458-485`).
- **Email:** sender display name, owner notification email, footer.
- **Channels (read-only):** for each of LINE, Facebook, Instagram, WhatsApp — configured? (a server-side env presence check, a Next route for Vercel vars), last event, last reply, failures in 24 h / 7 d + latest error. Also Stripe/Resend configured, and iCal last sync.
- **Admins (read-only):** from `ADMIN_EMAILS`.
- **Stays in env:** all secrets, `EMAIL_FROM` address, `SITE_URL`, Clerk, `ADMIN_EMAILS`.

### 1.7 Properties (largest item)
> **Update (2026-09-28):** PRs #17–#18 already added a Properties view with these edits: villa details, status and image URLs; room name and image; OTA rates (the `pricing` table is now legacy). The Leads view (list plus source filter) also exists. What's still missing: creating a villa, photo upload, creating, deleting and reordering rooms, hotspots, reviews, and public pages that read villa details from the DB.

**Key finding:** the public site renders from static files (`src/lib/data/*`, `messages/*.json`), not Convex. Only chat and the booking funnel read DB properties. Admin edits would change nothing visible unless the public pages are rewired.
- **Backend `adminProperties.ts`:** property list/create/update/setStatus/deleteDraft. Slug stays unique and is locked once the property has bookings.
- Rooms: upsert/delete (cascades hotspots + `tourRoomIds`)/reorder.
- Pricing: upsert. Reviews: CRUD. Social proof: computed from reviews.
- Uploads: `generateUploadUrl` → Convex storage URL. Add `*.convex.cloud` to `next.config.ts`. Enforce the panorama format (2:1 WebP, ≤ 4 MB).
- **Public rewiring:** home, room page, sitemap, tour, pricing and reviews read from Convex (server fetch/ISR). The static files become the empty-DB fallback, and DB fields win over i18n text.
- **Chat:** remove hardcoded villas and prices from `chatFallback.ts:180-260` and `booking-intent.ts:291`; read the DB.
- **Screens:** `/admin/properties` (list + status filter) and `/admin/properties/[id]` with tabs: Details · Photos · 360 Rooms · Pricing/OTA · Reviews · iCal.

### 1.8 Hotspot editor
Click on the panorama → raycast onto the sphere (radius 500, rotated π on Y — `RoomSphere.tsx:14`) → store `[x,y,z]`. Pick the target room from a dropdown, set a label, drag to move, delete. Until this ships, hotspots are edited as a list in 1.7.

---

## Phase 2: Fewer steps

For each flow: record today's clicks, set a target, and verify after.

### 2.1 Staff roster (the main one)
**Model: weekly pattern + per-date overrides** (Fresha-style, recommended over a pure date roster because it can never run out).
```ts
staffDays: { staffId, date: 'YYYY-MM-DD', shifts: [{start, end}], breaks: [{start, end, label}], note? }
  .index('by_staff_date', ['staffId', 'date'])
```
- A row replaces the weekly pattern for that date. **A row with no shifts = the person is off.**
- Engine change is small: `staffBusyRanges` in `convex/lib/serviceSlots.ts:105,113` uses the override if present, otherwise the pattern. `findOpenSlots`, AI booking and `createAppointmentRecord` are unchanged. `listSchedule` returns shifts so the calendar shades off-hours.
- No migration: the current `workingHours` becomes the pattern.

**Roster grid** (staff rows × 7 day columns, prefilled from the pattern):
1. Select cells by drag or shift-click, or select a whole row, a whole column, or everything.
2. Apply a **preset** (e.g. Morning 09–17 + 1 h lunch, Evening 14–22, or custom). Presets store start, end and break.
3. **Clear** = off for those cells. Cells that differ from the pattern are visibly marked.
4. **Copy this week → next N weeks** (4 / 10 / 20 / custom). Conflict choice: **Skip** (default) / Overwrite. A preview says e.g. "creates 140, skips 6".
5. **Make this week the default:** rewrites the weekly pattern.
6. Removing or shortening a shift that has bookings → blocked with a list of those appointments, with a choice to reassign or cancel. (The tools researched don't do this well; Vagaro silently orphans bookings.)
7. Scheduling over time off → warn, but allow.
8. **Undo** for the last bulk action.
9. One Save for the whole grid (client-side draft). No server "publish" step, because the AI books live.

Targets: a full 8-person week in **≤ 10 clicks**; repeating it for 10 weeks in **+2 clicks**.
Also: when nobody is rostered, the AI says "not scheduled yet" instead of "fully booked".

### 2.2 Other bulk flows
| Flow | Today | Change |
|---|---|---|
| Time off | ~6 clicks per person, whole days | Select several staff + range, or paint "Leave" onto the roster grid; `addTimeOff` takes `staffIds[]` |
| Service ↔ staff | Edit each service | Services × staff checkbox matrix, one batch mutation |
| Staff booking | Service → staff → time | Service → time → auto-assign (already least-loaded) with a preview of who; remember the last service |
| Hotel booking | Form, then Confirm (2 steps) | Drag on the calendar row = prefilled villa + dates; drag a chip = move (confirm dialog); hover quick actions (Confirm / Paid / Cancel / Copy link); autofill returning guests by phone |
| Unknown questions | One at a time | Group identical questions with a count; multi-select Ignore / Link / Reopen; pre-fill the best matching answer |
| Suggested variants | Hunt per answer | Global "pending variants" queue; Approve all / Reject all |
| Suggestions | Translate one at a time | "Translate all missing languages" |
| Chat inbox | Mouse only | Shortcuts: j/k move, r reply, e settle, / search. Filters kept in the URL |
| Destructive actions | Confirm dialogs everywhere | Undo toast (5 s) for reversible actions; a dialog only for hard deletes |
| New property | Empty form | Duplicate property (rooms, pricing, benefits → draft) |
| First setup | Read DEPLOYMENT.md | Setup checklist on the dashboard (AI key, email, Stripe, channels, iCal) with copy-paste webhook URLs and "send test" buttons |

---

## Phase 3: UI polish

Top fixes, in order (details in the UI research):
1. **Contrast failures:**
   - Gold text on the light background is **2.2:1** → add a darker gold text token.
   - `text-red-200/300` and `amber-400` are used on light backgrounds (1.4–1.9:1) (`AdminChatDashboard.tsx:1127,1187,1498,1507,1627`).
   - White on emerald-600/amber-600 badges is 3.2–3.7:1.
   - Status colour used as text on appointment chips is 2.1–2.8:1.
   - Placeholders are ~3:1.
   - Dark-mode destructive text is 3.6:1.
   - Dark-mode muted-on-muted is 4.3:1.
2. **Focus ring:** gold at 40–50 % opacity is 1.3:1 in light mode → solid ring ≥ 3:1 in `button`, `input`, `select`, `toggle-group`.
3. **One status colour system:**
   - Today "cancelled" is grey for hotel but rose for staff, and rose means "blocked" in one view and "cancelled" in the other.
   - Build one module with a tone API (bg/text pairs) for hotel, staff, chat, answers and channels.
   - Status is never shown by colour alone.
4. **One label source:** channel/source labels are defined four times ("messenger" vs "facebook").
5. **Type scale:**
   - Remove `text-[9/10/11/13px]`; use one eyebrow style (three tracking values today).
   - Style `DialogTitle`/`DialogDescription` (currently unstyled).
   - One page heading per view (Questions has three stacked titles).
6. **Spacing and surfaces:** one panel radius/padding (p-3…p-7 today); `SheetContent` padding; a single button system in toolbars (reui vs ui buttons).
7. **Sub-navigation:** one tab pattern (custom underline vs toggle group today); fix the dark-mode selected toggle (1.19:1).
8. **States:** skeleton loading; per-view errors; correct empty-state text; disabled buttons explain why.
9. **Responsive:** `dvh` instead of `100vh-190px` magic numbers; Questions tables (1,100 px min width) become cards or responsive tables on tablet; the calendar legend stays visible.
10. **Accessibility and clarity:**
    - `role="status"` on spinners; `aria-pressed` on filter toggles; a real `role=tab`.
    - Show payment and money as formatted text (not raw `unpaid` / `THB 12000`).
    - Admin transcript: guest on the left, and AI replies visually distinct from admin replies.

Verification: a Codex computer-use pass screenshots every admin screen in light and dark, before and after, and runs a contrast check.

---

## Decisions needed (recommended default in **bold**)
| # | Decision | Options |
|---|---|---|
| 1 | Staff roster model | **Weekly pattern + per-date overrides** / pure date roster (runs out) |
| 2 | Property content source of truth | **DB, with static files as fallback** / keep code-driven (then 1.7 shrinks to chat data only) |
| 3 | Property translations | **English in DB + auto-translate on save** / per-locale fields edited by hand |
| 4 | Reviews, "recent bookings", superhost flag (currently fabricated) | **Real reviews only, drop fake recent-bookings** / keep all editable |
| 5 | Slug after a property has bookings | **Locked** / rename with cascade |
| 6 | Admin-created pending booking | **Holds dates and is exempt from the 24 h auto-expiry** / current behaviour |
| 7 | Editing a paid booking's price | **Keep what was paid; show the balance due** / recompute and ignore |
| 8 | Refunds | **Record manually (Stripe refund done in the Stripe dashboard)** / call Stripe's refund API |
| 9 | Admin roles | **Keep a single admin list for now** / owner, manager and staff roles |
| 10 | Two answer systems (knowledge answers vs curated suggestions) | **Keep both, explain them in the UI** / merge later |
