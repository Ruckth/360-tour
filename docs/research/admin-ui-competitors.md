# Admin UI competitor benchmark (2026-11-04)

This benchmark covers the 360-tour staff admin, which is used by a luxury seaview villa resort in Thailand. Staff use it mostly on iPad in landscape, on desktop, and sometimes on phones. It covers each sidebar section in `src/components/admin/admin-routes.ts`: Chats, Hotel bookings, Staff bookings, Checkout, Business facts, Properties, Leads and Settings, plus the app shell around them. The doc ends with a shared scoring rubric for independent screenshot auditors.

**How this was gathered.** Sources are official help centres, design-system docs, changelogs and company design posts, as of November 2026. Every claim has its URL.
- *(snippet)* means the claim comes from a search-engine extract because the page couldn't be fetched (Cloudbeds, Hostaway, Guesty, Zenoti and Clover returned 403 errors or pages that need JavaScript).
- *(community)* means the source is an unofficial forum post.
- *(inference)* means it's my reading, not something the vendor states.

Almost no vendor publishes pixel sizes, pane widths or touch-target sizes. The exceptions are Shopify Polaris and Vercel Geist, and both are quoted below. The Ease POS comparison is in `docs/plans/ease-pos-checkout-study.md` and isn't repeated here.

---

## 1. Shell and navigation (Linear, Stripe, Shopify admin, Vercel)

- **Linear**
  - The sidebar and top header form an "inverted L" around the content. https://linear.app/now/how-we-redesigned-the-linear-ui
  - The sidebar order is Inbox, My Issues, Workspace, Teams, then Favorites (pinned pages).
  - Shortcuts: ⌘K for pages and actions, `/` for search (including by ID), `?` for the shortcut list, G→I to jump to Inbox. https://linear.app/enablement/guides/navigating-linear
  - Users can reorder and hide sidebar items behind "More", and each badge can show as a count or a dot. https://linear.app/changelog/2024-12-18-personalized-sidebar
  - The 2026 refresh dimmed the sidebar so content leads, with fewer and smaller icons and header actions in the same place in every view. https://linear.app/now/behind-the-latest-design-refresh
  - Light, dark and high-contrast themes are all generated from three LCH values (base, accent, contrast). https://linear.app/now/how-we-redesigned-the-linear-ui
- **Stripe**
  - The sidebar has main navigation (Home, Balances, Transactions, Customers, Catalog), then **Shortcuts** (pinned and recent pages), then a Products group with a "More" menu.
  - Home surfaces items that need action, such as disputes. https://docs.stripe.com/dashboard/basics
  - Search supports `field:value` and `is:` filters, and the query is stored in the URL so it can be shared. Enter shows all results grouped by type. https://docs.stripe.com/dashboard/search
- **Shopify admin**
  - ⌘K searches orders, products, customers and apps. It shows 7 results, then "Show # more". https://help.shopify.com/en/manual/shopify-admin/admin-search
  - Rules from Shopify's guidelines for apps inside the admin:
    - Navigation has at most 7 items, and they are nouns. https://shopify.dev/docs/apps/design/navigation
    - The page header has one primary and up to three secondary actions, with no actions at the bottom of the page. https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/page
  - Spacing follows a 4px grid, and density stays the same within a page. https://shopify.dev/docs/apps/design/layout
  - Body text is 13/20px. https://unpkg.com/@shopify/polaris-tokens@9.4.2/dist/css/styles.css
  - Empty states name the cause and offer one primary action. "No filter matches" uses different copy from "nothing yet". https://shopify.dev/docs/api/app-home/latest/patterns/compositions/empty-state
- **Vercel**
  - The sidebar can be resized and hidden, and it replaced the tabs in Feb 2026. On mobile there is a floating bottom bar for one-handed use. https://vercel.com/changelog/dashboard-navigation-redesign-rollout
  - The command menu shows "Recent" items when the input is empty and shows each item's shortcut. https://vercel.com/geist/command-menu
  - Type sizes are 14px for body text, 13px for secondary and 12px only for tertiary. https://vercel.com/geist/typography
  - Vercel's web interface guidelines:
    - Hit targets are at least 24px, or 44px on mobile, and inputs are at least 16px on mobile.
    - Spinners wait 150–300ms before appearing and then stay for at least 300–500ms.
    - Skeletons match the final layout.
    - Filters and tabs are kept in the URL.

    https://vercel.com/design/guidelines

## 2. Chats inbox (Intercom, Front, Zendesk, Respond.io)

- **Panes**
  - Intercom has three panes: navigation, list and details. `[` and `]` hide the side panes, and `L` switches between a chat layout and a table layout. https://www.intercom.com/help/en/articles/7911926-customize-help-desk-to-suit-you-and-how-you-work-best
  - Zendesk has fields on the left, the conversation in the middle, and a resizable context panel on the right. https://support.zendesk.com/hc/en-us/articles/5447690090138-About-custom-layouts-with-layout-builder
  - Respond.io has a views panel, the conversation list, and a contact panel. https://respond.io/help/inbox/getting-started-with-inbox
- **Rows**
  - Respond.io shows a channel icon on the avatar, a Closed or Snoozed label, an unread count, the time, and a last-sender arrow (blue for the team, orange for the contact). https://respond.io/help/inbox/managing-conversations-in-inbox
  - Intercom shows the nearest SLA timer: red when overdue, orange under 5 minutes, otherwise grey. https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets
- **Views**
  - Intercom's built-in inboxes are Your inbox, Mentions, All and Unassigned. https://www.intercom.com/help/en/articles/6258745-the-help-desk-explained
  - Front groups conversations as Open, Later and Done, with filters shown as chips you can remove. https://help.front.com/en/articles/3889728
- **AI replies (shared pattern)**
  - In Zendesk the draft goes **into the composer**, with Approve, edit, Undo and dismiss controls. An info icon shows the reasoning and sources, and suggestions stop after three dismissals. https://support.zendesk.com/hc/en-us/articles/7051314237466
  - Intercom Copilot lives in a sidebar tab. Its sources can be previewed, and answers based on internal-only sources are marked yellow with a warning. "Add to composer" also offers tone, translate and "add as note". https://www.intercom.com/help/en/articles/8587194-how-to-use-copilot
  - Front drafts into the composer when you press Space in an empty composer. https://help.front.com/en/articles/2344960
  - Respond.io's AI Assist button only appears when the composer is empty. https://respond.io/help/inbox/using-ai-assist
- **Translation.** Intercom auto-translates each customer message. A label under the message shows the original language and toggles back to the original text. https://www.intercom.com/help/en/articles/10545610-ai-inbox-translation
- **Closed messaging window.** Once the WhatsApp 24-hour window has closed, the composer is replaced by a warning and a "Choose template" option.
  - Intercom: https://www.intercom.com/help/en/articles/9881312-using-whatsapp-as-a-channel
  - Zendesk ("composer is blocked"): https://support.zendesk.com/hc/en-us/articles/5869718332954
  - Front: https://help.front.com/en/articles/2050
- **Assign and close**
  - In Respond.io both sit at the top right, and Close asks for a closing note with an AI summary. Ctrl+M assigns and Ctrl+Q closes. https://respond.io/help/inbox/assigning-and-closing-a-conversation
  - Front: E archives, S snoozes, Shift+A assigns to me, and ⌘Enter sends and archives in one step. https://help.front.com/en/articles/2189

## 3. Hotel bookings calendar (Mews, Cloudbeds, Little Hotelier, Airbnb)

- **Grid**
  - Little Hotelier shows a 14- or 28-day view. Arrows move 1, 7 or 14 days, and "View today" puts today in the first column. https://help-platform.littlehotelier.com/en/articles/10397723-getting-started-with-calendar
  - In Mews, today is highlighted in blue and there's a Today button. Density can be Default, Comfortable or Compact. https://help.mews.com/s/article/The-Timeline-An-overview · https://help.mews.com/s/article/Configuring-the-Timeline-view
- **Booking bars**
  - Little Hotelier: the bar colour shows status (confirmed, checked in, checked out, closed). A **left-edge stripe** shows payment (red unpaid, green paid). Icons mark a repeat guest, notes, the channel logo and the number of nights. Same URL as above.
  - Mews colours bars by the **action needed** (orange urgent, blue "today", grey in-house), not by channel. The label is "Last, First" plus lock, group and returning-guest icons. https://help.mews.com/s/article/The-Timeline-An-overview
  - Cloudbeds puts a red dot on a bar with an outstanding balance.
- **Detail**
  - Cloudbeds opens a right-hand Reservation Panel and the grid stays visible. The panel shows dates, room, contact, status, notes and the balance (red when owed). It links on to the folio. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48384262863771 *(snippet)*
  - Mews opens a "Smart detail" side window with the guest, balance, rate and items breakdown, Check-in/out and Lock. https://help.mews.com/s/article/The-Smart-detail-window-in-the-Timeline
- **Creating from the grid**
  - In Cloudbeds, clicking an empty cell offers New reservation (with room and date pre-filled), Block or Out of service. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48384262863771 *(snippet)*
  - In Little Hotelier, dragging across empty cells asks "Reservation or Room closure". https://help-platform.littlehotelier.com/en/articles/10397723-getting-started-with-calendar
- **Moving bookings**
  - Cloudbeds: drag sideways to change the dates, which asks for confirmation. Drag to another row to change the room. A rate change prompts a review first. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/55835270255131 *(snippet)*
  - Mews: locked bookings can't be dragged. https://help.mews.com/s/article/Managing-reservations-on-the-Timeline
- **Filters.** Cloudbeds' filters **dim** bookings that don't match instead of hiding them, so the grid keeps its shape. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48372183498907 *(snippet)*
- **Airbnb.** The multi-calendar supports bulk price and availability edits. Selecting dates shows the guest total and payout breakdown. https://www.airbnb.com/resources/hosting-homes/a/new-tools-to-host-smarter-not-harder-776 · https://www.airbnb.com/resources/hosting-homes/a/redesigned-pricing-tools-now-in-your-airbnb-calendar-582

## 4. Staff bookings: calendar, roster, staff, services (Fresha, Zenoti, Mindbody, Square Appointments)

- **Fresha**
  - Views are Day, 3 Days, Week and Month. Columns can be the scheduled team, all team, or rooms and resources. Zoom is Small or Large. With "Quick actions" on, clicking an empty slot books it. https://www.fresha.com/help-center/knowledge-base/calendar/16-manage-your-calendar-display-settings-
  - A "Colour by" switch picks staff, service category or status. Status colours: Booked blue, Confirmed purple, Arrived orange, Started green, No-show red, Completed grey. https://www.fresha.com/help-center/knowledge-base/calendar/487-organize-appointments-by-color-in-your-calendar
  - Status changes from a dropdown at the top right of the appointment. Checkout sets it to Completed automatically, and No-show is only allowed after the start time. https://www.fresha.com/help-center/knowledge-base/calendar/600-update-appointment-statuses
  - Dragging moves an appointment in time or to another staff column, and dragging the bottom edge changes its length. A conflict and notification dialog follows, and details open in a right panel. https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments
  - Rooms and equipment are linked to services so they can't be double-booked online. On mobile, more than 3 columns scroll sideways. https://www.fresha.com/help-center/knowledge-base/calendar/101215-create-and-manage-resources
  - Calendar filters cover paid, part-paid and unpaid. https://www.fresha.com/help-center/knowledge-base/calendar/290-customize-your-calendar-view-1
  - Shifts repeat on a pattern, with "Edit this day" for one-off changes. https://www.fresha.com/help-center/knowledge-base/calendar/252-schedule-and-update-team-shifts
- **Zenoti**
  - Blocks are coloured by status by default, and a single appointment can be given its own colour (e.g. VIP). https://www.zenoti.com/blogs/customize-your-appointment-book-colors-for-smarter-guest-management
  - The redesign limits the icons on a block and moves phone and provider details into the tooltip. Hovering highlights all of that guest's services. The room name is shown on the block instead of a room colour. https://help.zenoti.com/en/appointments/redesigned-appointment-book.html *(snippet)*
- **Square Appointments**
  - Calendars can show Only me, Combined or Side-by-side, with optional staff photos. Block icons: ✓ confirmed, ? unconfirmed, ★ new client, ↑/↓ for back-to-back services. https://squareup.com/help/us/en/article/8442-set-up-calendar-view-filters-for-appointments
  - A service record holds duration, processing gap, extra time, staff, colour and add-ons. https://squareup.com/help/us/en/article/6487-create-a-service-from-the-square-appointments-app
- **Mindbody.** Staff can cancel or confirm without leaving the calendar. https://www.mindbodyonline.com/en-gb/business/education/blog/mindbody-ui-ux-todays-modern-workflows
- **Not documented anywhere:** layout details, sticky staff headers, and shading for non-working hours.

## 5. Checkout (POS): Square, Toast, Shopify, Lightspeed, Clover, Loyverse, SumUp, Mews, Cloudbeds, Zenoti/Fresha

These are the patterns that matter for our catalog, order, pay, receipt and customer-display flow.

- **The cart never leaves the screen.**
  - Shopify POS 11.0 keeps the cart visible from picking items through payment. Customer, staff, cash and split pads open in a left side panel instead of pop-ups. The "More" menu holds only actions on the whole cart. https://changelog.shopify.com/posts/shopify-pos-version-11-0
  - Toast's payment screen shows the check on the left and tenders on the right. https://support.toasttab.com/en/article/New-POS-Managing-Payments?lang=en_US
  - Lightspeed K-Series also puts the order on the left, with "Total selected" for partial payment. https://k-series-support.lightspeedhq.com/hc/articles/360051089473
- **Tiles**
  - Shopify's Smart Grid holds products, variants, collections and action tiles (discount, custom sale, custom fee), in swipeable pages assigned per location. https://help.shopify.com/en/manual/sell-in-person/getting-started/smart-grid
  - Square uses item, variation, category, custom-amount and shortcut tiles, plus a quantity bar to set quantity before tapping. https://squareup.com/help/au/en/article/8334-set-up-item-grid
  - Toast and SumUp use **colour** buttons, not photos. https://doc.toasttab.com/doc/platformguide/adminAssigningPOSButtonNicknameColorinMenuBuilder.html
  - Loyverse uses a photo grid on tablet and a list on phone. https://help.loyverse.com/help/home-sale-screen-layouts
- **Primary action**
  - Toast labels it "Pay ($)" *(the amount is inferred)*, and an optional **Fast $$** button next to it closes the check as exact cash. https://support.toasttab.com/en/article/Cash-Payments-Configuration
  - Square places Charge next to Save Ticket. https://squareup.com/help/article/8238
  - Mews' green **Create invoice** button appears only when the balance reaches 0. https://help.mews.com/s/article/split-the-bill
- **Cash**
  - Toast's quick-cash buttons are **derived from the total**: a $20.40 check shows $21, $25 and $30. Change due or remaining balance is shown. https://support.toasttab.com/en/article/Cash-Payments-Configuration
  - Shopify 11.10 shows suggested amounts first and shows change due inside checkout, not on a separate screen. https://www.shopify.com/hk-en/blog/shopify-retail-roundup-july-2026
- **Split**
  - Mews starts with 2 equal payments. +/- changes the count, editing one amount recalculates the rest, and each payment has its own tender and Undo. https://help.mews.com/s/article/split-the-bill
  - SumUp splits Equally, by Amount or by Items. "Next payment" goes back to checkout showing the remaining balance. https://help.sumup.com/en-GB/articles/5WnfPRzSgK2gbeJ7jQq5rC-split-payments-with-multiple-payment-methods-for-a-single-sale
- **Tips.** Everyone offers 3 presets plus Custom and No tip, and Square, SumUp and Mews switch between fixed amounts and percentages by bill size. https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping
  - Zenoti and Mindbody tip **per therapist**, or split one tip in proportion to each therapist's services. https://www.zenoti.com/spa-management-software/spa-pos · https://support.mindbodyonline.com/s/article/202299210-Leaving-a-tip-for-an-appointment
- **Line edit**
  - Every product reviewed uses tap the line to open a sheet. Square's sheet has qty ±, note, price adjustment, discount toggle and modifiers, and swipe-left deletes. https://squareup.com/help/us/en/article/8238
  - Toast voids need a reason, and a manager code if the user lacks permission. https://support.toasttab.com/article/Voiding-Items-Payments-and-Checks
- **Charge to room or folio** (the hotel-specific gap):
  - Mews: "Charge to room", then search by guest name, room name or number (which can contain letters), or scan the key card. The guest signs, then the charge is confirmed. https://help.mews.com/s/article/How-to-charge-orders-to-a-room-in-Mews-POS
  - Mews now lets staff attach the room **when opening the order** instead of at payment. https://releases.pos.mews.com/en/charge-to-rooms-when-taking-orders-instead-of-during-payment-for-a-smoother-experience-Uv8u0L04
  - Cloudbeds: "Charge to Folio" only works for checked-in guests. House-account charges can't be moved to a folio later. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/32999164466715-How-to-use-Cloudbeds-POS *(snippet)*
  - In Lightspeed K-Series, room charge is a tender with a guest search. Clock PMS warns that if it's misconfigured, the charge looks posted when it wasn't. https://help.prenohq.com/en/articles/9350553-bill-to-room-in-lightspeed-pos-k-series · https://clock-software.com/products/integrations/k-series-by-lightspeed
- **Booking to cart.** Square Appointments "Review and Check Out" and Zenoti both fill the cart from the appointment, including staff credit. https://squareup.com/help/us/en/article/6001-check-out-with-the-square-appointments-app
- **Customer display**
  - Toast: idle image, then the itemised bill on the left with a brand image on the right, then tip and signature, then receipt choice, then "thank you" with the total. Light and dark modes. https://support.toasttab.com/en/article/Guest-Facing-Display
  - Shopify shows three screens plus an idle screen, with toggleable product images. https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customize-pos/customer-display
  - Lightspeed X shows the remaining balance going down after partial payments. https://x-series-support.lightspeedhq.com/hc/en-us/articles/55420318857499
- **Receipt and reset**
  - Toast puts "No receipt" first, then Print, Text and Email, then "New order". https://support.toasttab.com/en/article/New-POS-Managing-Payments?lang=en_US
  - SumUp offers a **QR receipt** that needs no contact details. https://help.sumup.com/en-GB/articles/1fSkzdQVkSeXUUZXtkmrNh-generate-qr-code-receipts
  - Square can skip the receipt screen when the customer already has a preference on file. https://squareup.com/help/us/en/article/8669-manage-receipt-settings-on-square-point-of-sale
- **Speed**
  - Lightspeed X desktop keys: Alt+S search, Alt+C customer, Alt+P pay, F5 park. https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534134339867
  - Shopify carts auto-save and can be shared across devices. https://www.shopify.com/hk-en/blog/shopify-retail-roundup-july-2026
  - SumUp's "Park order" sits above Charge. https://help.sumup.com/en-GB/articles/Tlhm6Phrqa7sFAW2XWrDP-multiple-orders
- **Dark mode and accessibility**
  - Square has Light, Dark and Auto. https://squareup.com/help/us/en/article/8646
  - Toast button colours have light and dark variants.
  - Clover requires WCAG contrast of at least 4.5:1, hiding controls that don't apply, and the fewest steps. https://docs.clover.com/docs/app-design-requirements

## 6. Business facts / AI knowledge (Intercom Fin, Zendesk)

- **Intercom Fin**
  - Knowledge > Content is one list for all sources. It filters by AI Agent state, Copilot state, language, tag and last editor, and has a bulk "Change AI Agent state". https://www.intercom.com/help/en/articles/9459991-search-filter-and-find-content-and-take-bulk-actions
  - A snippet is a title plus a body, with a Details panel (language, last updated by), toggles for **Available for Fin / Copilot**, and an audience. It autosaves and reaches the AI in about 10 minutes. https://www.intercom.com/help/en/articles/8074407-create-and-manage-snippets
  - Content is grouped by state: enabled, syncing, errors, not enabled. https://www.intercom.com/help/en/articles/7837514-add-your-content-for-fin-ai-agent
  - Preview has a Customer view and an **Event log** showing which content was used. Staff can test as a chosen audience, language or channel. https://www.intercom.com/help/en/articles/12599471-use-fin-previews
  - Every AI reply in the inbox has **Improve answer**, which shows the top sources and offers Create snippet or Edit. https://www.intercom.com/help/en/articles/8403222-debug-fin-ai-agent-answers
  - Recommendations list content gaps ranked by impact, with the conversations behind each. Each can be accepted, marked done or rejected. https://www.intercom.com/help/en/articles/11390088-optimize-fin-instantly-with-the-help-of-ai
- **Zendesk**
  - Article lists can show up to 6 extra columns, with built-in views (All, AI-generated, Drafts, Archived). https://support.zendesk.com/hc/en-us/articles/4408837776666
  - **Verification rules** mark content stale after a set interval and add it to a "Needs verification" list. https://support.zendesk.com/hc/en-us/articles/5588297664666
  - Each article has usage and escalation stats. https://support.zendesk.com/hc/en-us/articles/11338970010138

## 7. Properties (Airbnb listing editor, Hostaway, Guesty)

- **Airbnb**
  - The listing editor has two groups, "Your space" and "Arrival guide", with a **View** button that previews the listing as a guest sees it. https://www.airbnb.com/resources/hosting-homes/a/introducing-the-listings-tab-638
  - The photo tour uses AI to sort photos into 19 room types. Every room needs at least 1 photo, and photos can be dragged to reorder within a room. https://www.airbnb.com/resources/hosting-homes/a/more-control-in-the-listings-tab-677
  - The first 5 photos form the cover. Reordering autosaves, but captions and cover changes need Save, so the save model is mixed (a pattern to avoid). https://www.airbnb.com/help/article/477
- **Guesty**
  - Property pages have a grouped left menu (Details & layout, Marketing, Pricing & policies, Calendar), and each section has its own Edit. https://help.guesty.com/hc/en-gb/articles/9363762029469 *(snippet)*
  - Photos: the top-left one is primary, and they reorder by drag. Staff can check several and **bulk-set the caption and room**. https://help.guesty.com/hc/en-gb/articles/9370336312221 *(snippet)*
  - The desktop index is a table with a column picker. The mobile index uses tiles showing photo, name, status and connected channels. https://help.guesty.com/hc/en-gb/articles/9931630384413 *(snippet)*
- **Hostaway**
  - The index is a table with actions on each row. Each channel shows a status: Live, Hidden, Ready to export or Failed. https://support.hostaway.com/hc/en-us/articles/48958532654107 *(snippet)*
  - Saving is explicit, with "Save only" or "Save & Export". https://support.hostaway.com/hc/en-us/articles/1500000234441 *(snippet)*

## 8. Leads (HubSpot, Pipedrive, Attio)

- **HubSpot**
  - The record page has properties and quick-log icons (Note, Email, Call, Task, Meeting) on the left, the activity timeline with filters in the centre, and associations on the right. https://knowledge.hubspot.com/records/work-with-records
  - Clicking a board card opens a preview panel where edits autosave. https://knowledge.hubspot.com/records/preview-a-record
  - Saved views appear as tabs, and cells can be edited in place. https://knowledge.hubspot.com/records/view-and-filter-records
  - A stage can require certain fields before a deal moves into it. https://knowledge.hubspot.com/crm-deals/set-up-and-customize-your-deal-pipelines-and-deal-stages
- **Pipedrive**
  - Cards show title, contact, value and owner, plus a next-activity arrow: red overdue, green today, grey future. A yellow warning means no activity is scheduled. https://support.pipedrive.com/en/article/pipeline-view
  - "Rotting": a card turns red after a stage's idle-days limit. https://support.pipedrive.com/en/article/the-rotting-feature
  - The deal page has a stage bar showing days spent in each stage. https://support.pipedrive.com/en/article/deal-detail-view
- **Attio**
  - Kanban stages can collapse to show colour, name and count, with a "+ Add calculation" at the bottom of each stage. https://attio.com/help/reference/managing-your-data/views/create-and-manage-kanban-views
  - The table can be edited like a spreadsheet and has "Open preview". https://attio.com/help/reference/managing-your-data/views/create-and-manage-table-views

## 9. Settings (Stripe, Linear, Vercel, plus Shopify's save model)

- **Layout.** Shopify's settings pattern is a narrow left column with the section title and description, and the fields on the right. https://shopify.dev/docs/apps/design/layout
  - Linear's settings use a left section nav, and member lists are sortable tables. https://linear.app/changelog/2024-12-18-personalized-sidebar
- **Save model**
  - Shopify shows a **contextual save bar** (Save/Discard) as soon as any field changes, and rejects autosave for settings. https://shopify.dev/docs/apps/design/user-experience/forms
  - Vercel saves each section card on its own *(inference)*. https://vercel.com/docs/git
  - Vercel's guidelines: errors appear next to the field, focus moves to the first error, and staff are warned before leaving with unsaved changes. https://vercel.com/design/guidelines
- **Team**
  - Stripe: Add member, enter several emails, assign one or more roles. Invites expire after 10 days. https://docs.stripe.com/get-started/account/teams
  - Vercel: pending invites show "expired" after 7 days, and each member has a ⋯ → Remove. https://vercel.com/docs/rbac/managing-team-members
  - Linear: invite by role, with a reset button for the invite link. https://linear.app/docs/invite-members
- **Dangerous actions**
  - Vercel puts Pause above Delete at the bottom of the page. Both need the project name typed, and the dialog lists what will be lost. https://vercel.com/docs/projects/managing-projects
  - Linear emails a code before deleting a workspace, then waits 48 hours, during which any admin can cancel. https://linear.app/docs/workspaces
  - Stripe's key Rotate keeps the old key working for up to 7 days. https://docs.stripe.com/keys
- **Connection status**
  - Shopify shows a status badge with Connect/Disconnect, a confirmation dialog, then a toast. https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings
  - Stripe lists webhook deliveries as Delivered, Pending or Failed, with the HTTP code and next retry. https://docs.stripe.com/webhooks

---

## Patterns worth adopting (across the admin)

Effort is a rough guess (S ≤1 day, M 2–4 days, L 1–2 weeks) based on a quick code check. That check found no charge-to-room/folio code and no global command palette (`cmdk` is only used in `entity-picker.tsx`).

| # | Pattern | Who does it | Why it matters for the resort | Effort |
|---|---|---|---|---|
| 1 | **Charge to villa / folio** as a tender: search by villa or guest name, checked-in guests only, with guest signature or confirmation. The villa can also be attached when the order opens. | Mews, Cloudbeds, Lightspeed K | Most resort extras (spa, experiences, minibar) are charged to the stay, not paid on the spot. Without this, staff take two payments. | L |
| 2 | **Cart stays visible from catalog through payment.** Tender, customer and split open in a side panel, not a modal. | Shopify POS 11, Toast, Lightspeed K | On iPad landscape, staff never lose sight of what they're charging. | M |
| 3 | **Cash quick amounts based on the total** (exact, next round amounts), with change due shown inline, plus a one-tap "exact cash" | Toast, Shopify 11.10 | THB notes (100/500/1000) suit amounts like ฿3,450 → ฿3,500 / ฿4,000 / ฿5,000. | S |
| 4 | **Split payment driven by remaining balance:** N payments, each with its own tender and Undo. The finish button appears only when the balance is ฿0. | Mews, SumUp, Loyverse | Couples and groups often split villa and spa bills between cash, PromptPay and card. | M |
| 5 | **Booking fills the cart:** Checkout from a spa or villa booking adds its lines, guest and therapist credit | Square Appointments, Zenoti, Fresha | Removes re-keying and stops the calendar and the till disagreeing. | M |
| 6 | **Side panel for details** on calendars, inbox and boards, with the grid or list still visible and "open full" for depth | Cloudbeds, Mews, Fresha, HubSpot | It's the natural master-detail layout for iPad landscape, and staff keep their place. | M |
| 7 | **Calendar bar shows status colour, with payment as a separate marker** (edge stripe or dot), a legend, and a Today button | Little Hotelier, Mews, Cloudbeds, Fresha | Front desk can see "who still owes money" at a glance without mixing it into status. | S–M |
| 8 | **Tap or drag on an empty cell** opens New booking / Block villa, with villa and dates pre-filled. Moving a booking needs confirmation, and bookings can be locked. | Cloudbeds, Little Hotelier, Fresha, Mews | Fastest way to create a booking, while protecting confirmed stays from accidental drags. | M |
| 9 | **AI draft goes into the composer**, labelled with its sources and with accept/undo/dismiss. Translations show the original-language label. | Zendesk, Intercom, Front | Thai, Korean and English guests: staff need to trust and edit drafts, not copy and paste chips. | M |
| 10 | **Messaging-window state shown in the composer**: expired means a warning plus a template picker instead of free text | Intercom, Zendesk, Front | Stops failed sends on WhatsApp and Messenger (and any LINE quota or limits, not researched). | S |
| 11 | **Each business fact is a record** with an AI on/off toggle, last updated by whom, and a stale flag. "Improve answer" in a chat jumps to the fact. There's also a gap list of unanswered questions. | Intercom Fin, Zendesk | Keeps AI answers current on prices, transfers and policies, and shows staff what to write next. | M |
| 12 | **Global ⌘K / search** across guests, bookings, villas and actions, showing recent items when empty | Linear, Shopify, Vercel, Stripe | One box replaces hunting through 8 sections, and it works on iPad with a keyboard. | M |
| 13 | **One save model for settings:** a sticky Save/Discard bar on change, a leave-page warning, and dangerous actions at the bottom behind typed confirmation | Shopify, Vercel, Linear | Non-technical staff need it to be obvious whether a change is saved. | S–M |
| 14 | **Channel connection rows:** a text badge (Connected / Error), last activity or error, Reconnect/Test | Shopify, Stripe, Hostaway | LINE, FB and WhatsApp tokens expire, and a silent failure means guest messages get missed. | S |
| 15 | **Customer display sequence:** branded idle screen, then the itemised bill (with remaining balance during split), then the PromptPay QR, then a thank-you with a QR receipt | Toast, Shopify, Lightspeed X, SumUp | Fits a luxury brand, and the guest sees exactly what they're paying for. | S–M |
| 16 | **Villa photos with a cover marker, drag reorder, and a caption and room tag per photo**, plus bulk select and a "view as guest" link | Airbnb, Guesty | Good villa photos drive bookings, and room tags feed the website and the AI. | M |

---

## Admin UI scoring rubric (for independent auditors)

> **Superseded (2026-11-05)** by the 11-category, per-device scorecard in `docs/research/ui-scoring-metric.md`. The criteria below are absorbed there. The page-specific criteria in the next section are still used, with per-device bars from `docs/research/admin-ui-responsive.md`.

**How to score.** Score each criterion from 0 to 10 using the screenshots plus the short flow description. Multiply each score by its weight and add them up (weights total 100), then divide by 100 to get an overall score out of 10. Score the main device (iPad landscape, about 1180×820) first. Phone and desktop screenshots can only lower criteria 4 and 5. Every score must cite at least one screenshot.

| # | Criterion (weight) | What 9/10 looks like | Deduct for |
|---|---|---|---|
| 1 | **Primary task and action clarity (15)** | Each screen has one obvious job and one primary button, top right or pinned to the bottom of its panel, labelled verb + noun (or with an amount, e.g. "Charge ฿4,250"). Secondary actions are visibly quieter. Benchmarks: the Shopify page header, Mews "Create invoice". | Competing filled buttons, primary action below the fold, vague labels ("Submit", "OK") |
| 2 | **At-a-glance status (15)** | Lists, calendars and cards show the states staff act on without hovering or opening anything: unpaid or balance, waiting time, unread, status, owner. Colour is always backed by a text label or icon and a legend. Benchmarks: Little Hotelier payment stripe, Respond.io rows, Pipedrive activity arrows. | Needing to open an item to learn its state, colour as the only signal, decorative colour that means nothing |
| 3 | **Navigation and wayfinding (10)** | The shell is identical on every page, with the current section highlighted and the page title matching the nav label. There are 9 or fewer top-level items, count badges only on queues that need action, and search is reachable from every page (⌘K or a visible field). Benchmarks: Linear, Shopify, Vercel. | Shifting nav, dead ends with no back or breadcrumb, badges on things that need no action |
| 4 | **Layout fit on iPad landscape, with responsive fallbacks (15)** | Master-detail: the detail opens in a side panel with the list, grid or cart still visible. Nothing important is cut off or scrolls sideways at 1180px. On phone, panes stack and nav collapses to a drawer or bottom bar. Benchmarks: Cloudbeds reservation panel, Shopify POS 11 cart. | Full-page modals that hide context, horizontal overflow, the desktop layout shrunk onto a phone |
| 5 | **Touch targets and density (10)** | Tap targets are at least 44px on touch layouts, with spacing so neighbouring targets aren't hit by mistake. Body text is 13–16px, phone inputs are 16px or more, and spacing follows one grid. Density is the same within a page and makes good use of the screen (e.g. 10 or more inbox rows, all villas visible). Benchmarks: Vercel guidelines, Polaris tokens. | Tiny icon-only buttons, cramped or sparse screens, mixed densities |
| 6 | **Editing, saving and safety (10)** | Edits happen where the data is (inline or a side sheet). There is one visible save model with a "Saved" confirmation. Destructive actions are set apart, red, and confirmed with the consequence stated (typed confirmation for anything irreversible), or offer Undo. Overrides ask for a reason. Benchmarks: Shopify save bar, Vercel danger zone, Toast void reason. | Silent autosave mixed with Save buttons, delete next to edit, no confirmation |
| 7 | **Empty, loading and error states (10)** | Empty states name the cause and offer one verb + noun action. "No results for this filter" differs from "nothing yet". Skeletons match the final layout. Errors sit next to the field or item, in plain language, with a recovery action. Benchmarks: Polaris and Geist empty states. | Blank panes, spinners on the whole page, technical error text |
| 8 | **Visual craft and brand fit (10)** | It feels calm and premium, right for a luxury villa resort: limited palette, consistent type scale, aligned edges, high-quality photos where they help (villas, services), and consistent icons. Dark mode, if offered, matches light mode feature for feature. Benchmarks: Linear refresh, Toast guest display. | Default-template look, misaligned elements, mixed icon sets, low-resolution or stretched images |
| 9 | **Accessibility and language (5)** | Text contrast is at least 4.5:1, icons have labels or tooltips, focus states are visible, and the keyboard path works on desktop. Labels and copy are clear for non-native English speakers, and Thai text renders without clipping. Benchmark: Clover app requirements. | Grey-on-grey text, icon-only controls with no label, truncated Thai |

### Page-specific extra criteria (each scored 0–10 and reported separately from the overall score)

- **Shell, S1 "Find anything":** One search or palette finds guests, bookings, villas and settings, and runs a few actions. It shows recent items when empty and shows shortcuts. (Linear, Vercel)
- **Chats**
  - **C1 "Triage row":** At iPad landscape, 10 or more rows each show channel badge, name, one-line preview, relative time, unread count, assignee or Unassigned, and a waiting cue. Views include Mine, Unassigned and per channel. (Respond.io, Intercom)
  - **C2 "Safe AI reply":** The AI draft is in or beside the composer, labelled as AI, editable, with sources. Reply and internal note are clearly different. The messaging-window state shows above the composer, and an expired window turns the composer into a template picker. (Zendesk, Intercom)
- **Hotel bookings**
  - **H1 "Tape chart":** Every villa and 14 or more days are visible, with the villa column and date header fixed in place. There is a Today marker and button. Bars show guest and nights, a status colour plus legend, and a payment marker. Blocks look clearly different. (Little Hotelier, Mews)
  - **H2 "Booking panel":** Tapping a bar opens a side panel showing guest, dates, villa, channel, price breakdown, deposit, paid and balance (balance emphasised) and notes, with the next action. Tapping an empty cell offers a pre-filled New booking or Block. (Cloudbeds, Mews)
- **Staff bookings**
  - **B1 "Therapist day view":** There are 4 or more staff columns with name or avatar headers, a current-time line, off-shift and blocked time shaded, and blocks showing guest, service, time and status. A drag or resize affordance is visible. (Fresha)
  - **B2 "Lifecycle":** Booked, Confirmed, Arrived, Started, Completed and No-show are each distinguishable. The detail panel shows the status control and the next-step button (e.g. "Check out"). (Fresha, Zenoti)
- **Checkout**
  - **P1 "Tender speed":** The total is the largest number in the order panel, and the primary button includes the amount. Cash has total-based quick amounts plus Exact, and change due is shown inline. Split shows the remaining balance and the paid parts. Charge to villa/folio is offered. A typical cash sale takes 3 taps or fewer after the cart is built. (Toast, Shopify 11.10, Mews)
  - **P2 "Order integrity":** Tapping a line opens one edit sheet (qty, price override with reason, discount, note, therapist). Deposits and discounts are separate visible lines. The guest or villa is attached in a persistent strip. The customer display mirrors the bill and the remaining balance. Afterwards, the receipt choice leads to one "New sale" reset. (Square, Lightspeed X, Toast)
- **Business facts, F1 "Auditable knowledge":** Each fact row shows title, category, AI on/off, language, last updated by and when, and a stale flag. A test panel shows which facts an answer used, with one-click edit. Unanswered guest questions are listed as gaps. (Intercom Fin, Zendesk)
- **Properties, R1 "Villa listing":** The index shows cover photo, name, status, bedrooms, guests, base rate and a completeness flag. The photo manager has a cover marker, drag reorder, a caption and room tag per photo, and a "view as guest" preview. (Airbnb, Guesty)
- **Leads, L1 "Pipeline health":** Each stage shows count and value. Cards show name, value or dates, owner, and a next-activity or overdue marker, and stale leads are flagged. The record has inline-editable properties, a timeline (messages, notes, stage changes) and quick-log actions. (Pipedrive, HubSpot)
- **Settings, T1 "Calm configuration":** There is a section sub-nav, with a title and description column next to the fields. One save model with a visible saved state. Channel rows show a text status, the last error or activity, and Reconnect/Test. The admin list shows role and invite status (active, pending, expired). Dangerous actions are isolated with typed confirmation. (Shopify, Vercel, Stripe)
