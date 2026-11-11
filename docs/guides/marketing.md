# Marketing tracking and referral review

## Set up a campaign

Open **Admin → Marketing → Campaigns**. Give each campaign a source, medium and descriptive name, for example Facebook / paid / November escape. Drafts do not publish automatically. A manager or system administrator publishes campaigns, links and coupons.

Create a short link under **Links** for each placement, such as `/f`, `/m`, `/ig`, `/w1` or `/a1`. Website and ad names are editable; a published short address is permanent. Select a booking destination and optionally a coupon. Copy the link or generate its QR offer card. Guests can save the card with the readable code and later enter the code at checkout.

A link identifies its placement, not the app where somebody eventually shares it: a Facebook link forwarded in LINE still reports Facebook. Link opens are separate from consented visits and from sales.

## Coupons and checkout

Under **Coupons**, create a code such as `DCNT-F1-20`, define its actual percentage or fixed benefit, eligible properties/services, dates and limits, then test a quote before publishing. The text of a code does not determine its discount. The configured rules do.

Only one coupon applies. It replaces the direct booking discount when it is better; discounts do not stack. Invalid, expired, exhausted or less valuable codes show an explanation and the applicable direct price. A QR card suggests a code; it does not reserve availability or a discount.

Web booking and staff checkout use the same offer rules. Chat can quote a code supplied by the guest. It cannot invent or choose an undisclosed coupon. A chat proposal records its reviewed total and coupon version. If price, eligibility or availability changes before confirmation, the guest sees a fresh proposal and must review it again before a booking or coupon hold is created. Retrying a successful confirmation uses the existing booking.

## Measurement choice

Guests choose whether to allow saved measurement. A current-link coupon can still work when they decline. Declining, removing the choice or clearing storage invalidates pending capture work and clears local measurement identity. Other open tabs honor withdrawal when the storage change is received. If storage is blocked or full, the interface explains when measurement is limited to the current page; it does not promise a saved choice.

## Read the dashboard

**Business** groups sales by creation date and answers which sources brought bookings. **Finance** groups money and coupon settlements by their effective date and answers what was received or refunded during the range. Filter by property and attribution model as needed, and export CSV from the same view.

A first-payment sale requires actual collections. A service order covered entirely by a coupon has no invented payment: Finance shows it separately as a coupon-only checkout settlement and retains its discount cost. Mixed stay/service orders allocate stay cash to the booking once. Refunds reduce net collections. Partial or capped reports display warnings; their totals must not be treated as complete.

Conversion counts distinct consented sessions behind paid web stays, divided by consented sessions started in the range (including direct arrivals). Several stays sharing a session count once; earlier sessions are excluded. Breakdown rates follow the session's recorded link and campaign, independently of the first/last-touch sales attribution toggle. Current-link paid stays without a session are shown separately and never enter the rate.

Custom-price stays keep their coupon usage and attribution, but their reported coupon discount is zero. Detail rows and sales CSV mark them **Custom price**. Historical desk appointment payments are included only when the original manual payment change proves the collection; POS-owned money remains on its order.

## Preserve legacy conversion cohorts after deploy

Run `migrations:backfillMarketingAttributionSession` once after deploying this release, **before enabling raw marketing-session retention cleanup**. Only bookings store the report's `marketingAttribution`. The internal migration pages through them in batches of 100 and freezes the session's start time and optional link/campaign, including direct sessions. It preserves all other attribution and booking fields. Missing raw sessions are skipped because their cohort cannot be reconstructed safely.

```sh
npx convex run migrations:run '{"fn":"migrations:backfillMarketingAttributionSession","dryRun":true}'
npx convex run migrations:run '{"fn":"migrations:backfillMarketingAttributionSession"}'
npx convex run --component migrations lib:getStatus '{"names":["migrations:backfillMarketingAttributionSession"]}'
```

Wait for status `success` before retention cleanup. It is safe to rerun; completed runs are skipped, and `reset: true` rescans without overwriting frozen cohorts. New bookings already freeze their cohort. If cleanup already deleted a legacy session, this migration cannot recover it.

## Referral partners

Under **Affiliates**, create a partner with a stable link name (for example `/r/anna`), campaign, optional contact email, property scope and date range. A new partner starts paused with a draft alias. Activate it to publish the canonical link. Pausing disables future partner eligibility; archiving is permanent. Saved sales retain their original referral snapshot.

Optionally assign a unique coupon to the partner. One coupon belongs to at most one partner at a time. Removing an assignment affects future sales only. No email is sent to the contact.

Future bookings and settled orders freeze their eligible link and coupon candidates. The last eligible partner link within the attribution window takes precedence; a partner coupon is the fallback. A link/coupon disagreement is flagged and requires an explicit partner choice during review. Self-referrals and staff-created orders are flagged for manual assessment. Existing sales are not backfilled.

The review queue records pending, approved, rejected and reversed credit. Approval requires an eligible, paid/settled sale, the displayed revision and a reason. A changed amount must be refreshed and reviewed. Rejected or reversed credits do not reopen on payment retries. Partial refunds adjust approved net collections; full refunds, cancellation or a no-money void reverse eligibility. Every amount change and decision is recorded in the credit history.

**Referral credit is performance reporting and manual approval only. This release does not calculate commissions, create a payable balance or send payouts.** The THB amounts are net collections associated with the referral, not money owed to the partner.

## Marketing access

System administrators from `ADMIN_EMAILS` can invite an account under **Access**, change its role or revoke it. The user signs in with the invited email and explicitly activates the invitation; the grant then binds to that authenticated account identity. Invitations do not send email. An unclaimed invitation expires after 14 days; **Renew invitation** (or saving its role) restarts the 14 days. Activated access does not expire.

| Role | View | Personal details | Edit drafts | Publish / budgets | Spend | Partners | Review credit | Manage access |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| System administrator | Yes | Full | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Full | Yes | Yes | Yes | Yes | No | No |
| Marketer | Yes | Redacted | Yes | No | No | No | No | No |
| Finance | Yes | Full | No | No | Yes | No | Yes | No |
| Viewer | Yes | Redacted | No | No | No | No | No | No |

Marketing grants do not grant booking, customer, POS, receipt or other operational administrator access. Server permissions enforce these rules in addition to the visible controls.

Personal details means guest names, booking confirmation codes, POS customer names and partner contact emails. Viewer and marketer responses redact these on the server, including coupon redemptions, referral candidate snapshots and marketing record history. History contact fields and free-text notes are hidden; referral decision reasons show **Reason hidden**. Stored audit records remain unchanged. Finance, manager and system administrators retain full detail. CSV exports use the same role-appropriate report data.
