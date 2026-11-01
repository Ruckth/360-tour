# Orders, bookings and customers: rules and rollout

Companion to `pos-orders-plan.md`. Describes what was built and how to roll it out on existing data.

## Glossary

- **Order**: the persistent commercial record at checkout. It has a permanent order number (`Order #42`), rows, payments and, once paid, a receipt number (`R-000042`). Stored in the `bills` table (rows in `billLines`) so existing ids, payments and audit entries stay valid. Product and API language is "order" (`convex/pos.ts`: `getOrder`, `listOrders`, `openOrderFor`, `settleOrder`, …).
- **Booking**: a stay (`bookings`) or a service appointment (`serviceAppointments`). Its guest details belong to the booking.
- **Customer**: a reusable profile (`customers`, `convex/customers.ts`): name, optional phone, email and notes. The payer. Optional on an order.
- **Source**: a booking or appointment charged on an order row (`billLines.bookingId` / `appointmentId`).

## Relationship rules

1. Every order gets its number from the `order` counter when it is created. It never changes: saving, reopening, linking or unlinking a customer, other days and payment leave it as it is. Receipt numbers are a separate counter issued at payment.
2. An order may link to one stay (`bills.bookingId`) or one standalone appointment (`bills.appointmentId`), or to neither (a standalone sale).
3. Every booking and appointment created from now on (website, chat, admin) gets its order at creation, empty. An appointment that is part of a stay uses the stay's order. Empty orders are not listed under Orders.
4. Opening a booking at checkout (`openOrderFor`) reuses the open order that charges it or is linked to it, so repeated opens and two devices land on the same order. It charges what the stay still owes on that order unless another open order already charges it. If the booking's last order was paid, a new order follows it (`parentOrderId`) for the balance or extras; the paid order is not changed.
4a. **Own booking versus charged bookings.** An order's *own* booking is its order-level link (rule 2): opening that booking continues on it. A *charged* booking is any stay or appointment on one of its rows. Adding a stay to a standalone order makes the order that stay's own only if the stay has no other open order of its own. A stay created with its empty order keeps that order: it is not moved, emptied, deleted or re-pointed, and the standalone order keeps its number and customer. The standalone order still shows the stay, because it charges it.
4b. **What checkout, Orders and the receipt show** (`orderSourceRefs` in `convex/pos.ts`, mirrored by the fixture backend) is built only from those links and rows, never guessed:
   1. the order's own booking, if any;
   2. then every other charged stay, in row order;
   3. then every charged appointment whose stay is not already listed.

   The header shows the first, with "+N more bookings". The Orders row shows its reference with "+N". The receipt lists all of them ("Bookings: A, B"). An order with neither an own booking nor a charged source says "No booking". Paid rows never change, so a receipt keeps its references. A booking's detail sheet continues on the open order charging it. While the stay is charged elsewhere, its empty own order is left out of the sheet's order history. After that sale is paid, the stay's later extras go on its own order.
5. A source is charged on at most one open order. `attach`, `openOrderFor`, and admin "Mark paid" for stays and appointments all refuse while another open order charges it.
6. A row is a snapshot of its source. If the stay or appointment changes (villa, dates, price, deposit, therapist, time), is paid elsewhere, cancelled or has an online checkout in progress, the order shows the row as changed and payment is refused until the row is updated (`updateSourceLine`) or removed.
7. A customer is linked by id only. Nothing is created, matched or merged from a name; namesakes stay separate. Linking a customer never changes the booking's guest. Linking, unlinking or editing a linked customer's details bumps the order's revision, so a payment reviewed before that must be reviewed again.
8. Paying freezes what the receipt prints: `customerSnapshot` (name, phone, email) and each row's therapist name (`billLines.staffName`). Paid and void orders never change. Voiding keeps the order and receipt numbers, rows, payments and audit trail; bookings and appointments stay paid and a refund is recorded on them separately.
9. Save & close keeps the order unpaid and starts a new one. Everything is already on the server, so it changes nothing about the order (not its revision); it only moves it to the top of Unpaid orders. Orders lists Unpaid, Paid and Voided with order number, customer, booking reference, last change and what is still owed.
10. `/admin/checkout?order=<id>` is the order URL. Old `?bill=` links open the same order and are rewritten. Receipts stay at `/admin/receipt/<id>`.

The walk-in concept is gone: no walk-in numbers, counter, preview query or label. `walkInNumber` and the copied `guestName`/`guestPhone`/`guestEmail` on old rows are deprecated optional fields, read only to show a legacy order's old name ("named … before customers existed") and never written.

## Rollout on existing data (widen → migrate → verify → narrow)

Shared dev already has bills from the walk-in checkout. The schema change is widening only (new optional fields, a new table, indexes, extra audit kinds), so it deploys over existing rows.

Before deployment, retain a baseline of existing IDs and hashes for settled financial fields, every original receipt-line field, payments, audit rows, bookings and appointments. Lookup backfills may add only `guestPhoneDigits` / `guestEmailNormalized`; therapist backfill may add only `staffName` / `staffNameBackfilledAt`. Hash every pre-existing field and reject unrelated additions. Keep the original baseline when extending the verifier; compare the new baseline to it before migration.

1. **Deploy** the code and schema (coordinator). New orders are numbered immediately, and new or edited appointments store their lookup fields. Until the backfills below finish:
   - legacy `held` rows still show under Unpaid (listed first);
   - a legacy unpaid row without `due` lists what is still owed worked out from its rows (deposits deducted), not its total;
   - Add booking matches up to 500 older unpaid appointments by phone digits or email directly. If more are waiting, it says so (`pos.attachLookupStatus`) instead of reporting no match;
   - a legacy paid row without a frozen therapist name shows the therapist's current name.
2. **Appointment and stay lookup fields** (dry run, then run):
   `npx convex run migrations:run '{"fn": "migrations:backfillAppointmentGuestLookup", "dryRun": true}'`
   `npx convex run migrations:run '{"fn": "migrations:backfillAppointmentGuestLookup"}'`
   `npx convex run migrations:run '{"fn": "migrations:backfillBookingGuestLookup", "dryRun": true}'`
   `npx convex run migrations:run '{"fn": "migrations:backfillBookingGuestLookup"}'` (an earlier rollout's backfill; skipped if it already finished)
   `npx convex run --component migrations lib:getStatus '{"names": ["migrations:backfillAppointmentGuestLookup", "migrations:backfillBookingGuestLookup"]}'`
   Both must report `success`. Add booking then no longer shows the "Some older appointments can't be found by phone or email yet" notice.
3. **Preview orders** (read-only), page by page until `isDone`:
   `npx convex run migrations:previewOrderBackfill '{"paginationOpts": {"numItems": 50, "cursor": null}}'`
   Check the proposed patches, `lineStaffNames` (rows getting a therapist name) and any `notes` (rows left unlinked, therapist records that no longer exist).
4. **Dry run, then run** with the migrations component (batched, resumable, idempotent). A dry run rolls back every write in the batch, including row names and counter increments:
   `npx convex run migrations:run '{"fn": "migrations:backfillOrders", "dryRun": true}'`
   `npx convex run migrations:run '{"fn": "migrations:backfillOrders"}'`
   `npx convex run --component migrations lib:getStatus '{"names": ["migrations:backfillOrders"]}'`
   If `backfillOrders` already finished on this deployment with an earlier version of this code, it is skipped; rerun it from the start with `'{"fn": "migrations:backfillOrders", "reset": true}'`. That is safe: rows already numbered, linked or named are left as they are.
5. **Verify**, page by page until `isDone`; `problems` must be empty:
   `npx convex run migrations:verifyOrderBackfill '{"paginationOpts": {"numItems": 50, "cursor": null}}'`
   - `unlinkedWithSources` counts orders that charge bookings but have no order-level booking (ambiguous history); they stay reachable from each booking through their rows.
   - `therapistUnknown` counts paid rows whose therapist record is gone; they keep showing "Former staff member".
   - `staffNamesBackfilled` counts rows whose name was copied by the migration.
6. **Narrow** later, in a separate change once verified: make `orderNumber` and `due` required, drop `held` from the status union and the legacy-held listing note, drop the legacy appointment lookup scan and `attachLookupStatus`, and stop reading `walkInNumber` and the copied guest fields (keep them optional or clear them with another migration; prefer keeping history).

What the order backfill does per row:
- assigns an order number in creation order (rows created after the deploy already have one);
- turns `held` into `draft`;
- sets `due` (0 for paid/void);
- links the booking when every charged row points to one stay (or one standalone appointment);
- for paid/void rows, freezes the copied guest name as the receipt name;
- for paid/void rows, adds the therapist's name to each therapist row that has none (`staffName`, with `staffNameBackfilledAt`).

Rows charging several stays, or a stay plus a standalone appointment, or an appointment that no longer exists, are left unlinked and reported. It creates no customers and no bookings. It does not touch payments, receipt numbers or audit entries, and on rows it only adds those two fields. Rerunning changes nothing. Existing bookings get their order the first time they are opened at checkout.

**Limit of the therapist snapshot.** The name frozen by the migration is the staff member's name when the migration runs, the best record left. If a therapist was renamed between a legacy payment and the migration, the receipt shows the newer name, and that original name can't be recovered. `staffNameBackfilledAt` marks these rows so they are never presented as names captured at payment.

The appointment lookup backfill adds `guestPhoneDigits` (digits only, '' for no phone) and `guestEmailNormalized` (trimmed, lower case) to each appointment. Guest names, phones and emails are unchanged.
