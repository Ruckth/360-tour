# Plan: AI booking in WhatsApp / Messenger + admin bookings page

Implementation update (24 September 2026): the token-gated `confirmDemoPayment` mutation described below was removed for live bookings. Live payment now uses Stripe Checkout and a signed Convex webhook. `bookingId=demo` remains a standalone UI demonstration and creates no paid booking. The remaining "current state" notes below are historical.

## Goal
Guests on WhatsApp and Messenger can check availability **and book** through the AI.
Admins can see and manage every booking in `/admin/bookings`.

## Current state
- Guest booking funnel exists: `/booking` → `/booking/pay` (demo payment) → `/booking/success`, backed by `convex/bookings.ts:create`.
- WhatsApp webhook code exists (`src/app/api/whatsapp/webhook/route.ts`, `convex/whatsapp.ts`) but Meta app / env vars are **not configured yet** — deferred, see "Later".
- AI tools (`convex/lib/chatTools.ts`) are read-only: `check_availability`, `calculate_price`, `get_property_details`, `list_properties`.
- The AI prompt (`convex/chatAi.ts` ~L214–239) sends messaging guests to `/booking`.
- There is no admin view for bookings.

## Part 1: AI can create bookings

1. **Schema** (`convex/schema.ts` → `bookings`)
   - Add `source: 'web' | 'whatsapp' | 'messenger' | 'line' | 'instagram' | 'admin'` (optional, default `web`).
   - Add `chatSessionId: v.optional(v.id('chatSessions'))`.
   - Make `guestEmail` optional (WhatsApp guests often have no email). Add a `by_chatSession` index.
2. **Shared write logic**
   - Extract the body of `bookings.create` into `convex/lib/bookingWrites.ts` (`createBookingRecord(ctx, input)`).
   - The web mutation and the AI tool both call it, so overlap, blocked-date, capacity and pricing checks stay identical.
3. **Confirmation step (enforced in code)**
   - New tool `prepare_booking({ propertySlug, checkIn, checkOut, guests, guestName })`: validates, quotes, and stores a `pendingBookingQuote` on the chat session. The AI reads the summary back (villa, dates, guests, total) and asks the guest to reply "yes".
   - New tool `confirm_booking()`: takes no booking details. It only turns the stored quote into a booking, and only if the quote is still fresh (e.g. under 15 min).
   - The guest phone comes from the server (WhatsApp `wa_id` on the session), never from model arguments.
4. **Channel rules**
   - WhatsApp: phone number is verified by WhatsApp → the AI can book directly.
   - Messenger / Instagram: ask for the guest's name + phone before `prepare_booking`, or fall back to a pre-filled `/booking?checkin=…&checkout=…&unit=…&guests=…` link.
   - Web chat: unchanged (existing booking card).
5. **After booking**
   - AI bookings are created as `pending` / payment `pending`.
   - Reply with the confirmation code + `/booking/pay?id=…&token=…` link (demo payment page).
   - **Clicking "Confirm payment" means the booking is paid.** Today `PayClient.confirmPayment` only works for `id=demo` and throws `secureCheckoutOnly` for real bookings, so the AI's pay link would fail. Fix: add a public mutation `bookings.confirmDemoPayment({ bookingId, accessToken })`. It checks the access token, then reuses the `markPaidFromTrustedWebhook` logic: `paymentStatus: 'paid'`, `status: 'confirmed'`, `paidAt`, `paymentMethod: 'demo'`, plus the confirmation/invoice/receipt codes. After that, go to `/booking/success`.
   - The admin calendar and chat reflect the paid status live (Convex reactivity).
   - Optional: `get_my_bookings` / `cancel_booking` tools, looked up by session phone.
6. **Prompt**
   - Update the per-channel prompt in `chatAi.ts`: describe the prepare → confirm flow instead of "go to the booking page".
7. **Tests**
   - `chatAi.test.ts` / `whatsapp.test.ts` / `facebook.test.ts`:
     - `confirm_booking` without a prepared quote fails.
     - A stale quote fails.
     - Dates that are already taken are rejected.
     - A duplicate webhook delivery doesn't create a second booking.
     - The phone number is taken from the session, not from model arguments.

## Part 2: Admin bookings page

UI base: ReUI event calendar, "Event calendar with resource view for room bookings" (`pnpm dlx shadcn@latest add @reui/c-event-calendar-2`).
The command installs `@reui/event-calendar`, `-content`, `-nav` and `-types` into `src/components/reui/event-calendar/`, and the example into `src/components/examples/`.

1. **Install + adapt the example**
   - Move the example to `src/components/admin/BookingCalendar.tsx`.
   - The example imports `IconPlaceholder` from ReUI's own app. Replace it with lucide `PlusIcon`.
   - Check it works with Tailwind v4 + our `src/app.css` tokens.
2. **Data**
   - Convex `bookings.listForAdmin({ from, to, status?, source? })`: guarded by `convex/lib/adminAuth.ts`, returns bookings overlapping the visible date range. Add a `by_checkIn` index if needed.
   - Also return blocked dates (`availability` with status `blocked`) so the calendar shows iCal/OTA blocks.
3. **Mapping to the calendar**
   - Resources = villas (`properties`, one column each, one colour each).
   - Event = booking:
     - `start` = check-in at 14:00, `end` = check-out at 11:00
     - `resourceId` = villa
     - title = `Guest name · source`
     - colour = status (pending, confirmed, paid, cancelled, blocked)
   - Keep the example's single status map, which drives both the chip colours and the legend.
4. **Views**
   - The example's resource view is a single day on an hour grid (08:00–20:00). That suits a "today's check-ins/check-outs" board, but villa stays last several days.
   - Default to the **month** view: stays as multi-day bars, with a villa filter.
   - Show the **resource** view for today's turnovers, and the **agenda** view as a simple list.
   - Enable the view switcher (the example hides it).
5. **Interactions**
   - Clicking a booking opens a side sheet (existing `ui/sheet.tsx`) with:
     - guest name, phone, email
     - dates, guests, total
     - status + payment
     - source + a link to its chat session in `/admin`
   - Actions in the sheet: confirm, cancel, mark paid. Use admin-guarded mutations that reuse `updatePaymentStatus` logic, and release availability on cancel.
   - "New booking" button → dialog for manual/phone bookings, calling the shared `createBookingRecord` with `source: 'admin'`.
   - Turn off drag/resize for v1 (`interactions={{ drag: false, resize: false, selectSlot: false }}`). Moving a stay needs availability re-checks; add that later.
6. **Route + nav**
   - `src/app/admin/bookings/page.tsx`: same Clerk gate as `src/app/admin/page.tsx`.
   - Add a "Chats / Bookings" switch in the admin header.
7. **Tests**
   - Unit tests: admin guard, date-range overlap query, booking → calendar event mapping.
   - Playwright: the calendar renders with a seeded booking, and clicking it opens the sheet.

## Order / PRs
1. PR 1: Schema, shared booking writes, and the AI prepare/confirm tools + tests. Use the web chat and LINE for local testing.
2. PR 2: Admin bookings calendar (ReUI event calendar).
3. Later: WhatsApp configuration (below), then the live demo.

## Later: WhatsApp configuration (not in this plan's code work)
- In the Meta app: add the WhatsApp product and use the test number (or register the business number).
- Set these Vercel env vars:
  - `WHATSAPP_VERIFY_TOKEN`
  - `WHATSAPP_APP_SECRET` (or `META_APP_SECRET`)
  - `WHATSAPP_ACCESS_TOKEN` (permanent System User token)
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `SITE_URL`
- Set the webhook to `https://<domain>/api/whatsapp/webhook` and subscribe to `messages`. Add the demo phone numbers as test recipients.

## Decisions
- Payment: the demo payment link is enough. No real payment provider.
- "Confirm payment" on the demo pay page = paid. The booking becomes `confirmed` + `paid` without admin approval.
