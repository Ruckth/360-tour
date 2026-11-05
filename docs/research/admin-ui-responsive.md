# Admin UI across phone, iPad and desktop (2026-11-05)

This document covers how each admin screen should adapt across four size classes, how input methods change interaction, what must stay the same across devices, and which responsive mistakes auditors should deduct for. It feeds the improvement loop in `docs/plans/admin-ui-improvement-loop.md`.

**Related docs, not repeated here**
- `docs/research/admin-ui-competitors.md`: desktop and iPad patterns per screen, plus the current rubric.
- `docs/research/responsive-standards.md`: device sizes, breakpoints, touch-target and text thresholds, and Playwright measurement.
- `docs/research/admin-responsive-inventory.md`: how today's code behaves on each device.

**How this was gathered.** Sources are platform guidelines (Apple HIG, Android/Material), product help centres and changelogs, and NN/g and W3C, as of November 2026. Every product claim links its source.
- *(snippet)* means only a search extract was seen.
- *(community)* means an unofficial forum post or app-store reply.
- *(inference)* means my reading, not the source's words.
- Recommendations for the resort are not marked; they are the conclusions drawn from the evidence.

**Size classes used here** (pick by the app's available width, not by device; see Apple and Android below)
- **Phone**: under 600px. One pane.
- **iPad portrait / medium**: about 600–1000px. One main pane plus overlays.
- **iPad landscape / expanded**: about 1000–1300px. Two panes.
- **Desktop**: 1280px and up. Two or three panes.

---

## 1. Platform rules that frame every screen

- **Layout follows available space, not device.** Apple says "Determine layout based on size classes, not device type or orientation" and "Keep functionality the same as size classes change… you can change the amount of functionality that's visible." Larger spaces may switch "from a tab bar to a sidebar" or expose what was in an overflow menu. [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout). Android says size classes are "not intended for isTablet-type logic". [Android window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
- **Navigation form**
  - Android: a navigation bar when the window is compact, a navigation rail for everything else. [Android adaptive navigation](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation)
  - Android quality tier 2: "leading-edge navigation rails that expand on larger window sizes into full navigation panels". Rails should replace bottom bars on large screens, and drawers should become expanded rails. [Android adaptive quality, tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2)
  - Apple tab bars: for navigation, not actions. Keep the bar visible, avoid the "More" tab, and never hide or disable tabs. Keep a default of five or fewer tabs. A search tab can sit at the trailing end. On iPad the tab bar can convert to a sidebar. [Apple Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
  - Apple sidebars: "Avoid hiding the sidebar by default to ensure that it remains discoverable." Show no more than two levels. Let people hide it with the gestures they already know. [Apple Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- **Panes**
  - Android list-detail: expanded windows show list and detail together. Medium and compact windows show one at a time, and Back returns to the list. Selection and state must survive rotation and resizing. [Android canonical layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts)
  - Android supporting pane: on compact windows the supporting content goes below or into a bottom sheet. Medium splits about 50/50, expanded about 70/30. Same source.
  - Android tier 2: "Trailing-edge panels that are open by default on desktop screen sizes; closed, on smaller screens." [Tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2)
  - Apple split views: use them in regular width, not compact. Persistently highlight the current selection in each pane. Provide "multiple ways to reveal hidden panes… including a keyboard shortcut". Design for "narrow, compact, and intermediate" iPad widths. [Apple Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)
  - Short landscape phones are compact height (under 480dp), where "two pane layouts are not practical". [Android window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
- **Overlays**
  - Apple sheets: "Display only one sheet at a time." Use full-screen views for complex or long flows. On iPad prefer page or form sheets. Confirm a swipe-dismiss when there are unsaved changes. Cancel goes on the leading edge, Done on the trailing edge. [Apple Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
  - NN/g bottom sheets: for short side tasks where the background still matters. Don't stack them, don't use them to replace page-to-page flows, and always include a visible Close and Back support. [NN/g Bottom sheets](https://www.nngroup.com/articles/bottom-sheet/)
  - Android tier 2: on large screens, bottom sheets, buttons and text fields are not full width. Small menus and modals don't cover the whole screen, and context menus appear next to the item. [Tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2)
  - Material: full-screen dialogs are for "a series of tasks" and are the only dialogs that other dialogs may open over. [Material Dialog docs](https://github.com/material-components/material-components-android/blob/master/docs/components/Dialog.md)
  - Material: standard side sheets share the screen with content, while modal side sheets block it. Coplanar sheets are "not recommended for narrow screens". [Material SideSheet docs](https://github.com/material-components/material-components-android/blob/master/docs/components/SideSheet.md)
- **Where the primary action lives**
  - **Phone, create:** a "+" in the top bar or at the bottom right. Examples: Stripe's "+" at the top right of every tab ([Stripe mobile](https://docs.stripe.com/dashboard/mobile)), Linear's "Create Issue" at the top of every screen ([Linear, Oct 2025](https://linear.app/changelog/2025-10-16-mobile-app-redesign)), and Notion Calendar's "+" at the bottom right ([Notion Calendar](https://www.notion.com/help/manage-your-calendars-and-events)).
  - **Phone, next step on a record:** a bottom action bar. Examples: Stripe's Refund and ⋯ ([Stripe mobile](https://docs.stripe.com/dashboard/mobile)), Fresha's appointment Actions ([Fresha 263](https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments)), and Toast handheld's "Print and Pay buttons are always in view" ([Toast](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)).
  - **Phone, form commit:** Cancel and Save in the top bar (Apple Sheets above). The keyboard can't cover it.
  - **iPad and desktop:** the page-level primary sits top right ([Shopify page](https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/page)). A record's next step sits at the bottom of its side panel and changes with state, e.g. Cloudbeds Check-in → Check-out ([Cloudbeds panel](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48384262863771)) and Fresha "Actions" at the bottom of the right panel ([Fresha 518](https://www.fresha.com/help-center/knowledge-base/sales/518-apply-deals-and-discounts-at-checkout)).

**Conflict with today's shell.** Below 1400px the sidebar is a hidden drawer, so iPad landscape and 1280px desktops show no navigation (`admin-responsive-inventory.md`, shell section; commit d58a728). The evidence points the other way:
- NN/g found hidden navigation used less and slower, and says "Do not use hidden navigation… in desktop user interfaces". [NN/g Hamburger menus](https://www.nngroup.com/articles/hamburger-menus/)
- Apple says avoid hiding the sidebar by default.
- Android recommends a rail at every size above compact.

Recommendation: a visible rail on iPad (both orientations) that expands to the full sidebar, and the full sidebar from about 1280px.

---

## 2. Per-screen matrix

Each cell covers navigation and panes, the data form, the overlay surface and the primary action. Evidence is in section 3.

| Screen | Phone (<600) | iPad portrait (~600–1000) | iPad landscape (~1000–1300) | Desktop (≥1280) |
|---|---|---|---|---|
| **Shell** | Bottom tab bar: **Chats · Hotel · Spa · Search · Menu**. Menu is a grouped list of the other sections. Top bar has the title plus at most one action. No sidebar. | Leading rail (icon + short label), always visible. Search in the header. Sub-pages shown as in-page tabs. No bottom bar. | Rail by default, expandable to the full sidebar (choice remembered). Search field in the header. ⌘K when a keyboard is attached. | Persistent sidebar (sections + sub-pages, ≤2 levels), collapsible to the rail. ⌘K plus a `?` shortcut list. |
| **Chats** | List → full-screen conversation; Back keeps scroll. Guest details: tap the name to push a page. Composer pinned above the keyboard. AI draft is one chip that fills the composer. At most one swipe action per side, plus ⋯. | Conversation full width. List as a slide-over (button), or full width when nothing is selected. Details as a trailing modal side sheet. | List and conversation side by side. Details as a toggleable trailing panel. AI draft in the composer. | Three panes: list, conversation, details. Shortcuts for next, assign, close, send. |
| **Hotel bookings** (tape chart) | Opens on **Today** (arrivals / in-house / departures). Tape chart has a sticky villa column, 5–7 days, swipe or arrows. Detail is full screen with the next action pinned at the bottom. Create with "+". Move with "Change dates" / "Move villa", not drag. | All villas × 7–10 days. Detail as a trailing side sheet over the chart. Today button. | All villas × 14+ days, sticky headers. Non-modal side panel; the chart stays usable. Tap an empty cell → New booking / Block. Long-press drag, then confirm. | 14–28 days. Panel beside the chart. Density setting. Optional hover summary. Date shortcuts. |
| **Staff calendar** (therapist day) | Today agenda (time-ordered, therapist on each row), plus a Day grid of 1–3 therapists with a staff picker. Detail is full screen. Reschedule form. "+" to create. | Day grid with 3–4 therapist columns, sticky names and time axis, visible scroll cue. Detail as a trailing sheet. | Day grid with 6–8 columns, off-shift shading, now line, side panel. Long-press drag with confirm, plus a tap-only Reschedule. | All staff, or Week per therapist. Side panel. Resize handles on hover or focus, with time fields as the alternative. |
| **Roster** | Pick a person → their week as a list. Tap a day → sheet (start, end, break, repeat). Team overview is read-only. | Staff × 7-day grid, sticky name column. Tap a cell → popover editor. | The same grid with no sideways scroll. Popover or side panel editor. | Grid plus weekly hour totals, copy week, bulk edit. |
| **Staff & Services lists** | Rows, not tables. Detail page. The staff × service matrix becomes a checklist per service. | Rows. Detail as a trailing sheet or a pushed page. | Table with 4–5 key columns. Detail in a side panel. | Full table with sort and a column picker. Matrix visible. |
| **Checkout (POS)** | Catalog list with search and category chips. Persistent **cart bar** (count + total) → full-height cart, with **Charge ฿X** pinned at the bottom. Line edit is a bottom sheet. Tender is full screen. | Catalog grid with 3–4 columns. Bottom cart bar with Charge ฿X. Cart opens as a trailing side sheet. | Catalog left, cart right, both always visible. Tender, customer and split replace the catalog area, never the cart. Charge ฿X pinned at the bottom of the cart. | As iPad landscape, plus keyboard: search focus, Enter to add, a pay shortcut. |
| **Receipt** | One column: paid, method, change. "No receipt" first, then Print / QR / Email. **New sale** pinned at the bottom. Corrections behind ⋯. | The same, at a readable max width. | Shown in the cart pane; the catalog area resets for the next sale. | Receipt preview with the actions beside it. |
| **Customer display** | Phone-only sale: a full-screen "Show to guest" step for the QR and receipt choice. | Second device: full screen, portrait or landscape, no admin chrome. | Same. | Not used (it runs on its own device). |
| **Business facts** | Rows (title, category, AI on/off, updated) plus filter chips. Editor is full screen with Cancel/Save in the top bar. | List → editor as a pushed page or large sheet. | List and editor side by side. | Table plus an editor panel; the AI test panel as a supporting pane. |
| **Properties** (+ photos) | Villa cards (cover, name, status, key facts). Editor is a section list → section pages. Photos in a 3-column grid; Select → Cover / Move earlier / Move later / Delete in a bottom bar. | Two-column cards. Editor in one column with section tabs. | List + editor. Photo grid of 4–5 columns. Long-press drag plus a menu. | Table/grid toggle. Editor with a section sub-nav. Drag reorder, bulk caption, "View as guest". |
| **Leads** | List segmented by stage (with counts), not a sideways board. Detail is full screen with a quick-log bar. Stage picker. | Stage list, or a board with a scroll cue. Detail as a trailing sheet. | Board with all stages (collapsible). Card → side panel. | Board/table toggle, preview panel, inline edit. |
| **Settings** | Grouped list → one page per section. Labels above fields. Save/Discard in the top bar once something changes. Danger zone last. | Section tabs at the top, or list → page. One column. | Section sub-nav on the left, form on the right (title and description beside the fields). | The same, with capped form width and a sticky save bar. |

---

## 3. Per screen: evidence and what 9/10 looks like

Each statement is meant to be checked from a screenshot, or from `flow.md` where it is marked *(flow)*.

### 3.1 Shell

**Evidence**
- **Phone tab bars:** each product shows a handful of daily destinations plus a Menu tab.
  - Airbnb's host app tabs are Today, Calendar, Listings, Messages and Menu, and Menu holds earnings, insights and settings. [Airbnb hosting tools, 2025-12-10](https://www.airbnb.com/resources/hosting-homes/a/exploring-your-hosting-tools-738)
  - Stripe's tabs include Home, Payments, Balances and Customers. [Stripe mobile](https://docs.stripe.com/dashboard/mobile)
  - Square's bottom bar is customisable through More. [Square redesign, 2022](https://squareup.com/us/en/the-bottom-line/inside-square/square-pos-redesign) · [Square release notes, 2026-07-30](https://squareup.com/ca/en/release-notes/release-notes-july-30th)
  - Linear users can rearrange their mobile navigation. [Linear, 2026-01-22](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile)
- **Tablet:** Shopify's app "replaced the tab bar with a sidebar" on tablet. [Shopify changelog, 2024-03-13](https://changelog.shopify.com/posts/updated-the-shopify-app-s-navigation-experience-on-tablet)
- **Desktop**
  - Vercel's sidebar is resizable and can be hidden, with a floating bottom bar on mobile. [Vercel, 2026-02-26](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)
  - Shopify moved search into a sidebar that collapses. [Shopify, 2026-09-24](https://www.shopify.com/blog/admin-new-look)
- **Labels:** Shopify app nav labels are 1–2 word nouns, one level deep, and become a title-bar dropdown on mobile. [Shopify app-nav](https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav)

**Why these phone tabs.** Staff phones are for chats, today's bookings and quick lookups, so Chats, Hotel and Spa get tabs. Search covers lookups, at the trailing end as Apple suggests. Checkout, Business facts, Properties, Leads and Settings go under Menu; the Apple "More tab" warning applies to an overflow of peers, and Airbnb's Menu shows the accepted alternative. If global search isn't built yet, drop the Search tab rather than show a weak one. "Spa" only works if the sidebar uses the same word (see section 5).

**9/10 phone**
- A bottom tab bar with 4–5 items, each an icon plus a text label, is visible on every top-level screen. The current tab is highlighted.
- The top bar title matches the tab label. There is at most one primary action, at the trailing edge.
- Pushed detail screens show Back with the parent name.
- Only Chats carries a count badge.
- Menu lists the remaining sections in the same order and with the same names as the desktop sidebar.
- Nothing sits under the notch or the home indicator.

**9/10 iPad**
- **Portrait:** every top-level section is visible on a leading rail, with no tap needed to reveal it. There is no bottom tab bar. Content fills the remaining width, not a centred phone-width column.
- **Landscape:** the rail or the full sidebar is visible by default. Collapsing it is a visible control and the choice survives a reload *(flow)*.
- Search is reachable in one tap from every screen, and ⌘K opens it when a keyboard is attached *(flow)*.

**9/10 desktop**
- A persistent sidebar shows every section, with sub-pages (Staff bookings, Settings) at most one level below. It can collapse to the rail.
- ⌘K shows recent items when empty and shows each command's shortcut. `?` lists the shortcuts.
- Header actions sit in the same place on every page. Forms and text have a readable max width instead of stretching to 1440px.

### 3.2 Chats

**Evidence**
- **Phone is always list → conversation.** Details are reached from the header or name:
  - Help Scout: tap the top of the thread or use the conversation dock. [Help Scout mobile, 2026-10-06](https://docs.helpscout.com/article/1601-use-the-mobile-app)
  - Respond.io: tap the contact name. [Respond.io mobile, 2026-09-01](https://respond.io/help/mobile-app/messaging-from-your-mobile)
  - Zendesk: Conversations and Details tabs. [Zendesk agent app](https://support.zendesk.com/hc/en-us/articles/4408825697434)
- **iPad**
  - Apple Mail uses two panes, with a button to hide the list while reading. [Mail on iPad](https://support.apple.com/guide/ipad/ipad99a3ef9e/ipados)
  - Help Scout keeps the right conversation selected on iPad when opened from a notification. [App Store release notes, 2026-10-21](https://apps.apple.com/us/app/help-scout/id966327660)
- **Composer on mobile is thinner than on desktop**
  - Front's default reply is a half-screen quick-reply modal for short text; the full composer holds templates and "compose with AI". [Front mobile](https://help.front.com/en/articles/4907072)
  - Intercom's mobile app does not support Fin Copilot, AI translations or attachments. [Intercom mobile](https://www.intercom.com/help/en/articles/447-respond-to-users-and-visitors-on-the-go-with-the-intercom-conversations-app)
  - Respond.io shows AI Assist only when the composer is empty. [Respond.io mobile](https://respond.io/help/mobile-app/messaging-from-your-mobile)
- **Swipes: one action per direction, often user-set.**
  - Front lets users set left and right swipes from Archive, Trash, Mute, Read and Snooze; long-press multi-selects. [Front mobile](https://help.front.com/en/articles/4907072)
  - Respond.io: swipe left closes, swipe right snoozes. [Respond.io](https://respond.io/help/mobile-app/messaging-from-your-mobile)
  - Help Scout: swipe right assigns. [Help Scout App Store](https://apps.apple.com/us/app/help-scout/id966327660)
  - Linear: "swipe to delete, snooze". [Linear mobile](https://linear.app/mobile)
- **The same actions map across inputs.** Linear's desktop inbox uses Backspace to delete and H to snooze, matching the mobile swipes. [Linear inbox](https://linear.app/docs/inbox) Front's desktop hover-to-snooze is a swipe on mobile. [Front 2088](https://help.front.com/en/articles/2088) *(inference: the mapping)*

**9/10 phone**
- At 390×844 the list shows 6 or more rows. Each row has a channel badge, name, one-line preview, relative time, unread count, and an assignee or waiting cue.
- Views (Mine, Unassigned, by channel) are one tap away as chips or a picker at the top.
- A conversation opens full screen with Back. Returning keeps the list's scroll position *(flow)*.
- **Keyboard-open screenshot:** the composer and Send are fully visible above the keyboard, and the newest message is visible above the composer.
- The AI draft is one compact element in or above the composer. It inserts editable text. Sources and translation are one tap further, and the draft never covers the thread.
- The messaging-window state (e.g. "WhatsApp window closed") is shown as text above the composer.
- Guest details (villa, booking, language, channel) open from the header as a full page or a large sheet with Close.
- Any swipe action also exists in the conversation's ⋯ menu.

**9/10 iPad**
- **Landscape:** list and conversation are side by side, the selected row is highlighted, and 10 or more rows are visible. Details open as a trailing panel without hiding the composer.
- **Portrait:** either a full-width list (nothing selected) or a full-width conversation with a visible control that brings back the list. There are never two cramped panes where previews or messages wrap to a few words.
- With a hardware keyboard, Enter or ⌘Enter sends and Esc closes panels *(flow)*. This matches Android's Enter-to-send and Esc-to-exit rules in [Tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2).

**9/10 desktop**
- List, conversation and details are visible together, and details can collapse.
- Next/previous, assign, close and send have shortcuts, shown in tooltips or menus.
- Every hover action on a row is also in a visible ⋯ menu.

### 3.3 Hotel bookings (tape chart)

**Evidence**
- **Phones show a short date window and swipe for more.**
  - The Little Hotelier app swipes left and right through dates and up and down through room types. [Little Hotelier app, 2026-07-13](https://helpcentre.littlehotelier.com/en/articles/8673688-navigate-your-little-hotelier-mobile-app)
  - It shows a "6-day range", and allocation is tap-only ("Assign room"). [Little Hotelier, 2026-08-27](https://helpcentre.littlehotelier.com/en/articles/8692509-manage-unallocated-reservations-through-your-little-hotelier-mobile-app)
  - The Cloudbeds app calendar has an adjustable date range, and tapping opens a reservation details screen. [Cloudbeds app, updated 2026-10-27](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/41078613036187)
- **The multi-listing grid stays on big screens.**
  - Airbnb's app calendar is per listing (month and year views). [Airbnb, 2023-05-03](https://www.airbnb.com/resources/hosting-homes/a/upgrades-make-your-calendar-easier-to-manage-on-mobile-585)
  - The multi-calendar is not in the app. *(community, snippet)*
- **Touch create and move**
  - Little Hotelier: "Tap and hold an empty room" to create; drag to move, then choose whether to email; a pencil icon to edit. [Little Hotelier, 2025-10-21](https://help-platform.littlehotelier.com/en/articles/10390499)
  - Cloudbeds app: change dates through Edit reservation → Dates. [Cloudbeds, 2024-08-13](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/28236594445083)
  - Cloudbeds web: drag shows valid targets and asks to confirm, and ⋯ → Move is the non-drag route. [Cloudbeds, 2026-09-14](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/55835270255131)
- **Density is a setting, not just a breakpoint.**
  - Cloudbeds "Days to Show" goes up to 4 weeks, and "Browser zoom does not increase the number of date columns". [Cloudbeds, 2026-03-27](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48379953897883)
  - Mews offers Default, Comfortable and Compact. [Mews](https://help.mews.com/s/article/Configuring-the-Timeline-view)
- **Today first on phone.** Airbnb's first host tab is Today. [Airbnb](https://www.airbnb.com/resources/hosting-homes/a/exploring-your-hosting-tools-738)

**9/10 phone**
- The screen opens on Today: arrivals, in-house and departures as grouped rows. Each row shows villa, guest, nights, a status label and any balance due.
- The tape-chart view has a fixed villa column, 5–7 readable days, a Today button and date arrows. Guest names on bars are legible.
- A booking opens full screen with the balance emphasised and the next action (e.g. "Check in") pinned at the bottom.
- New booking comes from "+". Changing dates or villa uses pickers in the detail, so no drag is required *(flow)*.
- Every status colour has a text label or a legend.

**9/10 iPad**
- **Landscape:** all villas and 14 or more days are visible without sideways scrolling. The villa column and date header are sticky. Tapping a bar opens a side panel and the chart stays visible.
- **Portrait:** 7 or more readable days. The detail opens as a trailing side sheet, not a centred dialog. Today is visible.
- Tapping an empty cell offers New booking or Block with villa and date filled in.
- A long-press drag asks for confirmation. The panel's Move and Change dates do the same with taps *(flow)*.

**9/10 desktop**
- 14–28 days and all villas are shown, with a panel beside the chart rather than over it, and a density control.
- Any hover summary repeats only what the panel shows. Today and date stepping have shortcuts *(flow)*.

### 3.4 Staff calendar (therapist day)

**Evidence**
- **Fresha mobile** keeps Day, 3 Days, Week and Month. Its team and resource selector "sits at the bottom of the screen", and zoom runs from Small to Large. [Fresha 16](https://www.fresha.com/help-center/knowledge-base/calendar/16-manage-your-calendar-display-settings-)
- **Square's app** has day, week and list views, and "multiple employees only in the Day view". [Square 8442](https://squareup.com/help/us/en/article/8442-set-up-calendar-view-filters-for-appointments)
- **Notion Calendar**
  - The help page limits mobile to 1–3 days. [Notion Calendar apps](https://www.notion.com/help/notion-calendar-apps)
  - App Store v2.0 (about 2026-11-03) adds iPad support and month, full-week and schedule views. [App Store](https://apps.apple.com/us/app/notion-calendar/id1607562761)
- **Touch move with a tap-only route**
  - Fresha: "tap and hold" to drag, then confirm with Update or Reschedule. The alternative is Actions (⋯) → Reschedule, then tap a slot. [Fresha 263](https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments)
  - Apple Calendar: touch and hold to drag, or tap the event, then Edit. [Apple Calendar iPad](https://support.apple.com/guide/ipad/create-and-edit-events-in-calendar-ipadafeefacf/ipados)
  - Square added drag-to-reschedule in its apps; moving between providers was still a request at the time. [Square community, 2024-01-10](https://community.squareup.com/t5/Product-Updates/Drag-amp-drop-to-reschedule-appointments-available-on-Square/ba-p/702876)

**9/10 phone**
- It opens on today with a now marker. The default is an agenda, or a day grid of at most 3 therapists, never 8 squeezed columns.
- A visible staff picker (chips or a bottom selector) switches therapist.
- Each appointment shows time, guest, service, therapist and a status label.
- The detail is full screen, with the status control and the next step ("Check out") pinned at the bottom.
- Reschedule picks a time and therapist from the detail; drag is optional *(flow)*.

**9/10 iPad**
- **Landscape:** 6 or more therapist columns are readable, with sticky names and time axis, shaded off-shift time and a now line. The detail opens in a side panel.
- **Portrait:** 3–4 columns with sticky headers and a visible sideways-scroll cue, or a staff picker. The detail is a trailing sheet.
- A long-press drag confirms before saving, and a tap-only Reschedule exists *(flow)*.

**9/10 desktop**
- All therapists or a per-therapist week, with the side panel.
- Resize handles appear on hover and on focus. The panel has start and end fields as the non-drag route.

### 3.5 Roster

**Evidence**
- Fresha mobile edits shifts one person at a time: More → Team → Scheduled shifts → a team member, then tap a day → "Set repeating shifts" or "Edit this day". [Fresha 252](https://www.fresha.com/help-center/knowledge-base/calendar/252-schedule-and-update-team-shifts)
- Square creates and publishes shifts on the Dashboard, while its Team app is for staff viewing. [Square 7155](https://squareup.com/help/us/en/article/7155-scheduling-with-team-management)

**9/10 phone**
- You pick a person and see their week as a list (day, start–end, break).
- A day opens a sheet with start, end, break and repeat. Save sits in the sheet's top bar.
- There is no 7-day × all-staff grid scrolling sideways. A read-only "who's on today" list is fine.

**9/10 iPad**
- A staff × 7-day grid with a sticky name column fills the width in landscape. In portrait, any sideways scroll has a visible cue.
- Tapping a cell opens a popover or side panel editor next to the cell.

**9/10 desktop**
- The full week grid shows weekly hour totals, copy-week and bulk edit.

### 3.6 Staff and Services lists

**Evidence**
- **Polaris tables become lists on narrow screens.**
  - Each column gets a list slot (primary, secondary, kicker, inline, labelled). [Polaris table](https://shopify.dev/docs/api/app-home/polaris-web-components/layout-and-structure/table)
  - The header row disappears, so sort and select-all must move into a toolbar or bulk bar. Test empty, loading and error states at both widths. [Polaris IndexTable migration](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/index-table)
- **Notion:** "Any column structure that you created on desktop will be collapsed to a single column" on mobile. [Notion mobile](https://www.notion.com/help/notion-for-mobile)
- **NN/g mobile tables:** sticky headers, a locked first column, and a visible cue when more data is off to the side. [NN/g, 2017](https://www.nngroup.com/articles/mobile-tables/)

**9/10 phone**
- Rows show name, role, status and avatar for staff; name, duration, price and category for services. No table is scrolled sideways.
- Sort and filter live in a toolbar control, since there are no column headers.
- The staff × service assignment becomes a checklist inside one service or one staff member.

**9/10 iPad**
- **Landscape:** a table with 4–5 key columns and the detail in a side panel.
- **Portrait:** rows, with the detail as a trailing sheet or a pushed page.

**9/10 desktop**
- A sortable table with a column picker. The matrix is visible, with a sticky first column and header.

### 3.7 Checkout (POS)

**Evidence**
- **Phone: the cart sits behind a bottom entry point that shows the total.**
  - Shopify POS 11.15 adds a persistent cart button in the bottom navigation showing recent items, item count and running total. It replaced the Cart tab and the "Go to cart" bar. [Shopify, 2026-09-14](https://changelog.shopify.com/posts/keep-the-cart-in-view-on-mobile-pos)
  - Square uses "Review sale" → Charge. [Square Handheld](https://squareup.com/help/us/en/article/8499-accept-payments-with-square-handheld)
  - Fresha uses "Continue to payment" at the bottom. [Fresha Tap to Pay](https://www.fresha.com/help-center/knowledge-base/payments/100637-collect-payments-using-tap-to-pay-1)
  - Loyverse has "Charge (bottom right)". [Loyverse](https://help.loyverse.com/help/make-sales)
- **Phone exception:** Toast's handheld stacks the check above the menu with Pay always visible, and moves Split, Discount and Service Charge into an overflow menu. [Toast, 2026-09-17](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)
- **Catalog form:** Loyverse defaults to a list on smartphones and a three-column grid on tablets. [Loyverse layouts](https://help.loyverse.com/help/home-sale-screen-layouts)
- **iPad portrait follows the phone flow:** "If you're using a mobile device, or your tablet is being used in portrait mode… tap Review sale > Charge." [Square 5174](https://squareup.com/help/us/en/article/5174-swipe-card-payments-with-the-square-reader)
- **iPad landscape keeps the cart visible.**
  - Shopify's tablet split-screen Home shows the cart beside search "at all times". [Shopify, 2024-07-02](https://changelog.shopify.com/posts/shopify-pos-split-screen-home-layout-for-tablet)
  - Shopify moved workflows to windowed views so "the cart is always visible". [Shopify, 2024-09-30](https://changelog.shopify.com/posts/tablet-improvements-for-the-pos-app)
  - Square opens item details "next to the check" and lets sellers put the cart left or right. [Square feature log, 2026-11-02](https://squareup.com/us/en/feature-log)
- **Line edit:** tap opens details. Square and Loyverse support swipe-left to delete, and Square uses long-press for bulk edit. [Square 8238](https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app) · [Loyverse](https://help.loyverse.com/help/make-sales) · [Square feature log](https://squareup.com/us/en/feature-log)
- **Desktop:** Shopify POS is "not available for laptop or desktop computers". [Shopify POS FAQ](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/faq) Fresha's desktop checkout uses a right panel with actions at the bottom. [Fresha 518](https://www.fresha.com/help-center/knowledge-base/sales/518-apply-deals-and-discounts-at-checkout)

**9/10 phone**
- The catalog is a one-column list or 2-column tiles, with search and category chips at the top.
- A cart bar at the bottom always shows item count and total, and opens the full cart.
- The cart's **Charge ฿3,450** button (the amount is part of the label) is pinned at the bottom, within thumb reach.
- Cash tender shows quick amounts based on the total and the change due on one screen.
- A line edit is one bottom sheet (qty, discount, note, therapist) with Done, never a sheet on top of another sheet.
- Discount, split and other rarely used cart-level actions sit in ⋯, not as competing buttons.

**9/10 iPad**
- **Landscape:** catalog left and cart right are both visible in every step. Tender, customer and split open in the catalog area. Charge ฿X is pinned at the bottom of the cart, and the guest or villa strip is at its top.
- **Portrait:** a catalog grid of 3–4 columns plus a cart bar with Charge ฿X always visible. The cart opens as a trailing sheet, never a centred modal over everything.
- Rotating mid-sale keeps the cart, the selected guest and the tender step *(flow)*.

**9/10 desktop**
- The same split as iPad landscape, with hover states on tiles.
- A keyboard path works: focus search, add with Enter, and a pay shortcut shown in its tooltip *(flow)*.

### 3.8 Receipt

**Evidence**
- Toast puts "No receipt" first and, on handhelds, ends with "New order". [Toast payments, 2026-10-27](https://support.toasttab.com/en/article/New-POS-Managing-Payments)
- Loyverse shows total, change due, an email field and "New sale". [Loyverse](https://help.loyverse.com/help/make-sales)
- No product documents a phone-versus-tablet difference for this screen.

**9/10 phone**
- One column shows amount paid, method and change.
- Receipt choices are large buttons with No receipt first. New sale is pinned at the bottom.
- Corrections and voids sit behind ⋯ and ask for a reason.

**9/10 iPad**
- The receipt stays inside the cart pane in landscape, and the catalog is ready for the next sale.

**9/10 desktop**
- A printable preview sits beside the actions.

### 3.9 Customer display

**Evidence**
- **Without a second screen, staff turn the device to the guest for specific steps.**
  - Shopify: "Staff are prompted to turn the Shopify POS device to the customer after payment is accepted", for the receipt choice. [Shopify receipt selection](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/receipt-management/customer-receipt-selection)
  - Toast Go: the guest reviews an itemised preview, then taps Confirm & Pay. [Toast Go 2, 2026-09-17](https://support.toasttab.com/en/article/Setting-Up-Your-Toast-Go-2-and-Accepting-Payments)
  - Square Stand swivels the device to face the customer. [Square Stand](https://squareup.com/help/gb/en/article/5175-accept-payments-with-square-stand)
- **Second-device displays are mostly view-only bills.** Shopify's Customer View runs in landscape or portrait on tablets. [Shopify Customer View](https://help.shopify.com/en/manual/sell-in-person/hardware/customer-view-app) Loyverse shows the ticket plus amount paid and change. [Loyverse CDS](https://help.loyverse.com/help/how-customer-display-works)

**9/10, every size**
- Full screen with no admin chrome. The total is the largest element.
- It follows idle → itemised bill (with remaining balance during a split) → PromptPay QR → thank you.
- The layout works in portrait and landscape.
- On a phone-only sale, the staff screen offers a "Show to guest" step that fills the screen with the QR or receipt choice.

### 3.10 Business facts

**Evidence**
- Android list-detail is the pattern: both panes on expanded widths, one at a time below that. [Android canonical layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts)
- On phones, edits commit from the top bar (Apple Sheets), so the keyboard can't hide Save.
- No knowledge-base vendor documents its mobile layout. Intercom's mobile app has no Fin Copilot. [Intercom mobile](https://www.intercom.com/help/en/articles/447-respond-to-users-and-visitors-on-the-go-with-the-intercom-conversations-app)

**9/10 phone**
- Rows show title, category, AI on/off as text, and the last update. Filter chips sit at the top.
- The editor is full screen with Cancel on the leading edge and Save on the trailing edge. With the keyboard open, Save is still visible.

**9/10 iPad**
- **Landscape:** list and editor side by side, with the selection highlighted.
- **Portrait:** the editor is a pushed page or a large sheet with Cancel and Save.

**9/10 desktop**
- A table with title, category, AI, language, updated by and stale flag, plus an editor panel. The test panel is a supporting pane beside it.

### 3.11 Properties and photo manager

**Evidence**
- Airbnb's app opens a listing editor from the Listings tab. The photo tour supports "removing, moving, or adding photos". [Airbnb Listings tab](https://www.airbnb.com/resources/hosting-homes/a/introducing-the-listings-tab-638)
- Guesty's mobile index uses tiles (photo, name, status, channels). *(snippet)* [Guesty](https://help.guesty.com/hc/en-gb/articles/9931630384413)
- A reorder alternative to drag: select an item, then up/down controls, a position field, or "Move selected items to". [W3C G219](https://www.w3.org/WAI/WCAG22/Techniques/general/G219)

**9/10 phone**
- Villa cards show cover photo, name, status, bedrooms, guests and base rate.
- The editor is a list of sections, each its own page with Save in the top bar.
- Photos sit in a 3-column grid. Select mode shows a bottom bar with Set cover, Move earlier, Move later and Delete, so reordering needs no drag. The cover is marked.

**9/10 iPad**
- **Landscape:** list + editor, and a 4–5 column photo grid with long-press drag plus the same menu actions.
- **Portrait:** 2-column cards, with one editor column and section tabs.

**9/10 desktop**
- A table or grid toggle, an editor with a section sub-nav, drag reorder, bulk caption and room tag, and "View as guest".

### 3.12 Leads

**Evidence**
- Attio: open any record "just as you would on desktop". Record tabs switch by tap or swipe, and "+" creates a record. [Attio mobile](https://attio.com/help/reference/tools-and-extensions/attio-on-mobile)
- A pop-up menu that moves the selected card to another column is an accepted alternative to dragging. [W3C 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- No design-led CRM documents a phone kanban. The stage list for phone below is *(inference)*.

**9/10 phone**
- Leads are a list segmented by stage, with a count per stage. Rows show name, dates or value, and a next-activity or overdue marker.
- The detail is full screen with a quick-log bar (note, message). Stage changes through a picker.

**9/10 iPad**
- **Landscape:** a board with every stage visible (empty stages may collapse). A card opens a side panel.
- **Portrait:** a stage list, or a board with a visible sideways cue.

**9/10 desktop**
- A board/table toggle, a preview panel and inline editing.

### 3.13 Settings

**Evidence**
- **Phone settings are a list you drill into.** Shopify app: Menu → Settings → section. [Shopify apps](https://help.shopify.com/manual/apps/working-with-apps)
- **Save model:** Shopify uses save and discard controls when a form has unsaved changes, and a modal for destructive actions. [Shopify settings template](https://shopify.dev/docs/api/app-home/patterns/templates/settings)
- **Deferring heavy or risky setup to desktop is accepted.**
  - Stripe links bank accounts only on the web. [Stripe mobile](https://docs.stripe.com/dashboard/mobile)
  - Notion can't change workspace security settings on mobile. [Notion mobile](https://www.notion.com/help/notion-for-mobile)

**9/10 phone**
- Settings home is a grouped list (Business, AI assistant, Email, Channels, Admins). Each section is its own page with Back.
- Labels sit above full-width fields.
- Save and Discard appear in the top bar once something changes, and stay visible with the keyboard open.
- The danger zone is last and needs typed confirmation.
- A long setup flow, such as connecting a channel with tokens, may say "Easier on a larger screen" but must still be reachable.

**9/10 iPad**
- **Portrait:** section tabs or a list → page, in one column.
- **Landscape:** section sub-nav on the left, with the title and description beside the fields.

**9/10 desktop**
- The same as iPad landscape, with capped form width, a sticky save bar and a leave-page warning.

---

## 4. Interaction by input

| Topic | Rule | What good products do |
|---|---|---|
| **Detecting touch vs pointer** | Decide hover and pointer treatment with `any-hover` / `any-pointer`, never from width. An iPad can have a trackpad, and a touch laptop has both. | `hover`/`pointer` report only the primary input, and users may mix inputs ([web.dev](https://web.dev/learn/design/interaction), [MDN any-hover](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-hover)). Treat input as touch *and* mouse, not *or* ([Lauke, 2020](https://css-tricks.com/interaction-media-features-and-their-potential-for-incorrect-assumptions/)). Vercel: test hybrid devices separately ([Vercel guidelines](https://vercel.com/design/guidelines)). |
| **Hover** | Hover may only add speed (quick actions, previews). Everything it reveals must also be reachable by tap or focus, and essential info must stay on the page. | Apple: "Make essential hidden controls available in a context menu… touch and hold" ([Pointing devices, 2026-10-28](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)). NN/g: tooltips aren't available on touch ([Tooltips](https://www.nngroup.com/articles/tooltip-guidelines/)). Front's hover-snooze is a swipe on mobile ([Front 2088](https://help.front.com/en/articles/2088)). Android: actionable elements get hover states ([Tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2)). |
| **Keyboard and ⌘K** | Desktop and iPad-with-keyboard get the same shortcuts: ⌘K, `?`, Esc closes, Enter or ⌘Enter sends, J/K moves through lists. Shortcuts are listed in the palette and in tooltips. | iPad shows app shortcuts when ⌘ is held ([Apple](https://support.apple.com/guide/ipad/ipad271212e1/ipados)). That overlay is fed by native key commands, so a web app can't add to it *(inference)* ([UIKeyCommand](https://developer.apple.com/documentation/uikit/uikeycommand)). The web app's own palette must teach them. Linear: `?` and ⌘K ([Linear](https://linear.app/enablement/guides/navigating-linear)). Superhuman: the palette shows each shortcut ([Superhuman](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)). Apple: don't repurpose standard shortcuts ([Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards)). Android: Esc exits, Enter sends ([Tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2)). |
| **Drag alternatives (WCAG 2.5.7)** | Every drag needs a single-pointer route without dragging: calendar move/resize, villa move, photo reorder, lead stage. Keyboard alone doesn't count, and a swipe doesn't count. Drops are confirmed. | W3C: a "Move to…" menu, up/down controls or a text input are acceptable; keyboard-only is not ([2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [G219](https://www.w3.org/WAI/WCAG22/Techniques/general/G219)). Fresha: Actions → Reschedule then tap a slot ([263](https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments)). Cloudbeds: ⋯ → Move ([55835270255131](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/55835270255131)). Apple Calendar: Edit ([Apple](https://support.apple.com/guide/ipad/create-and-edit-events-in-calendar-ipadafeefacf/ipados)). Little Hotelier: Assign room ([8692509](https://helpcentre.littlehotelier.com/en/articles/8692509-manage-unallocated-reservations-through-your-little-hotelier-mobile-app)). Touch drag starts with a long press in Fresha, Apple Calendar, Little Hotelier and Airbnb ([Airbnb 447](https://www.airbnb.com/help/article/447)). |
| **Swipe on rows** | Optional speed-up for phone lists (chats, cart lines). At most one action per direction, the same actions in ⋯, and Undo for destructive ones. | NN/g: swipe has no signifier, so keep it consistent and make undo visible ([Contextual swipe](https://www.nngroup.com/articles/contextual-swipe/)). Apple: gestures shouldn't be the only way ([Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)). Front, Help Scout and Respond.io use one action per side (section 3.2). Square and Loyverse use swipe-left to delete a cart line ([Square 8238](https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app)). |
| **Long-press** | Long-press = select mode in lists, or a context menu on calendar blocks and photos. There is always a visible "Select" button or ⋯ too. | Front and Help Scout use long-press to multi-select ([Front](https://help.front.com/en/articles/4907072), [Help Scout](https://docs.helpscout.com/article/1601-use-the-mobile-app)). Square uses it for bulk edit ([feature log](https://squareup.com/us/en/feature-log)). Apple: "Always make context menu items available in the main interface, too" ([Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus)). NN/g: long-press isn't discoverable, so use a visible ⋯ ([Contextual menus](https://www.nngroup.com/articles/contextual-menus/), [2025 guidelines](https://www.nngroup.com/articles/contextual-menus-guidelines/)). |
| **Pull to refresh** | Not needed: Convex data is live. Keep the browser's default overscroll on pages, contain it in sheets, and show a "reconnecting" state when live sync drops, not a spinner. | Material: prefer automatic sync, with manual refresh only as a supplement ([Material 1](https://m1.material.io/patterns/swipe-to-refresh.html)). Vercel: keep default overscroll on touch and use `contain` in modals and drawers ([Vercel](https://vercel.com/design/guidelines)). How to disable it: [Chrome overscroll-behavior](https://developer.chrome.com/blog/overscroll-behavior). |
| **On-screen keyboard** | On phone, the composer and focused fields stay visible with the keyboard up. Form commits sit in the top bar, and nothing autofocuses on load. | The keyboard resizes only the visual viewport, so fixed elements can be covered ([Chrome](https://developer.chrome.com/blog/viewport-resize-behavior), [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)). `dvh` ignores the keyboard ([web.dev](https://web.dev/blog/viewport-units)). Sticky bars must not hide focus; use `scroll-padding` ([WCAG 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)). Vercel: rarely autofocus on mobile ([Vercel](https://vercel.com/design/guidelines)). |

---

## 5. Cross-device consistency

| Keep identical on every size | Allowed to change with size |
|---|---|
| Section names and their order (sidebar = rail = Menu list). If a label is too long for a tab, shorten it everywhere ("Spa" in all places, or "Staff bookings" in all places). | Navigation form: tab bar → rail → sidebar |
| Field order in every form and detail view, and the names of fields | Number of panes; whether details are a push, a sheet or a side panel |
| Status names, colours and icons (booking, appointment, payment, chat). The legend is the same. | Density: rows per screen, days and columns visible, zoom presets |
| The primary action's label and amount (e.g. "Charge ฿3,450", "Check in") | Where the primary action sits: top-right header or panel bottom on big screens, top bar or pinned bottom bar on phone |
| What can be done (no capability silently missing on phone) | Which secondary actions are visible vs in ⋯ |
| State: selected record, cart, draft reply and unsaved form survive rotation and resizing | Input extras: swipe and long-press on touch, hover and shortcuts with a pointer or keyboard |
| Empty, loading and error copy | Whether a rare, heavy setup flow suggests a larger screen |

**Evidence**
- Apple: "Keep functionality the same as size classes change… you can change the amount of functionality that's visible". Keep layouts "recognizable and familiar". [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout) Never hide or disable tabs, because it looks unstable. [Apple Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- NN/g: core features, workflows, data and visual design stay consistent across channels, with compromises only to suit a channel. [NN/g Omnichannel consistency](https://www.nngroup.com/articles/omnichannel-consistency/)
- Android list-detail keeps state and selection when the window changes size class. [Android canonical layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts)
- Linear's desktop shortcuts and mobile swipes run the same inbox actions. [Linear inbox](https://linear.app/docs/inbox) · [Linear mobile](https://linear.app/mobile)
- Shopify carts auto-save and can be shared across devices (see the competitor doc, Checkout).
- No source states the rule for field order or status colours specifically. It follows from "same functionality" plus our rubric's colour-plus-label rule *(inference)*.

---

## 6. Responsive anti-patterns to deduct for

Each item names what an auditor sees and the source behind the deduction.

1. **Desktop layout shrunk onto a phone.** A multi-column table squeezed into 390px, 11–12px text, or tiny icon buttons. [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Notion: columns collapse on mobile](https://www.notion.com/help/notion-for-mobile)
2. **The whole page scrolls sideways.** Only a data grid may scroll sideways, and only with a sticky first column, a sticky header and a visible overflow cue. [NN/g Mobile tables](https://www.nngroup.com/articles/mobile-tables/), [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
3. **Hidden navigation on wide screens.** On iPad landscape or desktop, the only route between sections is a hamburger drawer. [NN/g Hamburger menus](https://www.nngroup.com/articles/hamburger-menus/), [Apple Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
4. **iPad portrait treated as a giant phone.** A bottom tab bar on iPad, a centred phone-width column, full-width buttons, text fields or bottom sheets across 800px+. [Android tier 2](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2), [Shopify tablet sidebar](https://changelog.shopify.com/posts/updated-the-shopify-app-s-navigation-experience-on-tablet)
5. **Two cramped panes in compact width.** A list plus detail on a phone or narrow portrait, where previews or messages wrap to a few words. [Apple Split views](https://developer.apple.com/design/human-interface-guidelines/split-views), [Android canonical layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts)
6. **Modal over modal, or sheet over sheet**, e.g. a line-edit sheet opening a discount dialog. [Apple Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [NN/g Bottom sheets](https://www.nngroup.com/articles/bottom-sheet/)
7. **A long form in a small centred dialog on phone.** Multi-step or long edits should be a full-screen page. [Apple Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Material Dialog](https://github.com/material-components/material-components-android/blob/master/docs/components/Dialog.md)
8. **The primary action under the keyboard.** In the keyboard-open screenshot, Send, Save or Charge is hidden or off-screen. [Chrome viewport resize](https://developer.chrome.com/blog/viewport-resize-behavior), [Vercel](https://vercel.com/design/guidelines)
9. **Sticky chrome eating a short viewport.** On a landscape phone, the header, filters, tab bar and footer leave less than half the height for content, or cover the focused field. [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [WCAG 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), [Android compact height](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
10. **An overlay where a side-by-side panel fits.** On iPad landscape or desktop, the detail covers the list, grid or cart. [Android tier 2 trailing panels](https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2), [Cloudbeds panel](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48384262863771), [Shopify POS windowed views](https://changelog.shopify.com/posts/tablet-improvements-for-the-pos-app)
11. **Hover-only controls or information.** Row actions, resize handles, or tooltips holding essential data. [web.dev](https://web.dev/learn/design/interaction), [Apple Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices), [NN/g 2025](https://www.nngroup.com/articles/contextual-menus-guidelines/)
12. **Drag-only actions.** Calendar move or resize, photo reorder or lead stage with no tap route, or drops that commit without confirmation. [WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Fresha 263](https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments)
13. **Gesture-only actions**: swipe-only or long-press-only, or several actions stacked behind one swipe. [NN/g Contextual swipe](https://www.nngroup.com/articles/contextual-swipe/), [WCAG 2.5.1](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)
14. **Inconsistent words, order or colours across sizes.** E.g. "Staff bookings" in the sidebar but "Appointments" on phone, or "Confirmed" purple on iPad and blue on phone. [NN/g Omnichannel](https://www.nngroup.com/articles/omnichannel-consistency/), [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
15. **State lost on rotate or resize.** The cart empties, the selection clears, the reply draft vanishes, or an open panel closes. [Android canonical layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts)
16. **A capability silently missing at a size.** E.g. no way to void or refund on phone, with no message and no route. [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
17. **Pull-to-refresh broken or faked.** Overscroll disabled globally, which also kills swipe-back, or a custom pull-to-refresh on live data. [Vercel](https://vercel.com/design/guidelines), [Material 1](https://m1.material.io/patterns/swipe-to-refresh.html)
18. **Autofocus that opens the phone keyboard on page load**, covering half the screen before the user acts. [Vercel](https://vercel.com/design/guidelines)

---

## 7. Gaps this research surfaced (list, don't score)

- **A phone "Today" screen** that combines hotel arrivals and departures with today's spa appointments. Airbnb makes Today the first host tab ([Airbnb](https://www.airbnb.com/resources/hosting-homes/a/exploring-your-hosting-tools-738)). Until it exists, Hotel and Spa each open on today.
- **Global search** for the phone Search tab and iPad ⌘K. This is already on the feature-gap list.
- **Push notifications with triage actions** (reply, assign, archive) that deep-link to the selected conversation. [Front](https://help.front.com/en/articles/4907072), [Respond.io](https://respond.io/help/mobile-app/messaging-from-your-mobile), [Help Scout](https://apps.apple.com/us/app/help-scout/id966327660)
- **User-customisable phone tabs** (Linear, Square). Defer this until staff ask for it.

---

## 8. Sources

Dates are publication or last-changed dates shown on the page. "Undated" means none was shown. All were accessed 2026-11-04 or 2026-11-05.

### Platform guidelines and standards

| URL | What it shows | Date |
|---|---|---|
| https://developer.apple.com/design/human-interface-guidelines/layout | Size classes, not device; keep functionality the same; tab bar → sidebar in larger spaces | 2026-09-09 |
| https://developer.apple.com/design/human-interface-guidelines/tab-bars | Navigation only; avoid More; ≤5 default; search tab; never hide tabs; iPad tab bar ↔ sidebar | 2026-06-08 |
| https://developer.apple.com/design/human-interface-guidelines/sidebars | Don't hide by default; ≤2 levels; let people hide it; consider a tab bar first | 2026-06-08 |
| https://developer.apple.com/design/human-interface-guidelines/split-views | Regular width only; highlight selection; several ways to reveal hidden panes | 2025-06-09 |
| https://developer.apple.com/design/human-interface-guidelines/sheets | One sheet at a time; full screen for complex flows; iPad form/page sheets; Cancel/Done placement | 2026-03-24 |
| https://developer.apple.com/design/human-interface-guidelines/pointing-devices | Pointer doesn't replace touch; hidden controls via touch-and-hold menu | 2026-10-28 |
| https://developer.apple.com/design/human-interface-guidelines/gestures | Custom gestures must not be the only way | 2026-10-28 |
| https://developer.apple.com/design/human-interface-guidelines/context-menus | Context-menu items must also be in the main UI | 2023-12-05 |
| https://developer.apple.com/design/human-interface-guidelines/keyboards | Don't repurpose standard shortcuts | 2025-06-09 |
| https://developer.apple.com/documentation/uikit/uikeycommand | Native key commands (feed the ⌘-hold overlay) | undated |
| https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes | Compact/medium/expanded/large widths; compact height makes two panes impractical | undated (current) |
| https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts | List-detail, supporting pane, feed; state kept across size changes | undated (current) |
| https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation | Nav bar when compact, rail otherwise | undated (current) |
| https://developer.android.com/docs/quality-guidelines/adaptive-app-quality/tier-2 | Rails expand to panels; trailing panels; no full-width sheets/buttons; Esc, Enter, hover, right-click | undated (archive lists 2026-04-07 prior version) |
| https://github.com/material-components/material-components-android/blob/master/docs/components/SideSheet.md | Standard vs modal side sheets; coplanar not for narrow screens | undated |
| https://github.com/material-components/material-components-android/blob/master/docs/components/Dialog.md | Full-screen dialogs for task series; only ones other dialogs may open over | undated |
| https://m1.material.io/patterns/swipe-to-refresh.html | Prefer sync; manual refresh supplements | undated (archived) |
| https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html | 2.5.7: menu, up/down or text input as drag alternatives; keyboard alone is not enough | 2026-08-10 |
| https://www.w3.org/WAI/WCAG22/Techniques/general/G219 | Single-pointer reorder and move techniques for lists and boards | 2026-08-10 |
| https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html | 2.5.1: path gestures need a single-tap alternative | 2026-08-10 |
| https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html | Sticky bars must not hide focus; scroll-padding | 2026-06-15 |
| https://www.w3.org/WAI/WCAG22/Understanding/reflow.html | Sticky content issues; data tables exempt from reflow | 2026-09-06 |
| https://web.dev/learn/design/interaction | Primary vs any-hover/pointer; don't hide important UI behind hover | undated |
| https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-hover | `any-hover` definition | 2026-04-20 |
| https://css-tricks.com/interaction-media-features-and-their-potential-for-incorrect-assumptions/ | Hybrid input; don't assume touch or mouse | 2020-09-14 |
| https://developer.chrome.com/blog/viewport-resize-behavior | Keyboard resizes the visual viewport; `interactive-widget` | ~2022-10 |
| https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport | VisualViewport API for keyboard-aware layout | 2026-08-12 |
| https://web.dev/blog/viewport-units | svh/lvh/dvh; keyboard doesn't change them | undated |
| https://developer.chrome.com/blog/overscroll-behavior | `overscroll-behavior` to contain or disable pull-to-refresh | undated |
| https://vercel.com/design/guidelines | Hybrid input testing, tooltips last, overscroll, autofocus, sticky bars, gesture alternatives | undated |

### Research

| URL | What it shows | Date |
|---|---|---|
| https://www.nngroup.com/articles/bottom-sheet/ | When to use bottom sheets; no stacking; Close + Back | 2023-06-11 |
| https://www.nngroup.com/articles/hamburger-menus/ | Hidden nav less used and slower; don't hide on desktop | 2016-06-26 |
| https://www.nngroup.com/articles/contextual-swipe/ | Swipe lacks signifiers; consistency and undo | 2017-02-12 |
| https://www.nngroup.com/articles/contextual-menus/ | Long-press not discoverable; use a visible ⋯ | 2019-03-17 |
| https://www.nngroup.com/articles/contextual-menus-guidelines/ | Menu icons visible without hover; primary actions stay visible | 2025-11-28 |
| https://www.nngroup.com/articles/mobile-tables/ | Sticky header, locked first column, overflow cue | 2017-09-17 |
| https://www.nngroup.com/articles/omnichannel-consistency/ | Consistent features, data and visuals across channels | 2016-10-16 |
| https://www.nngroup.com/articles/tooltip-guidelines/ | Tooltips unavailable on touch; essential info on page | 2019-01-27 |

### Products

| URL | What it shows | Date |
|---|---|---|
| https://www.airbnb.com/resources/hosting-homes/a/exploring-your-hosting-tools-738 | Host tabs: Today, Calendar, Listings, Messages, Menu | 2025-12-10 |
| https://www.airbnb.com/resources/hosting-homes/a/introducing-the-listings-tab-638 | Listing editor; photo tour remove/move/add; View | 2023-11-08, updated 2024-05-01 |
| https://www.airbnb.com/resources/hosting-homes/a/upgrades-make-your-calendar-easier-to-manage-on-mobile-585 | Per-listing month and year calendar on mobile | 2023-05-03 |
| https://www.airbnb.com/help/article/447 | Tap and hold, then swipe across dates | undated |
| https://docs.stripe.com/dashboard/mobile | Tabs; "+" top right; bottom action bar; bank linking web-only | undated |
| https://changelog.shopify.com/posts/updated-the-shopify-app-s-navigation-experience-on-tablet | Tablet: tab bar replaced by sidebar | 2024-03-13 |
| https://www.shopify.com/blog/admin-new-look | Search and store picker in a collapsible sidebar | 2026-09-24 |
| https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav | Sidebar on desktop, title-bar dropdown on mobile; 1–2 word nouns | undated |
| https://shopify.dev/docs/api/app-home/polaris-web-components/layout-and-structure/table | Table on wide, list on narrow; list slots per column | undated |
| https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/index-table | No header row in narrow list; bulk bar; test both widths | undated |
| https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/page | One primary + ≤3 secondary in header | undated |
| https://shopify.dev/docs/api/app-home/patterns/templates/settings | Save/discard on unsaved changes; modal for destructive actions | undated |
| https://help.shopify.com/manual/apps/working-with-apps | Phone settings: Menu → Settings → section | undated |
| https://changelog.shopify.com/posts/keep-the-cart-in-view-on-mobile-pos | Persistent cart button with count and total on mobile POS | 2026-09-14 |
| https://changelog.shopify.com/posts/shopify-pos-split-screen-home-layout-for-tablet | Tablet: cart beside search at all times | 2024-07-02 |
| https://changelog.shopify.com/posts/tablet-improvements-for-the-pos-app | Tablet workflows windowed so the cart stays visible | 2024-09-30 |
| https://help.shopify.com/en/manual/sell-in-person/shopify-pos/receipt-management/customer-receipt-selection | Turn device to customer for receipt choice | undated |
| https://help.shopify.com/en/manual/sell-in-person/hardware/customer-view-app | Customer display portrait or landscape on tablets | undated |
| https://help.shopify.com/en/manual/sell-in-person/shopify-pos/faq | POS not available on desktop | undated |
| https://squareup.com/help/us/en/article/5174-swipe-card-payments-with-the-square-reader | Phone or portrait tablet: Review sale → Charge | undated |
| https://squareup.com/help/us/en/article/8499-accept-payments-with-square-handheld | Handheld: Review sale → Charge → Confirm & Pay | undated |
| https://squareup.com/us/en/feature-log | Cart left or right; item details next to the check; long-press bulk edit | 2026-11-02 |
| https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app | Tap item for details; swipe left to delete | undated |
| https://squareup.com/help/gb/en/article/5175-accept-payments-with-square-stand | Swivel stand to customer; edit items in right panel | undated |
| https://squareup.com/help/us/en/article/8442-set-up-calendar-view-filters-for-appointments | App: day/week/list; multiple staff only in Day | undated |
| https://community.squareup.com/t5/Product-Updates/Drag-amp-drop-to-reschedule-appointments-available-on-Square/ba-p/702876 | Drag-to-reschedule in Square apps | 2024-01-10 |
| https://squareup.com/help/us/en/article/7155-scheduling-with-team-management | Shifts created on Dashboard; Team app for viewing | undated |
| https://squareup.com/us/en/the-bottom-line/inside-square/square-pos-redesign | Customisable bottom navigation | 2022-12-06 |
| https://squareup.com/ca/en/release-notes/release-notes-july-30th | "More" → choose applets | 2026-07-30 |
| https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens | Handheld: check stacked, Pay always visible, overflow menu | 2026-09-17 |
| https://support.toasttab.com/en/article/Setting-Up-Your-Toast-Go-2-and-Accepting-Payments | Guest reviews itemised preview on handheld | 2026-09-17 |
| https://support.toasttab.com/en/article/New-POS-Managing-Payments | "No receipt" first; New order | 2026-10-27 |
| https://help.loyverse.com/help/home-sale-screen-layouts | Phone list vs tablet 3-column grid | undated |
| https://help.loyverse.com/help/make-sales | Charge bottom right; swipe-left delete; New sale | undated |
| https://help.loyverse.com/help/how-customer-display-works | Second-device ticket, paid and change | undated |
| https://www.fresha.com/help-center/knowledge-base/calendar/16-manage-your-calendar-display-settings- | Mobile views; team selector at bottom; zoom | undated |
| https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments | Tap-and-hold drag + confirm; Actions → Reschedule | undated |
| https://www.fresha.com/help-center/knowledge-base/calendar/252-schedule-and-update-team-shifts | Mobile shifts per team member; Edit this day | undated |
| https://www.fresha.com/help-center/knowledge-base/sales/518-apply-deals-and-discounts-at-checkout | Line item tap → pop-up; desktop actions at bottom of right panel | undated |
| https://www.fresha.com/help-center/knowledge-base/payments/100637-collect-payments-using-tap-to-pay-1 | Phone: Continue to payment at bottom | undated |
| https://www.notion.com/help/notion-calendar-apps | Mobile limited to 1–3 day views | undated |
| https://apps.apple.com/us/app/notion-calendar/id1607562761 | v2.0: iPad support; month, full-week, schedule views | ~2026-11-03 |
| https://www.notion.com/help/manage-your-calendars-and-events | "+" bottom right on mobile; right context panel on desktop | undated |
| https://www.notion.com/help/notion-for-mobile | Columns collapse to one; security settings not on mobile | undated |
| https://support.apple.com/guide/ipad/create-and-edit-events-in-calendar-ipadafeefacf/ipados | Touch-and-hold drag; tap Edit alternative | iPadOS 27 guide |
| https://support.apple.com/guide/ipad/ipad99a3ef9e/ipados | Mail iPad: hide list; touch-and-hold preview | iPadOS 27 guide |
| https://support.apple.com/guide/ipad/ipad271212e1/ipados | Hold ⌘ to see shortcuts | iPadOS 27 guide |
| https://helpcentre.littlehotelier.com/en/articles/8673688-navigate-your-little-hotelier-mobile-app | Swipe dates and room types on phone | 2026-07-13 |
| https://helpcentre.littlehotelier.com/en/articles/8692509-manage-unallocated-reservations-through-your-little-hotelier-mobile-app | 6-day range; Assign room (tap only) | 2026-08-27 |
| https://help-platform.littlehotelier.com/en/articles/10390499 | Tap-and-hold to create; drag to move; pencil to edit | 2025-10-21 |
| https://myfrontdesk.cloudbeds.com/hc/en-us/articles/41078613036187 | App calendar; reservation details screen; block drawer | 2025-09-15, updated 2026-10-27 |
| https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48379953897883 | Days to Show; browser zoom doesn't add columns | 2026-03-27 |
| https://myfrontdesk.cloudbeds.com/hc/en-us/articles/55835270255131 | Drag with confirm; ⋯ → Move | 2026-09-14 |
| https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48384262863771 | Panel beside calendar; state-dependent primary action | 2026-03-27 |
| https://myfrontdesk.cloudbeds.com/hc/en-us/articles/28236594445083 | App: Edit reservation → Dates | 2024-08-13 |
| https://help.mews.com/s/article/Configuring-the-Timeline-view | Density presets; mobile filters | undated |
| https://docs.helpscout.com/article/1601-use-the-mobile-app | Phone list → conversation; dock; long-press bulk; swipe down refresh | 2026-10-06 |
| https://apps.apple.com/us/app/help-scout/id966327660 | Swipe right to assign; configurable swipes; iPad selection kept (release notes) | 2025-11 to 2026-10 |
| https://help.front.com/en/articles/4907072 | Half-screen quick reply; configurable swipes; long-press multi-select; AI compose | undated |
| https://help.front.com/en/articles/2088 | Hover quick action to snooze (desktop) | undated |
| https://www.intercom.com/help/en/articles/447-respond-to-users-and-visitors-on-the-go-with-the-intercom-conversations-app | Mobile lacks Fin Copilot, AI translations, attachments | undated (current) |
| https://respond.io/help/mobile-app/messaging-from-your-mobile | Swipe left close, right snooze; AI Assist; contact details via name | 2026-09-01 |
| https://support.zendesk.com/hc/en-us/articles/4408825697434 | Agent app: Conversations and Details tabs | undated |
| https://linear.app/changelog/2025-10-16-mobile-app-redesign | Bottom toolbar; Create Issue at top of every screen | 2025-10-16 |
| https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile | User-arranged mobile navigation | 2026-01-22 |
| https://linear.app/mobile | Swipe to delete or snooze in inbox | undated |
| https://linear.app/docs/inbox | Desktop inbox shortcuts | undated |
| https://linear.app/enablement/guides/navigating-linear | ⌘K, `?` shortcut list | undated |
| https://vercel.com/changelog/dashboard-navigation-redesign-rollout | Resizable, hideable sidebar; mobile floating bar | 2026-02-26 |
| https://attio.com/help/reference/tools-and-extensions/attio-on-mobile | Records as on desktop; tabbed record; "+" to create | undated |
| https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ | Palette shows each command's shortcut | 2021-10-12 |
| https://help.guesty.com/hc/en-gb/articles/9931630384413 | Mobile property index as tiles *(snippet)* | undated |
