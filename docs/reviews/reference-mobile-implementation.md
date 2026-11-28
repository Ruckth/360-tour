# Mobile reference implementation audit

The November 28 reference report has 65 entries. The implementation starts at `0647bdc5`, after the navigation and experience work in #115–116 and the Stock and Dashboard work in #117–118. The evidence uses seeded resort, catalog, and order data in Chromium. Staff integration tests use a fresh local Convex backend and Clerk test identities. Fixtures exercise other states without issuing real payments, refunds, email, or invitations.

## Changes by workflow

| Workflow | Observed change | User impact |
| --- | --- | --- |
| Checkout | Representative catalog row is 78 CSS px through 430 px, down from 97 px. At 390 px, six fixture items fit above the bar. Photos, category tabs, search, gold add controls and the navy order/Cash bar remain. | Cash entry stays one tap away. The total and View order both fit at 360 px. Cash change is available on the receipt before expanding its preview. |
| Hotel | Phone calendar controls fit in two rows. An agenda row opens the stay directly and restores focus on close. | One tap from a visible stay instead of opening its action menu first. The real settlement status owns the Paid label. |
| Guest booking | Connected date fields, inline consent and a sticky summary with nights, total and Continue. | A guest can proceed while the measurement notice is present. Back within the three-step funnel preserves the draft. Payment errors offer a read-only check before retry. |
| Marketing | Mobile definitions expand within the divided list, below their metrics. Range, property scope, attribution and finance figures retain their established controls. | The definition and its value stay together. Profitability carries the applied scope to its Transactions link. |
| Stock | A branch-scoped Low stock view, compact selection bar and real receipt-to-order quantities. | Partial receipt of five of seven units leaves two due. The due count and exact lot are reachable from the receipt. |
| Staff operations | Searchable Settings and Villa sections, optional Week roster, explicit hotspot modes and guarded staff archive Undo. | Staff reach long sections without scrolling a horizontal tab strip. Mobile scene panning and position changes use distinct controls. |

## Reference coverage

| Reference entry | Implementation and applicable limits |
| --- | --- |
| Home | Real date fields and Book/Chat appear together. Consent participates in the page layout and hands focus to Book. |
| Villa details | Original photos and stay facts remain. The phone gallery offers a single tour entry, larger arrows and the existing Check dates action. Missing villas retain the recovery route. |
| 360 tour and gallery | A live scene selector, localized scene names, touch controls and Book from the first ready scene. A real villa photo remains on renderer failure. Physical-device gestures and the notch need device verification. |
| Services | Search and accessible category controls fit compactly. A chat return keeps filtered search, cursor and the originating service anchor. |
| Experiences | Photo rows open the activity description in one phone sheet. A concierge email can carry the translated activity name. Content without a live price uses inquiry availability. |
| Booking funnel | The live three-step flow remains. The reference illustrated separate Guests and Details steps. Combined dates, inline consent and a sticky quote run through real availability validation. |
| Guest payment | Verified balance, booking reference and a server-derived hold deadline when applicable. Recovery reads booking status before retry. Stripe session reuse and idempotency remain in place. |
| Confirmation | Server-confirmed stay details and contact, with separate checking, expired and confirmed states. A guest can recheck without starting a new payment. |
| Concierge chat | In-transcript consent leaves the composer reachable. Existing handoff, draft, failed-send retry and replay protection remain. |
| Privacy | Linked sections and in-context measurement preferences. Published policy copy remains. |
| Terms | Linked sections and existing terms. An in-funnel draft remains in memory. Leaving the funnel for Terms does not persist guest details across routes. |
| Sign in | Phone safe-area spacing and existing verified internal return. Live MFA and provider outages require the identity provider. |
| Sign up | Optional account setup retains Clerk verification and the separate guest booking path. |
| Missing page | Public paths and unavailable room slugs retain their existing recovery links. |
| Today | Chats decisions first. Arrivals show an authoritative due amount when due, upcoming spa appointments show resort-local times, and authorized staff have direct Checkout access. |
| Admin menu, branch and approvals | Groups Daily, Grow, Manage and Configure within the existing Menu. Branch scope, draft confirmation and approval overlay continue to use their existing authority checks. |
| Hotel bookings | Compact counts, two-row phone toolbar, dated agenda groups, real balances, statuses and one-tap phone details. |
| Stay actions and OTA rates | Existing conflict checks, cancellation confirmation and history remain. Mobile sheets improve the rate editor and retain its draft. |
| Inbox | Removable channel and assignment filters combine server-side, independently of chat search. Opening from the phone queue creates a Back entry with focus return. Chats belongs to the primary resort desk. Conversations have no branch field. |
| Conversation | Original single composer, separate staff follow-up, restrained mobile status header and Details sheet. Guest replies and internal notes retain different handling. Leads require a verified relationship before display. |
| Leads | Compact contact row, existing search and detail, explicit copy action and copy failure feedback. |
| Business facts | The editor shows the originating question and identifies visibility as Staff draft or Guest-facing. Existing approval and Undo resolve the report. |
| Checkout | Original catalog visuals and actions with shorter cards and a full-length View order label. Photo placeholders, order item counts and loading, empty and search states remain reachable. |
| Orders | Current item comes into view when present in the loaded list. Returned history includes older refunds, credits and completed zero-value returns. Older results remain paginated. The list remembers the selected filter and restores the current row when loaded. |
| Desk payment | Existing split tender, amount checks, pending payment reconciliation, stale review handling and correction reason remain in the tested entry points. |
| Returns | Returns begin from the receipt, retain original quantities and funding information, and use the existing server-side duplicate protection and recovery. |
| Receipt | Paid state, reference and real cash change above the folded preview. Print stays visible for one-tap reuse after the first setup. Share stays in the overflow menu. |
| Checkout preview and display | Pairing moved into More on phones to keep Orders visible. Existing expired-link, idle and paid views remain. The browser verifies creating and copying a link. Physical display pairing requires the device. |
| Spa calendar | Phone day list, search and Clear leave the chosen date and existing schedule tools intact. Wider calendar and staff lanes remain available. |
| Roster | Selected-day list, explicit Week mode and sticky staff names. Existing time-off conflict and batch Undo protection remain. |
| Staff directory | Searchable staff rows with separate account access. Archive Undo can only restore the archive revision it followed. |
| Service assignments | Search by service, category or staff. Existing service-scoped editor and wider assignment matrix preserve option and eligibility rules. |
| Properties | Phone list constrains long names and links, shows status and price, and filters by publication state. Villa catalog entries are resort-wide. |
| Property editor | Deep-linkable sections and a phone chooser. Unsaved Details and OTA rates survive section switches. Browser Back to the list prompts before discarding. |
| Hotspots | Full-height phone editor with Look, Add, Move, centre aim, explicit numeric position and Undo. Editing a position requires an explicit action. |
| Settings | Searchable phone sections, permission-filtered entries, dirty confirmation and old Team tab links. |
| Booking rules | Hold, stay and reminder grouping, visible units, inline validation, one save action and resort time copy. |
| Checkout rules | Existing effective policy, rollout acknowledgement and authority-sensitive settings remain. Long operator names wrap within the reconciliation queue on phones. |
| AI settings | Existing configuration and history with an isolated example reply preview. |
| Email | Saved sender preview and confirmed recipient for a test send. The mutation verifies the selected recipient has not changed. |
| Channels | Phone diagnostics distinguish configuration and channel health. Existing provider controls and failures remain subject to provider verification. |
| Team access | Existing branch-scoped role confirmation and invite recovery. Team receives an explicit Marketing-role preset from old Marketing access links. |
| Branches | Location history and existing blockers remain visible. Suspensions remain gated where downstream enforcement is missing. |
| Marketing dashboard | Real report values retain the existing scopes. Definitions appear beneath their numbers in a divided phone list. Finance places business results before tracking setup when sales predate the first campaign. |
| Campaigns | Phone search and status share a row. An Undo toast resumes only the unchanged paused version. Related links remain in editor details. |
| Links and QR | Published link copy and QR share a detail section. Mobile list names open details directly. QR returns focus to its trigger. |
| Coupons | Existing draft, publish, status and scope in their original routes. Quote simulation is independent of applying a coupon to a live sale. |
| Coupon editor | Existing validation and confirmation plus a proposed-rules simulation where the caller can edit the saved coupon. Service-only quotes can run without a villa. Treatment dates and desk eligibility require their own checks. |
| Affiliates | Existing partner credit amount, state, reason, permission guard and decision history. |
| Marketing access | Old link routes to authorized Team access with the Marketing role filter selected. |
| Profitability | Costed gross margin, reference period and applied-filter Transactions link. Margin uses the actual costed revenue cohort. |
| Transactions | Existing source, effective date, form recovery and delete confirmation. Existing report filters carry through from Profitability. |
| Stock balances | Live branch thresholds, untouched/out-of-stock distinction, direct Receive and Count, and URL-backed filters. |
| Stock products | Original searchable product/variant catalog and gated branch operations remain. History can resolve archived records. |
| Stock activity | Compact movement rows and inspection links retain signed delta, reason, branch and lot. Unsafe adjustments preserve the input for correction. |
| Purchasing | Existing URL-backed queues and filter recovery with direct receiving from the selected order. |
| Purchase requests | Original requester, branch, quantities and reason with role-gated actions and retained review history. |
| Purchase orders | Ordered, received, held and due quantities lead the detail; the existing scoped receipt action prevents duplicate submission. |
| Goods receipts | Accepted and rejected quantities with authorized live due from the source order header. Links return to order, movement and exact lot. |
| Stock expansion | Existing role and branch-gated tool paths, with compact summaries and child sheets. |
| Transfers and lots | One phone filter sheet, visible origin/destination/quantity, existing lot and permission safeguards. A lot-required receive without a supported lot selection stays blocked. |
| Stock count and opening quantities | One phone row per item keeps name and SKU beside a reachable number field. Existing count review, reasons and recount preserve authority. |
| Suppliers and held goods | Held goods grouped by original receipt. Existing return and reversal paths retain history and restore focus in the correction flow. |
| Till approval | Existing request, amount, operator, decision, expiry and audit history. Requests continue to require independent authority. |
| Admin access gates | Existing sign-in, expired invitation, authorized branch selection and unavailable-scope recovery. |

## Evidence

- Seeded Chromium route audit passed 264 distinct scenario and viewport combinations at 360, 390 and 430 px. Public pages and guest states accounted for 72 checks. Signed-in staff pages, overlays and redirects accounted for 192 checks. The corrected layouts passed the landmark, horizontal overflow and uncaught runtime error checks.
- The full local verification passed 5,138 checks in the unit suites and the production build. Follow-up runs passed 56 affected component browser cases, all 32 architecture checks, and the live local Inbox and guest Chat navigation cases.
- Booking, consent, guest Pay and confirmation. [Guest integration suite](../../tests/e2e/guest-completion.spec.ts)
- One-tap Hotel details and focus at 360, 390 and 430 px. [Hotel browser suite](../../tests/browser/booking-desk.spec.ts)
- Checkout catalog, long totals, cash and printed receipt. [Checkout layout suite](../../tests/browser/checkout-layout.spec.ts) · [Receipt suite](../../tests/browser/ux-p4-receipt.spec.ts)
- Staff sign-in, browser Back, assignment and queue focus. [Inbox integration suite](../../tests/e2e/admin-chat.spec.ts)
- Villa dirty navigation, phone hotspot modes, Settings and roster. [Property integration suite](../../tests/e2e/admin-property-settings.spec.ts) · [Hotspots suite](../../tests/e2e/admin-hotspots.spec.ts) · [Settings suite](../../tests/browser/settings-team.spec.ts)
- Reporting figures, inline definitions and filtered finance reconciliation. [Marketing browser suite](../../tests/browser/marketing-dashboard.spec.ts) · [Profitability integration suite](../../tests/e2e/profitability.spec.ts)
- Authenticated partial receipt, lot links, filter recovery and low stock. [Stock integration suite](../../tests/e2e/stock-workflows.spec.ts)

## Independent design review

The four scores cover the detailed Checkout, Hotel, Booking and Marketing designs in the reference report. The reviewer used app captures, source, and seeded browser interactions. An 8 means the tested task is readable, reachable and efficient at the phone widths exercised. The scores represent expert judgement and apply to those journeys.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Compactness | 8.5/10 | Checkout fits six compact catalog items. Hotel’s controls occupy 111 px in two rows. Booking joins its date fields, and Marketing groups secondary metrics. |
| Usability | 8/10 | The long Checkout total remains usable at 360 px. Hotel restores focus to the selected booking. Booking’s Continue remains usable with consent shown at 360, 390 and 430 px. |
| Visual hierarchy | 8/10 | Checkout photographs and Cash stay prominent. Hotel visually distinguishes balances and status. Marketing explains secondary figures below their values. |
| Interaction efficiency | 8.5/10 | Cash entry and agenda stay details take one tap. Booking keeps the price beside Continue. Marketing explanations open in place. |

## Code audit and release limits

The standards reviewer identified races in phone Inbox closing, unnecessary purchase-order reads from receipt detail, and a duplicated Low stock threshold. The implementation guards closing while confirmation or Back is in flight, projects due units from the authorized order header, and shares the quantity predicate. The coupon reviewer’s stale-result and save-parity findings were addressed in the simulation and its tests.

The spec review retained the three-step booking sequence and one-tap Print. Orders preserves the filter and locates the current row when loaded. Exact scroll offsets and older page depth are outside that restoration. Guest Pay’s read-only check derives status from the booking. Stripe still owns session reuse and payment idempotency. Physical keyboard and 360 gestures, hardware pairing, live provider status and payout delivery, and provider MFA require separate environments or devices. Those states are outside the review scores.
