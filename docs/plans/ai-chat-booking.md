# Plan: AI booking in WhatsApp / Messenger + admin bookings page

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
   - Add `source: 'web' | 'whatsapp' | 'messenger' | 'line' | 'instagram'` (optional, default `web`).
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
   - Reply with the confirmation code + `/booking/pay?id=…&token=…` link (existing demo payment flow).
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

1. Convex `bookings.listForAdmin`: guarded by `convex/lib/adminAuth.ts`, paginated, filters for `status` and `source`.
2. Route `src/app/admin/bookings/page.tsx`: same Clerk gate as `src/app/admin/page.tsx`.
3. Table columns:
   - guest name + phone
   - villa
   - check-in / check-out
   - guests
   - total
   - status
   - payment
   - source (channel icon)
   - created at
   
   Each row links to its chat session in `/admin`.
4. Row actions: confirm, cancel, mark paid. Use admin-guarded mutations that reuse `updatePaymentStatus` logic, and release availability on cancel.
5. Add a "Chats / Bookings" nav switch in the admin header.
6. Tests: unit test for the admin guard + filters. Playwright smoke test that the page renders.

## Order / PRs
1. PR 1: Schema, shared booking writes, and the AI prepare/confirm tools + tests. Use the web chat and LINE for local testing.
2. PR 2: Admin bookings page.
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

## Open questions
- Is the demo payment link after booking enough, or is real payment needed?
- Should AI-created bookings start as `pending` (admin confirms) or `confirmed`?
