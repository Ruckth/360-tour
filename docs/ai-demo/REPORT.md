# AI chat and booking test on production (24 September 2026)

- **Site:** https://tour.helpgueststay.com
- **Backend:** Convex prod `wary-toad-189`
- **Model:** `x-ai/grok-4.3`

## How it was tested

- **Website chat widget:** Videos 01–03 were recorded against the live site. This widget does **not** book through the AI. Bookings go through a booking card instead.
- **Messaging channels (LINE, WhatsApp, Messenger, Instagram):** Only these channels have the AI booking tools. Videos 04–08 send guest messages to `chatEval:messagingTurn` on the production backend. That function uses the same AI code and tools as the LINE webhook, but sends no real LINE messages. A local page shows the replies, with tool calls shown as chips. The reply times in these videos include about 2–3 seconds of command-line overhead.

## Scorecard

| Area | Result |
|---|---|
| AI room booking (04, 06, 07) | **Pass.** Checks availability, collects name and phone, and confirms only after "yes". Sends a payment link, lists the guest's bookings, and cancels in two steps. Catches a missing phone number and too many guests. When the guest changes their mind, no booking is made. For taken dates it offers other options. **Issues:** it asks for contact details before checking dates, and it says "Booking confirmed!" for a booking that is still waiting for payment. Replies take 4.5–16 seconds. |
| AI service booking (05) | **Fail.** Service booking doesn't work in production (bug 1). The AI also read back a booking summary after the booking tool had returned an error. |
| Website chat (01–03, 17 turns) | 8 pass, 4 partial, 5 fail. It also gave a wrong availability answer. Saved knowledge answers take 0.8 seconds. AI answers take 3–14 seconds. |
| Thai and Korean | Fluent when the AI answers. Saved knowledge answers come back in English. |
| Made-up prices or capacity | None seen. |

## Bugs, most serious first

1. **P0: Service times are shifted to UTC.** `resortLocalParts()` in `convex/lib/serviceSlots.ts` returns UTC clock times in production instead of Bangkok time. Slots meant for 13:00–17:45 show as 06:00–10:45. Every `prepare_service_booking` call fails with "Choose a future local date and time". The admin staff schedule uses the same helpers and may be affected too.
2. **The website AI doesn't know today's date.** Only the messaging prompt includes it (see `convex/chatAi.ts`). When asked "Is Tideglass available October 10 to 13?", the AI answered yes, but those nights are blocked. With the year stated, it correctly said no.
3. **Too many website questions get the "not sure" reply.** Examples: asking the nightly price, a price question in Thai, "we travel with a small cat", "I want something nice", and a direct request to book.
4. **Korean false positive.** The check for "is this place real?" matches `있나요` ("is there…?"). So "마사지 예약할 수 있나요?" ("Can I book a massage?") gets the demo-resort disclaimer.
5. **Minor issues.** Saved knowledge answers aren't translated. On the website, a booking card covers the answer text above it.

## Videos

| File | Scenario |
|---|---|
| `01-web-chat-desktop.mp4` | Website chat on desktop: prices, availability, policies, off-topic, vague requests |
| `02-web-chat-thai-korean-mobile.mp4` | Website chat on mobile, in Thai and Korean |
| `03-web-booking-card.mp4` | Website booking card |
| `04-room-booking-line.mp4` | Full room booking and cancellation through the AI |
| `05-service-booking-line.mp4` | Spa/service booking (fails, bug 1) |
| `06-edge-cases-line.mp4` | Missing phone, too many guests, change of mind |
| `07-occupied-dates-line.mp4` | Dates already taken, AI suggests alternatives |
| `08-line-thai-korean.mp4` | LINE conversation in Thai and Korean |

Full transcripts, including every tool call, are in `transcripts/*.json`.

## Per-scenario details

### 01: Website chat on desktop

| # | Guest asked | Reply | Answered by | Result |
|---|---|---|---|---|
| 1 | Tideglass price per night? | "I'm not fully sure…" | Fixed reply | Fail |
| 2 | 3 nights in Canopy, booking direct? | "฿30,600 (15% off ฿36,000)" | AI + `calculate_price` | Pass |
| 3 | Tideglass, Oct 10–13? | "Yes … ฿21,675" | AI + `check_availability`, wrong year | Fail |
| 4 | Mossbell, Oct 20–23? | "Yes … ฿11,475" | AI + `check_availability` | Pass |
| 5 | Check-in time? | "From 3:00 PM … check-out 11:00 AM" | Saved answer | Pass |
| 6 | Can I bring a dog? | "Pets not allowed … except assistance animals" | Saved answer | Pass |
| 7 | We travel with a small cat | "Not sure" | Fixed reply | Fail |
| 8 | Cancellation policy? | "Free cancellation up to 48 h before check-in" | Curated question → AI | Pass |
| 9 | Do you have a spa? | Lists 3 wellness services with correct prices | AI + `list_services` | Pass |
| 10 | Python script request | "Not sure" | Fixed reply | Partial: safe answer, but promises a follow-up from staff |
| 11 | "I want something nice" | "Not sure" | Fixed reply | Fail: should have asked a clarifying question |

### 02: Website chat on mobile

| Guest asked | Reply | Result |
|---|---|---|
| Price question in Thai | "Not sure" reply, in Thai | Fail |
| Check-in time in Thai | Answer in English | Partial |
| 마사지 예약할 수 있나요? (Can I book a massage?) | Demo disclaimer | Fail |
| Villa for 3 people, in Korean | Recommends Tideglass or Canopy with correct capacity and prices | Pass |

### 03: Website booking card

| Guest asked | Reply | Result |
|---|---|---|
| Availability for exact dates | "Not available" | Pass |
| Direct booking request | "Not sure" text, but the card filled in Mossbell, 20–23 Oct correctly | Partial |

### 04: Room booking over LINE

**Pass.** Seven turns, with the correct tool used each time. Booking CONF-2026-8F1JPH was created with a payment link, then cancelled after the guest said "yes" to cancelling.

### 05: Service booking over LINE

**Fail.**
- The service list was correct.
- Available times were wrong: it said "10am taken … early slots from 6:00am" (bug 1).
- At 13:30, `prepare_service_booking` failed, but the AI still read back a booking summary.
- On "yes", `confirm_service_booking` failed with "No prepared service booking".

### 06: Edge cases over LINE

| Check | Result |
|---|---|
| Asks for contact details before checking dates | Partial |
| Missing phone number caught | Pass |
| 6 guests in Mossbell refused (maximum is 2) | Pass |
| Price updated when dates changed (฿30,600 → ฿20,400) | Pass |
| Guest says "never mind": nothing booked, `get_my_bookings` is empty | Pass |

### 07: Dates already taken, over LINE

**Pass.** It said the requested dates were blocked. It then suggested Canopy Halo Loft, which is free on those dates, and explained that Mossbell is too small for 4 guests.

### 08: Thai and Korean over LINE

| Guest asked | Result |
|---|---|
| Price in Thai | Pass |
| Spa list in Thai | Pass |
| "Can I book?" in Korean | Fail: demo disclaimer (bug 4) |
| Massage prices in Korean | Pass |

## Test data added to production

All rows are tagged so cleanup can find them.

| Table | Rows | Details |
|---|---|---|
| `staff` | 5 | Names end in `[AI-EVAL]` |
| `services` | 5 | Slugs start with `ai-eval-`: Thai massage, aromatherapy, yoga, chef BBQ, island tour |
| `staffTimeOff` | 1 | Seeded by `ai-eval-seed@test.local` |
| `serviceAppointments` | 2 | Bookings that make some slots unavailable, on 2026-09-25 |
| `chatAnswers` | 5 | Check-in, pets, cancellation, breakfast, Wi-Fi/parking/smoking |
| `chatQuestions` | 22 | Wording variations for those answers |
| `curatedChatQuestions` | 4 | With Thai and Korean translations |
| `availability` | 13 | Blocked nights: Tideglass 10–15 Oct, Mossbell 2–4 Oct, Canopy 23–25 Oct |

### What real visitors can see while this data remains

- The blocked nights appear in the public calendar.
- The 5 test services are offered on messaging channels.
- The new curated questions can appear as suggestion chips.
- If an OTA calendar export is set up later, the blocked nights will be exported with it.

### Side effects checked

- No emails or messages were sent. Prod has no email-sender, LINE, Meta or Stripe secrets.
- Nothing was exported to OTAs: there are no export tokens or iCal sources.
- Test booking CONF-2026-8F1JPH was cancelled.

## Deployed functions

`convex/aiEval.ts` and `convex/seeds/aiEvalData.ts` were deployed to production but are **not committed**. The next production deploy from `main` will remove these functions, but the data will stay. Before that happens, either commit the two files or run cleanup.

## Cleanup

```sh
npx convex run --prod aiEval:cancelTestBookings
npx convex run --prod aiEval:cleanup '{"confirm":"AI-EVAL"}'
```

Cleanup does not remove the test chat sessions in the admin inbox (visitor IDs start with `eval:line:`).

## Re-run the recordings

```sh
node scripts/ai-demo/record-web-chat.ts chat desktop
node scripts/ai-demo/record-messaging.ts room-booking --prod
```
