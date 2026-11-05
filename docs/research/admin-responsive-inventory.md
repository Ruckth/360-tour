| Screen | Phone 360–430 | iPad portrait 768–834 | iPad landscape 1024–1194 | Desktop 1280–1920 | Top risk / evidence ID |
|---|---|---|---|---|---|
| Root layout / mobile metadata | Unknown | Unknown | Unknown | Good | Emitted viewport and standalone behavior unverified [R1] |
| Shared admin shell | Usable | Usable | Usable | Good | 40px navigation targets; no safe-area padding [S1–S2] |
| Chats | Usable | Usable | Usable | Good | Small actions; full-height composer / keyboard interaction [C1–C3] |
| Hotel bookings | Usable | Usable | Usable | Good | Dense month grid and hover resize handles [H1–H3] |
| Staff / Calendar | Usable | Usable | Usable | Good | Resource scrolling, tiny resize handles and references [SC1–SC4] |
| Staff / Roster | Usable | Usable | Usable | Good | 896px grid with no narrow alternative [RO1] |
| Staff / Staff | Usable | Usable | Usable | Good | 36px row actions; cramped break editor [ST1–ST2] |
| Staff / Services | Usable | Usable | Usable | Good | Assignment matrix scrolls and uses 16px checkboxes [SV1] |
| Checkout | Usable | Usable | Usable | Good | 14px text inputs despite strong touch layout [CO1] |
| Receipt / [orderId] | Usable | Usable | Usable | Good | Correction inputs and unbounded void dialog [RE1–RE2] |
| Questions / Business facts | Usable | Usable | Usable | Good | 16px selection boxes; wide table at lg [Q1–Q2] |
| Properties | Usable | Usable | Usable | Good | 14px creation inputs; unbounded centered dialog [P1] |
| Properties / [id] | Usable | Usable | Usable | Good | Panorama-anchored form can clip; narrow editor fields [PE1–PE3] |
| Leads | Usable | Usable | Usable | Good | 640px table with no cards [L1] |
| Settings / Business | Usable | Usable | Usable | Good | 14px fields and textarea [SB1] |
| Settings / AI assistant | Usable | Usable | Usable | Good | 14px fields and textarea [SA1] |
| Settings / Email | Usable | Usable | Usable | Good | 14px fields and textarea [SE1] |
| Settings / Channels | Usable | Good | Good | Good | Long missing-variable strings lack wrapping protection [CH1] |
| Settings / Admins | Usable | Good | Good | Good | Long email addresses lack wrapping protection [AD1] |

# Admin responsive inventory

Static inspection dated 2026-11-04. Only this report was written. No app server, package manager, build, tests, browser session, network fetch, or Convex command was run. Backend implementation was not changed or audited. Sources are the checked-in route/component/CSS files; line numbers refer to that snapshot.

Grades are **rough source-based readiness**, not device test results. **Good** means the inspected layout has a suitable structure with no obvious blocking issue for that class; **Usable** means core actions have a visible path but scrolling, small controls, or other documented risks remain; **Broken** would require a demonstrable blocked core flow; **Unknown** means static evidence cannot establish the behavior. No entire screen is conclusively Broken from source alone. Keyboard occlusion, browser chrome, real data lengths, enlarged text, focus/portal placement, and WebGL gesture behavior remain **Unknown** until tested. A Good desktop grade does not certify every dialog or interaction.

Summary evidence IDs resolve to the file:line citations in the sections below. All content screens inherit the shared shell and shared primitive risks, even where their grade primarily reflects their own content. Read-only Channels/Admins receive Good tablet grades for their content; the shared shell still has the touch limitations in S1.

## Breakpoint and route map

- `src/components/admin/admin-routes.ts:25` defines the five settings tabs; `src/components/admin/admin-routes.ts:39` defines ADMIN_NAV; `src/components/admin/admin-routes.ts:7` defines the four staff tabs. The property editor and receipt are additional detail routes. `/admin` and invalid sections redirect through `adminRedirectPath` (`src/components/admin/admin-routes.ts:89`). There is no separate dashboard page in this route tree.
- `src/app.css:1` imports Tailwind 4; its `@theme inline` block (`src/app.css:87`) contains no breakpoint overrides. Viewport utilities therefore use the default scale: sm 40rem / 640px, md 48rem / 768px, lg 64rem / 1024px, xl 80rem / 1280px, 2xl 96rem / 1536px, assuming the usual 16px initial size. Component variant names such as `size="sm"` and object keys `sm:` inside CVA configuration are not viewport breakpoints.
- Navigation is deliberately independent: custom **1400px**, in JS and CSS (`src/components/ui/sidebar.tsx:35`, `src/components/ui/sidebar.tsx:78`, `src/components/ui/sidebar.tsx:251`). `useIsMobile` defaults to 768px but the sidebar passes 1400 (`src/hooks/use-mobile.tsx:3`, `src/hooks/use-mobile.tsx:9`). Do not infer sidebar behavior from lg or xl.
- Chats use JS `(min-width: 1024px)` (`src/components/admin/ChatsView.tsx:184`) alongside lg CSS. Checkout uses JS `(min-width: 64rem)` (`src/components/checkout/CheckoutView.tsx:87`) alongside lg CSS. No other screen-specific width `matchMedia` or `useMediaQuery` branch was found in the scoped admin/checkout/UI sources.
- Container queries occur in checkout and the event calendar, described below. `pointer-coarse`, `hover:none`, reduced-motion and short-height queries are distinct from width breakpoints. No orientation-specific admin layout rule was found.

## Root layout, viewport, theme and PWA

**Files:** `src/app/layout.tsx`, `src/app/providers.tsx`, `src/app.css`, `src/lib/theme.ts`, `src/components/global/SiteShell.tsx`.

**Actual behavior and breakpoints:** No root width breakpoint or admin-specific viewport export. Metadata declares icons/Open Graph/Twitter (`src/app/layout.tsx:31`); the head inserts the theme script (`src/app/layout.tsx:82`). Theme reads stored light/dark preference and falls back to `prefers-color-scheme: dark` (`src/lib/theme.ts:9`); CSS defines matching light/dark variables (`src/app.css:10`, `src/app.css:49`). This media preference does not change pane geometry. Admin is returned before public header/footer/chat launcher code (`src/components/global/SiteShell.tsx:130`). Thus those public fixed launchers do not overlap admin.

**Devices:** Phone and both iPads share this root; no per-device metadata or standalone treatment. Desktop gets the same theme and admin wrapper. No manifest/manifest route/webmanifest, service-worker registration, explicit `appleWebApp`, `apple-mobile-web-app-*`, `viewport-fit`, or `themeColor` declaration was found in the inspected app/public/config sources. Icon metadata is present; icons alone do not establish PWA behavior.

**Risks / unknowns:**

- **R1 — Unknown emitted viewport / standalone behavior.** Root has no explicit `viewport`/`generateViewport` export; metadata and head contain no viewport-fit or Apple web-app settings (`src/app/layout.tsx:26`, `src/app/layout.tsx:81`). This is **not evidence that Next emits no viewport meta**: generated HTML was not inspected. Whether device-width/initial-scale defaults are emitted, and how safe-area values behave in Safari/installed mode, is Unknown. PWA installability is unverified, not an established layout failure.
- **R2 — Remaining 100vh minimum.** Admin's outer SiteShell still uses `min-h-screen` (`src/components/global/SiteShell.tsx:131`), as do admin setup (`src/app/admin/layout.tsx:8`) and auth/loading states (`src/components/admin/AdminShell.tsx:24`, `src/components/admin/AdminShell.tsx:32`, `src/components/admin/AdminShell.tsx:50`). This can create excess document height with mobile browser chrome even when the inner chat/checkout frame uses dvh; these are minimum heights, not evidence of a clipped fixed-height screen.

**Readiness:** Phone **Unknown**, portrait **Unknown**, landscape **Unknown**: generated viewport, safe-area and standalone behavior unobserved. Desktop **Good**: normal root/theme structure, no root width constraint.

## Shared shell: sidebar, header, page frame and fallback states

**Files:** `src/app/admin/layout.tsx`, `src/components/admin/AdminShell.tsx`, `src/components/admin/AdminSidebar.tsx`, `src/components/ui/sidebar.tsx`, `src/hooks/use-mobile.tsx`, `src/app/admin/error.tsx`.

**Actual breakpoints:** Below 1400px the sidebar is an 18rem left Sheet, capped by Sheet's `100vw - 2rem` max-width (`src/components/ui/sidebar.tsx:31`, `src/components/ui/sidebar.tsx:209`, `src/components/ui/sheet.tsx:45`). At ≥1400px an inset persistent sidebar uses 16rem, collapsible to a 3rem icon width plus inset spacing (`src/components/ui/sidebar.tsx:30`, `src/components/ui/sidebar.tsx:263`). Inset margins/rounding also begin at 1400 (`src/components/ui/sidebar.tsx:359`). Header padding grows at sm (`src/components/admin/AdminShell.tsx:113`); sidebar search becomes text-sm at sm (`src/components/admin/AdminSidebar.tsx:104`). Chats/checkout get `h-dvh min-h-0 overflow-hidden`; other routes get a scrolling `min-h-screen` frame (`src/components/admin/AdminShell.tsx:95`, `src/components/admin/AdminShell.tsx:109`). Header is a normal-flow 64px shrink-0 element, not sticky.

**Devices:** Phone, portrait iPad and landscape iPad use the drawer and header trigger, no persistent navigation or bottom navigation bar. The drawer closes when following a link (`src/components/admin/AdminSidebar.tsx:53`). Desktop 1280–1399 still uses the drawer; ≥1400 uses persistent navigation. Checkout/receipt start with the desktop sidebar collapsed; other pages start expanded (`src/components/admin/AdminShell.tsx:101`). Search/subpage labels hide in icon mode, with tooltips on section icons. Drawer autofocus intentionally avoids opening the phone keyboard (`src/components/ui/sidebar.tsx:222`). Auth setup and error screens use centered max-width cards, not split panes.

**Risks:**

- **S1 — Touch targets below 44px.** Header trigger is 40×40 below 1400 and 28×28 above it (`src/components/ui/sidebar.tsx:307`); drawer section/subpage rows are 40px high and expansion buttons 40×40 (`src/components/admin/AdminSidebar.tsx:149`, `src/components/admin/AdminSidebar.tsx:158`, `src/components/admin/AdminSidebar.tsx:170`). These have accessible names, but undershoot the requested touch size. Collapsed desktop icons are 32px (`src/components/ui/sidebar.tsx:548`). This also matters for wide touch devices.
- **S2 — Edge padding missing.** Fixed/edge-aligned sidebar Sheet and its account footer have no safe-area insets (`src/components/ui/sheet.tsx:45`, `src/components/admin/AdminSidebar.tsx:195`); header likewise has ordinary px/height only (`src/components/admin/AdminShell.tsx:113`). Potential home-indicator/cutout collision depends on browser/standalone mode; actual overlap is Unknown.
- **S3 — Icon-rail discoverability / tiny text.** Visual section labels hide in collapsed mode (`src/components/ui/sidebar.tsx:548`), with tooltips shown only for collapsed non-mobile state (`src/components/ui/sidebar.tsx:613`). Search shortcut text is 10px (`src/components/admin/AdminSidebar.tsx:119`). Text remains in the DOM, so this is not a missing accessible-name claim.
- **S4 — Shared long-confirmation height.** Shell's ConfirmProvider uses centered DialogContent with no height cap/scroll (`src/components/admin/ConfirmDialog.tsx:60`); long descriptions can exceed a short visible viewport. Error fallback has a retry path but ordinary 40px button (`src/app/admin/error.tsx:16`, `src/components/ui/button.tsx:23`).

**Readiness:** Phone **Usable**: drawer works structurally, undersized controls/edge spacing remain. Portrait **Usable** and landscape **Usable**: same drawer/touch limits. Desktop **Good**: drawer at 1280 then persistent/collapsible navigation at 1400.

## Chats — /admin/chats

**Files:** `src/app/admin/chats/page.tsx`; `src/components/admin/ChatsView.tsx`, `AdminSessionDetail.tsx`, `AdminSessionActions.tsx`, `BusinessFactFormDialog.tsx`; `src/components/ui/chat/chat-input.tsx`.

**Actual breakpoints:** sm increases outer/detail/composer padding and shows the visitor avatar; detail dialog becomes inset, rounded and max-w-3xl (`src/components/admin/ChatsView.tsx:913`, `src/components/admin/AdminSessionDetail.tsx:315`). lg / JS 1024 creates `20rem + minmax(0,1fr)` list/transcript panes (`src/components/admin/ChatsView.tsx:586`, `src/components/admin/ChatsView.tsx:897`). Below lg, selected chat opens a Dialog with Back; below sm it fills dvh. Contact/details remains a right Sheet at every size, w-26rem capped by the Sheet default (`src/components/admin/AdminSessionDetail.tsx:580`). ChatInput changes from 16px to 14px at md (`src/components/ui/chat/chat-input.tsx:20`). `@media(hover:none)` explicitly reveals settle/save-fact actions (`src/components/admin/ChatsView.tsx:848`, `src/components/admin/AdminSessionDetail.tsx:476`). No xl/2xl layout branch.

**Devices:** Phone: full list → full-screen conversation drill-in → optional contact Sheet; no simultaneous panes. Portrait iPad: list → inset tall conversation Dialog, not split. Landscape: list plus transcript, details in Sheet. Desktop: same split with persistent nav only ≥1400. Transcript/list independently scroll; filter popover is width-capped (`src/components/admin/ChatsView.tsx:648`). Queue tabs may horizontally scroll; not a bottom navigation bar.

**Risks:**

- **C1 — Small actions / filter controls.** Shortcuts and settle buttons are 32px (`src/components/admin/ChatsView.tsx:598`, `src/components/admin/ChatsView.tsx:848`); Back/contact buttons are 36px (`src/components/admin/AdminSessionDetail.tsx:306`, `src/components/admin/AdminSessionDetail.tsx:340`), and conversation action menu button is 36px (`src/components/admin/AdminSessionActions.tsx:90`). Filter badge removal is only a 12px glyph plus 2px padding per side (`src/components/ui/badge.tsx:54`).
- **C2 — Input sizing.** Search uses the 14px shared Input (`src/components/admin/ChatsView.tsx:626`, `src/components/ui/input.tsx:10`), creating an iOS focus-zoom risk. Reply input is 16px on phone, but 14px on iPad from md (`src/components/ui/chat/chat-input.tsx:20`).
- **C3 — Composer under keyboard / safe-area.** Full-height detail Dialog plus scroll-contained transcript and composer have no admin visualViewport adjustment or bottom safe-area padding (`src/components/admin/ChatsView.tsx:913`, `src/components/admin/AdminSessionDetail.tsx:402`, `src/components/admin/AdminSessionDetail.tsx:518`). Keyboard visibility and short-height transcript space are Unknown. Public chat's keyboard handling is not wired into this admin component.
- **C4 — Hover audit qualification.** Settle and save-fact links hide at rest on hover-capable devices, but include keyboard-focus and `hover:none` fallbacks (`src/components/admin/ChatsView.tsx:848`, `src/components/admin/AdminSessionDetail.tsx:476`). They should not be reported as strictly hover-only on phones; hybrid input discoverability remains a risk.

**Readiness:** Phone **Usable**: deliberate drill-in, small actions/keyboard risk. Portrait **Usable**: inset drill-in and 14px reply text. Landscape **Usable**: split layout fits by construction, touch controls remain small. Desktop **Good**: split panes and keyboard paths.

## Hotel bookings — /admin/hotel

**Files:** `src/app/admin/hotel/page.tsx`; `src/components/admin/AdminBookingsView.tsx`, `AdminCalendarHeader.tsx`, `BookingQuickActions.tsx`, `BookingSheet.tsx`, `NewBookingDialog.tsx`, `DateBlockDialog.tsx`, `IcalSourcesDialog.tsx`, `OtaRatesDialog.tsx`, `BookingCleanupDialog.tsx`; `src/components/reui/event-calendar/*`.

**Actual breakpoints:** sm increases page padding, gives guest search 16rem/villa picker 12rem, aligns actions, and makes calendar view buttons auto-width (`src/components/admin/AdminBookingsView.tsx:254`, `src/components/admin/AdminBookingsView.tsx:526`, `src/components/admin/AdminCalendarHeader.tsx:54`). At md the page becomes `calc(100dvh - 4rem)` with **36rem minimum**; below md calendar itself is 36rem high (`src/components/admin/AdminBookingsView.tsx:182`, `src/components/admin/AdminBookingsView.tsx:247`). Month header container ≤36rem shortens day labels (`src/components/reui/event-calendar/event-calendar-month-view.tsx:220`, `src/components/reui/event-calendar/event-calendar-month-view.tsx:252`); chips at ≤10rem clip/mask title text (`src/components/reui/event-calendar/event-calendar-event.tsx:83`). No auto switch to agenda on small width. Shared BookingMoneyFields changes to amount + 8.5rem secondary field at sm (`src/components/admin/BookingMoneyFields.tsx:39`). BookingSheet is right-side, w-full with inherited `100vw - 2rem` cap, max-w-md at sm (`src/components/admin/BookingSheet.tsx:80`). Creation/management forms remain centered scrollable Dialogs, not mobile bottom Sheets (`src/components/admin/NewBookingDialog.tsx:154`).

The imported stay-date picker also stacks check-in/out below sm, then uses two columns; its popover is capped to `100vw - 2rem` (`src/components/booking/BookingDatePicker.tsx:95`, `src/components/booking/BookingDatePicker.tsx:215`). It uses one calendar rather than adding a second calendar on tablet.

**Devices:** Every device has selectable month/Villas(resource)/agenda views; default is month (`src/components/admin/AdminBookingsView.tsx:64`, `src/components/admin/AdminBookingsView.tsx:123`). Phone has wrapped toolbar and document scroll around an internally scrolling calendar. Portrait/landscape use bounded calendar space; resource columns can scroll horizontally. Tap booking opens quick popover, then Details opens Sheet; direct edit is available in Sheet. Desktop retains the same views and workflows, with more room. No hidden essential booking controls are specifically replaced by mobile navigation.

**Risks:**

- **H1 — Dense month / resource scrolling.** Month stays seven columns (`src/components/reui/event-calendar/event-calendar-month-view.tsx:161`), with event bars about 26px high (`src/components/reui/event-calendar/event-calendar-month-view.tsx:562`). Phone titles can truncate heavily; resource view requires ≥8rem per villa (`src/components/reui/event-calendar/event-calendar-resource-view.tsx:210`) and uses horizontal scrolling (`src/components/reui/event-calendar/event-calendar-content.tsx:67`). These are calendar-internal constraints, not proven document overflow.
- **H2 — Hover resize / tiny controls.** Resize edges reveal only on group-hover and are 6px tall or 8px wide (`src/components/reui/event-calendar/event-calendar-event.tsx:387`, `src/components/reui/event-calendar/event-calendar-event.tsx:413`); toolbar prev/next are 36px (`src/components/admin/AdminCalendarHeader.tsx:39`). Touch resize discovery is poor. **Not drag-only:** New booking is a button (`src/components/admin/AdminBookingsView.tsx:283`), and booking Sheet exposes Edit (`src/components/admin/BookingSheet.tsx:332`) with date/property fields. Drag-select/move/resize are shortcuts, not the sole booking-edit path.
- **H3 — Short-height pressure.** From md, 36rem minimum plus 64px shell header and wrapped toolbars may exceed the visible height (`src/components/admin/AdminBookingsView.tsx:182`, `src/components/admin/AdminCalendarHeader.tsx:21`). Below md, 36rem calendar does not shrink when toolbar wraps (`src/components/admin/AdminBookingsView.tsx:247`). Remaining visible grid height is Unknown without rendering.
- **H4 — Popover bounds / forms.** Booking quick popover is fixed 320px without explicit viewport max-width/max-height (`src/components/admin/BookingQuickActions.tsx:80`); guest search results have 288px minimum (`src/components/admin/AdminBookingsView.tsx:540`). Both can exceed their local toolbar space; collision/short-height behavior is Unknown. New booking/notes inherit 14px inputs (`src/components/admin/NewBookingDialog.tsx:154`, `src/components/ui/input.tsx:10`, `src/components/ui/textarea.tsx:10`); entity-picker group headings are 11px (`src/components/ui/entity-picker.tsx:156`). Sheet safe-area/close risks also apply.

**Readiness:** Phone **Usable**: agenda/edit alternatives exist, default calendar is dense. Portrait **Usable**: resource scrolling and touch resize limits. Landscape **Usable**: same limits plus short-height risk. Desktop **Good**: pointer editing and multiple views, long-content popovers still need verification.

## Staff / Calendar — /admin/staff/calendar

**Files:** `src/app/admin/staff/layout.tsx`, `src/app/admin/staff/[tab]/page.tsx`; `src/components/admin/AdminStaffBookingsView.tsx`, `AdminCalendarHeader.tsx`, `AppointmentSheet.tsx`, `NewAppointmentDialog.tsx`, `RescheduleDialog.tsx`, `TurnaroundDialog.tsx`, `BreakEditDialog.tsx`, `AdminStaffTimeOff.tsx`; event-calendar primitives.

**Actual breakpoints:** Staff tab strip scrolls horizontally at all widths (`src/components/admin/AdminStaffBookingsView.tsx:130`). sm changes padding/header alignment, shows legend hint, and changes appointment slot grids **4 → 6 columns** (`src/components/admin/NewAppointmentDialog.tsx:247`, `src/components/admin/AdminStaffBookingsView.tsx:595`). sm also splits appointment fields and correction forms into two/three columns (`src/components/admin/NewAppointmentDialog.tsx:201`, `src/components/admin/RescheduleDialog.tsx:104`, `src/components/admin/BreakEditDialog.tsx:88`). md makes calendar page viewport-height with **40rem minimum**, replacing the below-md 36rem calendar (`src/components/admin/AdminStaffBookingsView.tsx:127`, `src/components/admin/AdminStaffBookingsView.tsx:504`). lg shows booked-in-view count (`src/components/admin/AdminStaffBookingsView.tsx:507`). Same calendar container queries as Hotel for chips (and month primitive if used elsewhere); staff only exposes resource/week/agenda (`src/components/admin/AdminStaffBookingsView.tsx:431`). No xl/2xl change.

**Devices:** Phone and portrait have drawer navigation, horizontal staff tabs, default staff-resource calendar with sideways scroll when staff do not fit; agenda is manually selectable. Landscape has the same calendar structure with more resource columns and visible booked count, not a separate mobile-to-desktop pane change. Desktop uses the same calendar. Tap appointment opens right Sheet at every size; sm caps it to md width (`src/components/admin/AppointmentSheet.tsx:148`). New appointment is a centered Dialog capped at 90dvh with scrolling content (`src/components/admin/NewAppointmentDialog.tsx:181`).

**Risks:**

- **SC1 — Resource/week density.** Resource columns have 128px minimum each and horizontal overflow (`src/components/reui/event-calendar/event-calendar-resource-view.tsx:210`, `src/components/reui/event-calendar/event-calendar-content.tsx:67`). Overlapping timed events can have 24px minimum chip height (`src/components/reui/event-calendar/event-calendar-time-grid.tsx:1156`). No automatic phone agenda fallback (`src/components/admin/AdminStaffBookingsView.tsx:175`).
- **SC2 — Resize is hover-discovered, not the only edit path.** Shared tiny hover-only edge grips (`src/components/reui/event-calendar/event-calendar-event.tsx:387`, `src/components/reui/event-calendar/event-calendar-event.tsx:400`). Tap appointment/turnaround/break has handlers (`src/components/admin/AdminStaffBookingsView.tsx:446`); Sheet provides reschedule/Turnaround buttons (`src/components/admin/AppointmentSheet.tsx:234`, `src/components/admin/AppointmentSheet.tsx:240`). Thus no confirmed drag-only appointment operation. Calendar gestures have a 250ms touch delay / 5px tolerance (`src/components/reui/event-calendar/event-calendar-dnd.tsx:29`); gesture success vs scroll is Unknown.
- **SC3 — Minimum height.** 640px page minimum + 64px shell header, plus tab strip and wrapping controls, puts pressure on landscape/keyboard-reduced heights (`src/components/admin/AdminStaffBookingsView.tsx:127`, `src/components/admin/AdminStaffBookingsView.tsx:130`).
- **SC4 — Small text and targets.** Confirmation references use 10px (`src/components/admin/AdminStaffBookingsView.tsx:339`, `src/components/admin/AdminStaffBookingsView.tsx:353`). Calendar nav is 36px (`src/components/admin/AdminCalendarHeader.tsx:39`); new slot choices use `Button size="sm"` (`src/components/admin/NewAppointmentDialog.tsx:281`, `src/components/ui/button.tsx:24`). Text inputs inherit 14px (`src/components/admin/AppointmentCorrectionDialog.tsx:61`, `src/components/ui/input.tsx:10`). Right Sheet has shared close/safe-area issues.

**Readiness:** Phone **Usable**: tap/agenda alternatives, dense default. Portrait **Usable**: resource scrolling and small controls. Landscape **Usable**: height pressure plus touch limits. Desktop **Good**: calendar/edit workflows fit the pointer model.

## Staff / Roster — /admin/staff/roster

**Files:** staff route/layout above; `src/components/admin/StaffRosterView.tsx`, `RecordHistoryPanel.tsx`; shared time/date controls.

**Actual breakpoints:** sm aligns toolbar to end; lg reveals selection instructions (`src/components/admin/StaffRosterView.tsx:373`, `src/components/admin/StaffRosterView.tsx:640`). No responsive grid replacement, container query or screen-specific JS media branch. Staff tabs retain horizontal overflow. Custom/copy/conflict workflows use centered Dialogs on every device (`src/components/admin/StaffRosterView.tsx:746`, `src/components/admin/StaffRosterView.tsx:847`, `src/components/admin/StaffRosterView.tsx:948`).

**Devices:** Phone: one 7-day table scrolled sideways, not per-person/day cards; toolbars wrap but the date-navigation subgroup does not. Portrait: table still wider than viewport (minimum 896px vs ≤786px available after page padding). Landscape: table generally fits the drawer-free content width; long data still unverified. Desktop: full weekly matrix. Tap/pointer-down selects a cell, row/day buttons select whole groups, keyboard arrows/range selection exist; drag painting is optional (`src/components/admin/StaffRosterView.tsx:205`, `src/components/admin/StaffRosterView.tsx:235`, `src/components/admin/StaffRosterView.tsx:484`).

**Risks:**

- **RO1 — Table without mobile alternative.** `overflow-x-auto` wraps `min-w-[56rem]` table; first column is 208px (`src/components/admin/StaffRosterView.tsx:465`, `src/components/admin/StaffRosterView.tsx:472`, `src/components/admin/StaffRosterView.tsx:476`). Phone and portrait cannot see name + full week simultaneously; first column is not sticky. This is intentional inner scroll, not proof the document overflows.
- **RO2 — Navigation/gesture usability.** Week nav subgroup is nonwrapping (`src/components/admin/StaffRosterView.tsx:352`), previous/next are 36px (`src/components/admin/StaffRosterView.tsx:353`). Selection starts immediately on pointer-down with preventDefault (`src/components/admin/StaffRosterView.tsx:205`); whether touch scrolling accidentally paints/selects is Unknown. It is not drag-only.
- **RO3 — Cramped and unbounded dialogs.** Custom dialog lacks max-height/overflow (`src/components/admin/StaffRosterView.tsx:746`); break fields remain three columns even on phone (`src/components/admin/StaffRosterView.tsx:758`), with each TimePicker itself containing two selects (`src/components/ui/time-picker.tsx:57`). Copy/conflict dialogs also lack whole-dialog height bounds (`src/components/admin/StaffRosterView.tsx:847`, `src/components/admin/StaffRosterView.tsx:948`). Text field uses shared 14px Input (`src/components/admin/StaffRosterView.tsx:763`, `src/components/ui/input.tsx:10`).

**Readiness:** Phone **Usable**: tap editing exists but extensive sideways navigation. Portrait **Usable**: 896px minimum still scrolls. Landscape **Usable**: table fits more often, touch/modal limits remain. Desktop **Good**: matrix and keyboard selection are appropriate.

## Staff / Staff — /admin/staff/staff

**Files:** staff route/layout; `src/components/admin/AdminStaffServicesManager.tsx` (`section="staff"`), `AdminStaffTimeOff.tsx`, `PhotoPickerButton.tsx`, `StaffAvatarPhoto.tsx`.

**Actual breakpoints:** Staff list itself has no pane breakpoint: same flex rows with truncation. sm splits bulk-time-off dates/people and service-photo viewer padding; staff/time-off dialogs use sm max-width caps (`src/components/admin/AdminStaffTimeOff.tsx:77`, `src/components/admin/AdminStaffTimeOff.tsx:234`, `src/components/admin/AdminStaffServicesManager.tsx:464`, `src/components/admin/ServicePhoto.tsx:62`). No md/lg/xl/2xl list adaptation or JS width branch.

**Devices:** All sizes: wrapping header + list; tapping Edit opens centered 90dvh scrollable staff Dialog. Phone has less visible name/role/hours because avatar + two action buttons remain on the row. iPads show the same row and dialog, not split detail panes. Desktop gives more text space. Time-off entry is a Dialog, not bottom Sheet; photo upload/preview is also a Dialog. No drag is required to edit staff/time off.

**Risks:**

- **ST1 — Row target/text compression.** Edit/archive buttons are 36px (`src/components/admin/AdminStaffServicesManager.tsx:344`, `src/components/admin/AdminStaffServicesManager.tsx:353`); role/hours subtitle is single-line truncate without a visible expansion on the list (`src/components/admin/AdminStaffServicesManager.tsx:342`). Dialog offers detail, so truncation is not confirmed data loss.
- **ST2 — Break editor stays cramped.** Shift fields remain two columns and daily break three columns at phone sizes (`src/components/admin/AdminStaffServicesManager.tsx:531`, `src/components/admin/AdminStaffServicesManager.tsx:544`); nested two-select TimePicker compounds width pressure (`src/components/ui/time-picker.tsx:57`). Runtime overflow is Unknown. Name/role/break-label fields inherit 14px (`src/components/admin/AdminStaffServicesManager.tsx:546`, `src/components/ui/input.tsx:10`).
- **ST3 — Disabled reason only via tooltip.** Add-time-off availability explanation uses DisabledReason (`src/components/admin/AdminStaffServicesManager.tsx:220`), whose focusable wrapper has no click/tap disclosure handler (`src/components/admin/DisabledReason.tsx:13`). Keyboard focus works structurally; a dependable touch explanation is Unknown. Photo-dialog close is 40px (`src/components/admin/ServicePhoto.tsx:66`).

**Readiness:** Phone **Usable**: editing path exists, cramped form/targets. Portrait **Usable**, landscape **Usable**: list fits, touch limitations remain. Desktop **Good**: compact list and scrollable forms.

## Staff / Services — /admin/staff/services

**Files:** staff route/layout; `src/components/admin/AdminStaffServicesManager.tsx` (`section="services"`), `AdminServiceStaffMatrix.tsx`, `ServicePhoto.tsx`, `PhotoPickerButton.tsx`.

**Actual breakpoints:** List/matrix switch is manual, not responsive (`src/components/admin/AdminStaffServicesManager.tsx:190`). sm makes eligible-staff selection two columns and caps service Dialog width (`src/components/admin/AdminStaffServicesManager.tsx:661`, `src/components/admin/AdminStaffServicesManager.tsx:716`). No device-specific matrix replacement, JS width branch, md/lg/xl/2xl change beyond inherited shell/tabs.

**Devices:** Phone/portrait/landscape all default to service list; Edit opens centered scrollable Dialog. “Who does what” displays a horizontal matrix with sticky service-name column and one 64px-wide staff-header button per person (`src/components/admin/AdminServiceStaffMatrix.tsx:110`, `src/components/admin/AdminServiceStaffMatrix.tsx:123`). Desktop is the same structure with more visible columns. No split detail pane or bottom Sheet; assignment is tap-checkbox/row/column, not drag-only.

**Risks:**

- **SV1 — Matrix has no narrow alternative / tiny boxes.** Overflow-x table, 64px staff headers, service-name button up to 224px, sticky first column and 16×16 assignment checkbox (`src/components/admin/AdminServiceStaffMatrix.tsx:110`, `src/components/admin/AdminServiceStaffMatrix.tsx:123`, `src/components/admin/AdminServiceStaffMatrix.tsx:138`, `src/components/admin/AdminServiceStaffMatrix.tsx:143`, `src/components/admin/AdminServiceStaffMatrix.tsx:155`). Many staff force sideways scroll at any width; the sticky column can dominate phone space. Checkbox has aria-label but no expanded clickable cell handler.
- **SV2 — List targets / form density.** Same 36px Edit/archive and truncated subtitle (`src/components/admin/AdminStaffServicesManager.tsx:342`, `src/components/admin/AdminStaffServicesManager.tsx:344`, `src/components/admin/AdminStaffServicesManager.tsx:353`). Duration/turnaround/price stay three columns at every width (`src/components/admin/AdminStaffServicesManager.tsx:703`) and inherit 14px Input (`src/components/ui/input.tsx:10`).
- **SV3 — Explanations and photo close.** Add-service disabled prerequisite is tooltip-only (`src/components/admin/AdminStaffServicesManager.tsx:227`, `src/components/admin/DisabledReason.tsx:13`); service-photo close is 40px (`src/components/admin/ServicePhoto.tsx:66`).

**Readiness:** Phone **Usable**: list works, matrix requires precision/scroll. Portrait **Usable**, landscape **Usable**: more columns fit but same small assignment targets. Desktop **Good**: list/matrix suit available width.

## Checkout — /admin/checkout

**Files:** `src/app/admin/checkout/page.tsx`; `src/components/checkout/CheckoutView.tsx`, `CatalogPane.tsx`, `OrderStrip.tsx`, `OrderPanel.tsx`, `PayPanel.tsx`, `CustomerDetails.tsx`, `CheckoutLayers.tsx`, `checkout-ui.ts`; `src/components/admin/CustomerDisplayDialog.tsx`.

**Actual breakpoints:** sm grows padding, shows Filters/New order labels, and changes some button text sizes. lg shows an inset **380px** order pane; xl widens it to **440px**; 2xl to **480px** (`src/components/checkout/CheckoutView.tsx:138`). Below lg, a fixed bottom order pill opens a **94dvh bottom Sheet**; rotation across lg closes it via matchMedia (`src/components/checkout/CheckoutView.tsx:87`, `src/components/checkout/CheckoutView.tsx:150`, `src/components/checkout/CheckoutView.tsx:160`). These order widths are not applied on phone.

Catalog is an `@container`: header becomes horizontal at `@3xl` (48rem/768px of container, not viewport); item columns become 2 at **34rem**, 3 at **53rem**, 4 at **84rem** (`src/components/checkout/CatalogPane.tsx:123`, `src/components/checkout/CatalogPane.tsx:124`, `src/components/checkout/CatalogPane.tsx:221`). The custom-item form adds heading top padding at container ≤14rem to clear its close button (`src/components/checkout/CatalogPane.tsx:326`). Split-tender rows change field width around container **17rem** (`src/components/checkout/PayPanel.tsx:405`, `src/components/checkout/PayPanel.tsx:415`, `src/components/checkout/PayPanel.tsx:432`). Money uses cqi-based sizing (`src/components/checkout/OrderPanel.tsx:209`, `src/components/checkout/PayPanel.tsx:172`). At viewport height ≤32rem/512px, order header spacing shrinks and tender area switches to five columns including Split (`src/components/checkout/OrderPanel.tsx:124`, `src/components/checkout/OrderPanel.tsx:220`). `pointer-coarse` raises descendant buttons/input heights and button widths to 44px; portaled checkout layers repeat this rule (`src/components/checkout/checkout-ui.ts:19`, `src/components/checkout/CheckoutLayers.tsx:15`).

**Devices:** Phone: catalog, wrap/scroll tabs, one item column, bottom pill → order/payment Sheet; filters stay right Sheet. Portrait: catalog generally two columns by container width, same bottom order Sheet. Landscape: catalog plus 380px pane; catalog columns depend on remaining container space, often two. Desktop: order pane grows at xl/2xl; catalog continues to adapt by actual width. Orders/customer/display flows use bounded centered Dialogs, not phone Sheets (`src/components/checkout/OrderStrip.tsx:145`, `src/components/admin/CustomerDisplayDialog.tsx:83`). No drag-only checkout action found. Catalog info button opens a tap Popover with aria-label (`src/components/checkout/CatalogPane.tsx:279`).

**Risks:**

- **CO1 — Input font remains 14px.** Catalog search/filter price and order discount/time/customer fields inherit Input text-sm (`src/components/checkout/CatalogPane.tsx:142`, `src/components/checkout/CatalogPane.tsx:180`, `src/components/checkout/OrderPanel.tsx:424`, `src/components/ui/input.tsx:10`). Coarse-pointer rules change target size, not font size (`src/components/checkout/checkout-ui.ts:19`), so iOS focus zoom remains a risk. Textareas inherit 14px too (`src/components/checkout/OrderPanel.tsx:476`, `src/components/ui/textarea.tsx:10`).
- **CO2 — Text below 12px.** Filter/count badges use 11px (`src/components/checkout/CatalogPane.tsx:151`, `src/components/checkout/CatalogPane.tsx:257`); saved-order state uses 11px (`src/components/checkout/OrderStrip.tsx:586`).
- **CO3 — Short-height / keyboard space.** Root scroll plus catalog scroll plus order scroll are nested (`src/components/checkout/CheckoutView.tsx:125`, `src/components/checkout/CatalogPane.tsx:188`, `src/components/checkout/OrderPanel.tsx:123`). The ≤512px five-column tender rule can crowd long labels on a narrow phone (`src/components/checkout/OrderPanel.tsx:220`). Actual keyboard focus visibility and browser scroll chaining are Unknown; no checkout visualViewport handler was found.
- **CO4 — Some surfaces lack height policy.** Clear-order confirmation is a centered Dialog with no height cap (`src/components/checkout/OrderPanel.tsx:151`); filter right Sheet has no explicit overflow-y-auto (`src/components/checkout/CatalogPane.tsx:154`). Many filter groups on a short device could extend beyond it.
- **CO5 — Do not misclassify compact checkout icons.** Quantity buttons declare size-8 (`src/components/checkout/OrderPanel.tsx:328`), but coarse-pointer root rules increase them to ≥44×44 (`src/components/checkout/CheckoutView.tsx:125`, `src/components/checkout/checkout-ui.ts:19`). They remain compact with a fine primary pointer, including possible hybrid configurations; effective device pointer classification is Unknown. This protection does not reach the separate shell header trigger.

**Existing safe-area protection:** Bottom pill uses `env(safe-area-inset-bottom)` (`src/components/checkout/CheckoutView.tsx:150`), catalog reserves bottom padding (`src/components/checkout/CatalogPane.tsx:188`), order footer adds bottom inset below lg (`src/components/checkout/OrderPanel.tsx:199`). Missing inset is not an accurate blanket finding for checkout. Actual reported inset still depends on root/browser behavior (R1).

**Readiness:** Phone **Usable**: deliberate bottom-sheet/touch layout, input/keyboard risks. Portrait **Usable**: useful two-column catalog, same remaining risks. Landscape **Usable**: split layout and touch expansion, short-height details unknown. Desktop **Good**: pane and container adaptation are explicit.

## Receipt — /admin/receipt/[orderId]

**Files:** `src/app/admin/receipt/[orderId]/page.tsx`; `src/components/checkout/ReceiptView.tsx`, `PaymentRecord.tsx`, `FinancialHistory.tsx`, `OrderHistory.tsx`, `HistoryDetails.tsx`.

**Actual breakpoints:** Receipt itself has no width breakpoint: w-full/min-w-0/max-w-sm article, wrapping toolbar, max-w-md correction/history sections (`src/components/checkout/ReceiptView.tsx:124`, `src/components/checkout/ReceiptView.tsx:127`, `src/components/checkout/ReceiptView.tsx:143`). Coarse-pointer rules apply. Shared DialogFooter changes at sm. Print media removes admin chrome and uses 58mm/80mm paper (`src/components/checkout/ReceiptView.tsx:29`, `src/components/checkout/ReceiptView.tsx:40`); this is not a fixed-width on-screen thermal preview. No md/lg/xl/2xl screen-pane change.

**Devices:** All sizes get stacked toolbar → receipt → payment recording → history → sale/void actions. Phone toolbar wraps; content scrolls with the document. iPads and desktop center the same narrow receipt. Void is a centered Dialog on every device. Corrections expand inline in PaymentRecord, not another split pane. Sharing has native-share then clipboard fallback (`src/components/checkout/ReceiptView.tsx:100`).

**Risks:**

- **RE1 — Correction/void form text.** Void reason is shared 14px Textarea (`src/components/checkout/ReceiptView.tsx:244`, `src/components/ui/textarea.tsx:10`); PaymentRecord imports shared Input/Textarea (`src/components/checkout/PaymentRecord.tsx:6`). Coarse target sizing does not change font size (`src/components/checkout/checkout-ui.ts:19`).
- **RE2 — Void dialog can exceed short heights.** Max-w-md only; no max-height/scroll for potentially long explanation + reason + footer (`src/components/checkout/ReceiptView.tsx:234`).
- **RE3 — Long totals/reference data unverified.** Receipt article allows arbitrary wrapping, but line money remains shrink-0 and totals use parallel flex rows (`src/components/checkout/ReceiptView.tsx:143`, `src/components/checkout/ReceiptView.tsx:163`, `src/components/checkout/ReceiptView.tsx:179`). Extreme monetary strings/large text may compress labels; actual failure is Unknown. Main screen text is 13px/12px; 10px/11.5px print font is intentionally print-only (`src/components/checkout/ReceiptView.tsx:30`), not a sub-12px phone UI finding.

**Readiness:** Phone **Usable**: fluid receipt and wrapped actions, corrections/modal risks. Portrait **Usable**, landscape **Usable**: narrow content is suitable, touch form limits remain. Desktop **Good**: stacked receipt and print controls.

## Questions / Business facts — /admin/questions

**Files:** `src/app/admin/questions/page.tsx`; `src/components/admin/BusinessFactsView.tsx`, `BusinessFactsPanel.tsx`, `MissingInformationPanel.tsx`, `LegacyArchivePanel.tsx`, `BusinessFactFormDialog.tsx`, `admin-bulk.tsx`, `SegmentedTabs.tsx`.

**Actual breakpoints:** sm grows page padding and aligns Add; fact dialog changes title/status to `1fr + 12rem` and other fields to two columns (`src/components/admin/BusinessFactsView.tsx:41`, `src/components/admin/BusinessFactsPanel.tsx:119`, `src/components/admin/BusinessFactFormDialog.tsx:171`, `src/components/admin/BusinessFactFormDialog.tsx:228`). **lg** changes all STACKED_TABLE tables from block/card rows with data-label headings to table/table-header groups (`src/components/admin/admin-bulk.tsx:172`); horizontal table scroll is only enabled at lg (`src/components/admin/BusinessFactsPanel.tsx:130`, `src/components/admin/MissingInformationPanel.tsx:288`, `src/components/admin/LegacyArchivePanel.tsx:61`). No md/xl/2xl or JS media branch.

**Devices:** Phone and portrait: horizontally scrollable Business facts/Missing information/Legacy archive tabs and vertically stacked labeled record cards. Missing selection/action bar stays sticky top-0 while selected. Landscape/desktop: full tables; wide contents can scroll inside table wrapper. Fact editor is a centered 90dvh scrollable Dialog on every device (`src/components/admin/BusinessFactFormDialog.tsx:86`); no mobile Sheet conversion. Legacy archive is read-only; no drag workflow found.

**Risks:**

- **Q1 — Tiny selection / notice controls.** Missing-information selection uses 16px checkboxes (`src/components/admin/MissingInformationPanel.tsx:316`, `src/components/admin/admin-bulk.tsx:53`); undo notice dismiss is 28×28 (`src/components/admin/admin-bulk.tsx:139`). Tabs have no 44px minimum (`src/components/admin/SegmentedTabs.tsx:81`).
- **Q2 — Landscape table density.** Missing-information resolve cell gets ≥280px, and inline selector ≥180px, at lg (`src/components/admin/MissingInformationPanel.tsx:362`, `src/components/admin/MissingInformationPanel.tsx:371`), alongside five other columns. Landscape iPad can require horizontal scrolling right when card alternative disappears. This is an inner scroll area, not a missing mobile alternative for the whole screen.
- **Q3 — Form/search font / sticky bar.** Search and fact inputs use 14px shared Input (`src/components/admin/admin-bulk.tsx:217`, `src/components/admin/BusinessFactFormDialog.tsx:174`, `src/components/ui/input.tsx:10`); shared Textarea also 14px (`src/components/ui/textarea.tsx:10`). Bulk bar is sticky top-0 and wraps without a height limit (`src/components/admin/admin-bulk.tsx:78`); it can consume a large part of a short viewport. Occlusion amount is Unknown.
- **Q4 — Channel identity is visually tooltip-dependent.** Missing-report channel icon has title and sr-only source label, but no always-visible text or tap disclosure (`src/components/admin/MissingInformationPanel.tsx:335`). Accessible name is present; sighted touch discovery is limited.

**Readiness:** Phone **Usable**: cards preserve headings, input/selection risks. Portrait **Usable**: same cards and controls. Landscape **Usable**: wider tables may scroll. Desktop **Good**: full tables, bounded editor.

## Properties — /admin/properties

**Files:** `src/app/admin/properties/page.tsx`; `src/components/admin/AdminPropertiesView.tsx`, `property-form.tsx`.

**Actual breakpoints:** sm changes px-4 to px-6 and caps New villa Dialog at max-w-md (`src/components/admin/AdminPropertiesView.tsx:32`, `src/components/admin/AdminPropertiesView.tsx:133`). No md/lg/xl/2xl/container/JS media branch. Same max-w-5xl list at every size.

**Devices:** All sizes have wrapping status/new-villa toolbar, full-row property links with image/title/subtitle, and drill-in route to editor. No data table, split pane or drag requirement. New villa stays centered Dialog; phone does not turn it into a Sheet. Portrait/landscape provide wider rows; desktop width is capped.

**Risks:**

- **P1 — Creation form on phone.** Name/web-address fields inherit 14px (`src/components/admin/AdminPropertiesView.tsx:140`, `src/components/admin/AdminPropertiesView.tsx:143`, `src/components/ui/input.tsx:10`); centered dialog has no max-height/scroll (`src/components/admin/AdminPropertiesView.tsx:133`), including autofocus when opening (`src/components/admin/AdminPropertiesView.tsx:140`). Keyboard/short-height access is Unknown.
- **P2 — Dense toolbar/subtitle.** Status trigger is 36px high (`src/components/admin/AdminPropertiesView.tsx:39`); subtitle price/guest/bedroom/slug is single-line truncated (`src/components/admin/AdminPropertiesView.tsx:83`). Full row is clickable, so it has a detail path; the list itself does not expand this metadata.

**Readiness:** Phone **Usable**: fluid list/drill-in, creation form risks. Portrait **Usable**, landscape **Usable**: list fits, touch controls remain small. Desktop **Good**: list fits max width.

## Property editor — /admin/properties/[id]

**Files:** `src/app/admin/properties/[id]/page.tsx`; `src/components/admin/AdminPropertyEditor.tsx`, `property-form.tsx`, `PropertyPhotosEditor.tsx`, `PropertyRoomsEditor.tsx`, `RoomHotspotList.tsx`, `HotspotEditorDialog.tsx`, `PropertyReviewsEditor.tsx`, `IcalSourcesDialog.tsx`, `OtaRatesDialog.tsx`.

**Actual breakpoints:** sm adds page/section padding; details numeric fields change **2 → 3 columns** (`src/components/admin/AdminPropertyEditor.tsx:289`); photos **1 → 2** at sm and **3** at lg (`src/components/admin/PropertyPhotosEditor.tsx:87`). Room-row form changes to two flexible fields + auto Save at sm (`src/components/admin/PropertyRoomsEditor.tsx:126`); Add room fields become two columns at sm (`src/components/admin/PropertyRoomsEditor.tsx:234`). Exact-hotspot editor changes to two flexible fields + three 5rem coordinate fields + action at sm (`src/components/admin/RoomHotspotList.tsx:61`). Review form becomes three columns at sm (`src/components/admin/PropertyReviewsEditor.tsx:188`). Review/iCal/OTA Dialogs remain centered and capped at 90dvh; sm sets their max widths (`src/components/admin/PropertyReviewsEditor.tsx:108`, `src/components/admin/IcalSourcesDialog.tsx:42`, `src/components/admin/OtaRatesDialog.tsx:33`). No md/xl/2xl or editor-specific JS media branch.

**Devices:** Phone: scrollable Details/Photos/360 rooms/OTA rates/Reviews/Calendar sync tabs, stacked section cards, two-column numeric details, one-column photos. Portrait: three-column numeric fields/two-column photos; wider room forms. Landscape: three-column photos; same editor. Desktop: same max-w-5xl content, not a split inspector. Panorama editor is a 90dvh Dialog containing Canvas and an in-scene form on all devices (`src/components/admin/HotspotEditorDialog.tsx:132`). Reordering photos/rooms has explicit up/down buttons (`src/components/admin/PropertyPhotosEditor.tsx:98`, `src/components/admin/PropertyRoomsEditor.tsx:159`). Exact hotspot positions are editable under Advanced (`src/components/admin/PropertyRoomsEditor.tsx:169`), so marker drag is not the sole positioning option.

**Risks:**

- **PE1 — Panorama form can clip.** Hotspot form is fixed **256px**, translated left by half its width and anchored to a projected 3D point, inside an overflow-hidden Dialog/canvas region (`src/components/admin/HotspotEditorDialog.tsx:132`, `src/components/admin/HotspotEditorDialog.tsx:173`, `src/components/admin/HotspotEditorDialog.tsx:305`). Near an edge, there is no explicit viewport collision adjustment. Visibility is **Unknown** on every device, highest concern on phone; this is not simply a width > viewport issue. Canvas is touch-none (`src/components/admin/HotspotEditorDialog.tsx:157`), so normal scrolling over it is deliberately disabled.
- **PE2 — Narrow room form / coordinate grid.** 160px thumbnail sits beside a flex-1 form with no base-width stacking rule (`src/components/admin/PropertyRoomsEditor.tsx:124`, `src/components/admin/PropertyRoomsEditor.tsx:126`); `min-w-0` can let that form become very narrow on phone. Exact-position sm grid reserves **240px** for coordinates plus other fields (`src/components/admin/RoomHotspotList.tsx:61`). It is not applied below sm; tablet fit with long labels remains Unknown.
- **PE3 — Many undersized actions.** Photo reorder/remove is 36px (`src/components/admin/PropertyPhotosEditor.tsx:98`); room reorder/delete 36px (`src/components/admin/PropertyRoomsEditor.tsx:159`); review edit/delete 36px (`src/components/admin/PropertyReviewsEditor.tsx:89`); external-page link is just a 12px glyph with no padding (`src/components/admin/AdminPropertyEditor.tsx:179`). These have names but no 44px touch expansion.
- **PE4 — Form zoom and truncation.** Details Input/Textarea retain 14px (`src/components/admin/AdminPropertyEditor.tsx:281`, `src/components/admin/AdminPropertyEditor.tsx:287`, `src/components/ui/input.tsx:10`, `src/components/ui/textarea.tsx:10`). Property section tabs horizontally scroll and lack a 44px minimum (`src/components/admin/AdminPropertyEditor.tsx:71`, `src/components/admin/AdminPropertyEditor.tsx:87`). Photo filename is truncated with title as the full visible-pointer hint (`src/components/admin/PropertyPhotosEditor.tsx:95`), limiting sighted touch inspection.

**Readiness:** Phone **Usable**: normal editors/reorder paths exist, panorama subflow **Unknown**. Portrait **Usable**, landscape **Usable**: more room but same targets/in-scene-form risk. Desktop **Good**: normal editor layout fits; panorama edge placement still Unknown.

## Leads — /admin/leads

**Files:** `src/app/admin/leads/page.tsx`; `src/components/admin/AdminLeadsView.tsx`, `DisabledReason.tsx`.

**Actual breakpoints:** sm page padding only (`src/components/admin/AdminLeadsView.tsx:98`); table does not change at md/lg/xl/2xl and has no container query or JS media branch. Same inline/wrapping toolbar and paginated table on all devices. Deletion uses shell ConfirmProvider.

**Devices:** Phone: source filter and Export wrap, table scrolls horizontally. Portrait: 640px minimum fits nominal available width, but long emails/property names can widen intrinsic columns. Landscape/desktop: same full table; no stacked/card alternative or detail pane. Email is a mailto link, delete is icon action, no drag requirement.

**Risks:**

- **L1 — Table-only small-screen UI.** Table min-width is **640px**, with overflow-x wrapper (`src/components/admin/AdminLeadsView.tsx:169`). Phone must pan across email/source/villa/created/actions; no mobile card view. Email cell has no explicit word breaking (`src/components/admin/AdminLeadsView.tsx:185`), so long values can widen it further.
- **L2 — Small touch / tooltip explanation.** Source selector is 36px high (`src/components/admin/AdminLeadsView.tsx:105`); Delete uses default 40×40 icon size (`src/components/admin/AdminLeadsView.tsx:201`, `src/components/ui/button.tsx:28`). Export disabled reason is tooltip-only (`src/components/admin/AdminLeadsView.tsx:117`, `src/components/admin/DisabledReason.tsx:13`). Delete confirmation inherits unbounded centered-dialog height (S4).

**Readiness:** Phone **Usable**: all actions reachable by sideways scrolling, no compact view. Portrait **Usable**, landscape **Usable**: nominal table fit, long data and touch actions still risks. Desktop **Good**: conventional table fits typical width.

## Settings shared frame

**Files:** `src/app/admin/settings/page.tsx`; `src/components/admin/AdminSettingsView.tsx`, `SetupChecklist.tsx`, `SegmentedTabs.tsx`, `RecordHistoryPanel.tsx`.

All five URL tabs use max-w-4xl and sm padding; section tabs horizontally scroll (`src/components/admin/AdminSettingsView.tsx:53`, `src/components/admin/SegmentedTabs.tsx:66`). A collapsible setup checklist appears above every tab. It has 28px Copy/test/reminder actions (`src/components/admin/SetupChecklist.tsx:151`, `src/components/admin/SetupChecklist.tsx:175`, `src/components/admin/SetupChecklist.tsx:269`); these shared touch risks apply to all five tabs. Tab controls have no 44px minimum (`src/components/admin/SegmentedTabs.tsx:81`). No bottom action bar: saves and histories stay in document flow. No tab-specific dialog/sheet conversion or drag interaction was found.

## Settings / Business — /admin/settings (or ?tab=business)

**Files:** settings frame above; `src/components/admin/AdminSettingsView.tsx` SECTIONS.business + SettingsForm; `src/components/ui/time-picker.tsx`.

**Actual breakpoints:** sm changes fields from one to two columns; LINE URL/address/policy span both (`src/components/admin/AdminSettingsView.tsx:254`, `src/components/admin/AdminSettingsView.tsx:274`). No md/lg/xl/2xl/container/JS width change. TimePicker always has two hour/minute selects; no mobile wheel replacement.

**Devices:** Phone: single-column business/contact/policy form, inline save, history below, scrolling tabs/checklist. Portrait/landscape/desktop: two-column form except full-width fields. Same shell navigation by device; no split panes, hidden fields or Sheets.

**Risks:**

- **SB1 — iOS focus zoom.** Business inputs and cancellation-policy textarea inherit text-sm/14px (`src/components/admin/AdminSettingsView.tsx:280`, `src/components/admin/AdminSettingsView.tsx:295`, `src/components/ui/input.tsx:10`, `src/components/ui/textarea.tsx:10`).
- **SB2 — Small time/save controls.** Hour/minute triggers are 40px; Clear uses size-sm / 36px (`src/components/ui/time-picker.tsx:72`, `src/components/ui/time-picker.tsx:94`, `src/components/ui/time-picker.tsx:110`). Save uses default 40px (`src/components/admin/AdminSettingsView.tsx:324`, `src/components/ui/button.tsx:23`); setup actions/tab risks also apply.

**Readiness:** Phone **Usable**: form stacks, input zoom/targets remain. Portrait **Usable**, landscape **Usable**: two-column form fits, touch limits remain. Desktop **Good**: bounded form and in-flow save.

## Settings / AI assistant — /admin/settings?tab=ai

**Files:** `src/components/admin/AdminSettingsView.tsx` SECTIONS.ai + SettingsForm, settings frame/kit above.

**Actual breakpoints:** sm changes tone/max-words to two columns and Extra instructions to span two (`src/components/admin/AdminSettingsView.tsx:145`, `src/components/admin/AdminSettingsView.tsx:153`, `src/components/admin/AdminSettingsView.tsx:254`). No md/lg/xl/2xl/container or JS width adaptation.

**Devices:** Phone: tone, max words, instructions stacked. Both iPads/desktop: first fields side-by-side, textarea full width; save/history in flow. No hidden fields/panes/Sheet.

**Risks:**

- **SA1 — 14px editable fields.** Common Input/Textarea render without a phone font override (`src/components/admin/AdminSettingsView.tsx:280`, `src/components/admin/AdminSettingsView.tsx:295`, `src/components/ui/input.tsx:10`, `src/components/ui/textarea.tsx:10`).
- **SA2 — Shared small actions.** Save is 40px (`src/components/admin/AdminSettingsView.tsx:324`, `src/components/ui/button.tsx:23`), plus 28px setup actions (`src/components/admin/SetupChecklist.tsx:151`) and short tabs (`src/components/admin/SegmentedTabs.tsx:81`).

**Readiness:** Phone **Usable**: stack is suitable, form font/targets need work. Portrait **Usable**, landscape **Usable**: form fits, touch sizes remain. Desktop **Good**: short two-column form.

## Settings / Email — /admin/settings?tab=email

**Files:** `src/components/admin/AdminSettingsView.tsx` SECTIONS.email + SettingsForm, settings frame/kit above.

**Actual breakpoints:** sm changes sender/notification-email to two columns and footer textarea spans two (`src/components/admin/AdminSettingsView.tsx:165`, `src/components/admin/AdminSettingsView.tsx:179`, `src/components/admin/AdminSettingsView.tsx:254`). No other width/container/JS media branch.

**Devices:** Phone fields stack; portrait/landscape/desktop use two-column form. Save/status/history remain below, no fixed bar, split pane, hidden field or Sheet.

**Risks:**

- **SE1 — Input/textarea font.** Sender, owner notification and footer inherit 14px common field styles (`src/components/admin/AdminSettingsView.tsx:280`, `src/components/admin/AdminSettingsView.tsx:295`, `src/components/ui/input.tsx:10`, `src/components/ui/textarea.tsx:10`).
- **SE2 — Touch controls.** Shared Save 40px, setup actions 28px, tabs no 44px minimum (`src/components/admin/AdminSettingsView.tsx:324`, `src/components/ui/button.tsx:23`, `src/components/admin/SetupChecklist.tsx:175`, `src/components/admin/SegmentedTabs.tsx:81`).

**Readiness:** Phone **Usable**, portrait **Usable**, landscape **Usable**: suitable stacking/columns but shared form/control issues. Desktop **Good**: simple form fits.

## Settings / Channels — /admin/settings?tab=channels

**Files:** `src/components/admin/AdminSettingsView.tsx` ChannelsPanel + Stat, shared settings frame.

**Actual breakpoints:** Channel stats **2 → 4 columns at sm** (`src/components/admin/AdminSettingsView.tsx:386`); backend service list **1 → 2 columns at sm** (`src/components/admin/AdminSettingsView.tsx:413`). No md/lg/xl/2xl/container/JS width branch.

**Devices:** Phone stacks channel cards, backend list and iCal list, with two stats per row. Both iPads and desktop use four stats per row and two backend columns. Backend names truncate; latest error text breaks words. Entire content is read-only except config-check retry and shared checklist actions; no table, split pane, dialog or Sheet in ChannelsPanel.

**Risks:**

- **CH1 — Long diagnostic strings.** Missing env names are joined into a paragraph without break-words/overflow-wrap (`src/components/admin/AdminSettingsView.tsx:384`); a long unbroken variable name may exceed the ~260px inner phone card. Backend env code truncates with no title/tap expansion (`src/components/admin/AdminSettingsView.tsx:416`). Error messages elsewhere do have break-words (`src/components/admin/AdminSettingsView.tsx:397`), so this is a localized risk, not all diagnostic content.
- **CH2 — Shared navigation/checklist targets.** 28px setup actions and unconstrained tab heights remain above the cards (`src/components/admin/SetupChecklist.tsx:151`, `src/components/admin/SegmentedTabs.tsx:81`).

**Readiness:** Phone **Usable**: cards adapt, diagnostic string pressure. Portrait **Good**, landscape **Good**, desktop **Good**: read-only cards fit typical strings; long-value behavior still untested and shared shell limitations remain.

## Settings / Admins — /admin/settings?tab=admins

**Files:** `src/components/admin/AdminSettingsView.tsx` AdminsPanel, shared settings frame.

**Actual breakpoints:** Only shared sm page padding; list itself has no responsive columns, width media branch, dialog or Sheet (`src/components/admin/AdminSettingsView.tsx:455`).

**Devices:** All devices show a single vertical read-only email list and management note. Phone tabs can scroll. iPad/desktop simply have more width; no hidden rows, split pane or editable admin form.

**Risks:**

- **AD1 — Unbroken email overflow.** Email `<li>` has text-sm but no min-w-0/break-all/overflow-wrap or truncation (`src/components/admin/AdminSettingsView.tsx:464`); long allowlisted email can overflow a phone panel. Data lengths are Unknown.
- **AD2 — Shared touch targets.** Checklist 28px actions and tabs without 44px height remain (`src/components/admin/SetupChecklist.tsx:151`, `src/components/admin/SegmentedTabs.tsx:81`); there is no AdminsPanel editable-input zoom issue to report.

**Readiness:** Phone **Usable**: simple list, long-email risk. Portrait **Good**, landscape **Good**, desktop **Good**: read-only list has ample nominal room, with shared shell caveats.

## Shared primitives: fixes with the broadest reach

These are improvement opportunities, not changes made by this audit. Source evidence distinguishes current behavior from a proposed policy.

| Primitive / files | Current behavior and risk evidence | Fix-once opportunity / affected screens |
|---|---|---|
| Input / Textarea (`src/components/ui/input.tsx`, `textarea.tsx`) | Both default to text-sm/14px (`src/components/ui/input.tsx:10`, `src/components/ui/textarea.tsx:10`), even on phone. | Use a 16px phone text-entry baseline, with compact text only where appropriate. Reaches search, booking/appointment/staff/property/settings/checkout/receipt correction forms. Checkout touch target rules currently do not fix font size. |
| Button (`src/components/ui/button.tsx`) | Default/icon 40px, sm 36px; many callers override to 28–36px (`src/components/ui/button.tsx:23`). | Establish a coarse-pointer 44×44 policy including explicit caller overrides. Reaches nearly all admin screens; checkout already supplies a local model via `src/components/checkout/checkout-ui.ts:19`. |
| Dialog (`src/components/ui/dialog.tsx`) | Centered at all widths, width capped but no default height cap/scroll; close is 16px icon + p-2 = ~32px (`src/components/ui/dialog.tsx:41`, `src/components/ui/dialog.tsx:48`). sm only changes heading/footer alignment (`src/components/ui/dialog.tsx:62`, `src/components/ui/dialog.tsx:69`). | Add a consistent short-height/keyboard-aware scroll policy and touch-size close; consider a responsive full-screen/bottom-Sheet form presentation below md. Reaches creation, confirmations, settings history actions, roster, property, financial dialogs. This conversion does not currently exist; chat/checkout implement special cases. |
| Sheet (`src/components/ui/sheet.tsx`) | Default side panel 320px with `max-width:100vw-2rem`; no default scrolling or safe-area padding; close ~32px (`src/components/ui/sheet.tsx:43`, `src/components/ui/sheet.tsx:44`, `src/components/ui/sheet.tsx:54`). Bottom side has no default height policy (`src/components/ui/sheet.tsx:47`). | Centralize safe-area, scroll and close sizing while keeping caller width choices. Reaches shell, chat contact, booking/appointment details, checkout filters/order. Checkout order footer already handles bottom inset separately. |
| Sidebar / shell (`src/components/ui/sidebar.tsx`, `AdminSidebar.tsx`, `AdminShell.tsx`) | Custom 1400px drawer threshold, 40px drawer rows/trigger, no inset padding (`src/components/ui/sidebar.tsx:35`, `src/components/ui/sidebar.tsx:307`, `src/components/admin/AdminSidebar.tsx:149`, `src/components/admin/AdminSidebar.tsx:195`). | Keep the breakpoint map explicit; make drawer/header actions touch-size and protect device edges. Benefits every route. Do not accidentally move iPads to desktop navigation by changing generic lg styles. |
| Responsive table vocabulary (`src/components/admin/admin-bulk.tsx`) | STACKED_TABLE already supports labeled cards below lg (`src/components/admin/admin-bulk.tsx:172`). There is **no generic Table/DataTable file in src/components/ui**. Leads, roster and service matrix use their own tables (`src/components/admin/AdminLeadsView.tsx:169`, `src/components/admin/StaffRosterView.tsx:465`, `src/components/admin/AdminServiceStaffMatrix.tsx:110`). | Reuse/adapt the card pattern for Leads; choose a dedicated day/person drill-in for roster and touch assignment list for matrix. Generic table wrapping alone cannot solve those operational grids. Consider content-width rather than viewport-only switching for wide knowledge tables. |
| Date/calendar/time/entity pickers (`src/components/ui/calendar.tsx`, `date-picker.tsx`, `date-time-picker.tsx`, `time-picker.tsx`, `entity-picker.tsx`) | Day/nav buttons are 32–36px (`src/components/ui/calendar.tsx:34`, `src/components/ui/calendar.tsx:44`, `src/components/ui/calendar.tsx:94`); time controls 40px (`src/components/ui/time-picker.tsx:72`); entity compact trigger 36px and headings 11px (`src/components/ui/entity-picker.tsx:120`, `src/components/ui/entity-picker.tsx:156`). Date popover is viewport-width capped (`src/components/ui/date-picker.tsx:105`), entity list is available-height capped (`src/components/ui/entity-picker.tsx:177`). DateTimePicker stacks below sm then uses fixed 11rem time column (`src/components/ui/date-time-picker.tsx:26`). | Preserve existing width/height protections; enlarge touch controls and reduce nested multi-column time layouts. Reaches hotel, staff, roster, knowledge scoping, settings business, property dates. Entity search already uses 16px below sm (`src/components/ui/entity-picker.tsx:172`). Select triggers are buttons, so their 14px text alone is not a text-input zoom claim. |
| Popover / Select / Combobox (`src/components/ui/popover.tsx`, `select.tsx`, `combobox.tsx`) | Popover default fixed 288px with no global viewport width/height cap (`src/components/ui/popover.tsx:23`); Select menu has fixed max-h-96 and trigger min-width, no explicit viewport max-width (`src/components/ui/select.tsx:68`, `src/components/ui/select.tsx:81`). Options are compact (`src/components/ui/select.tsx:99`). Combobox already uses available-width/height and an internal list cap (`src/components/ui/combobox.tsx:57`, `src/components/ui/combobox.tsx:72`). | Apply consistent available-viewport bounds and touch option heights. Reaches quick actions, filters, schedule/date/time pickers. Library collision/scroll behavior is not established by these class strings alone. |
| Selection / badge / tabs (`src/components/admin/admin-bulk.tsx`, `SegmentedTabs.tsx`; `src/components/ui/badge.tsx`, `toggle-group.tsx`) | Checkbox 16px (`src/components/admin/admin-bulk.tsx:53`); removable badge button ~16px (`src/components/ui/badge.tsx:54`); tabs scroll with no minimum touch height (`src/components/admin/SegmentedTabs.tsx:66`, `src/components/admin/SegmentedTabs.tsx:81`); toggle items have py-2/text-xs but no 44px minimum (`src/components/ui/toggle-group.tsx:37`). | Enlarge actual hit regions, preserve horizontal tab reachability. Reaches chats, knowledge, settings, receipt controls and assignment matrix patterns. Sticky bulk bar needs a short-height policy (`src/components/admin/admin-bulk.tsx:78`). |
| Tooltip / DisabledReason (`src/components/ui/tooltip.tsx`, `src/components/admin/DisabledReason.tsx`) | Reasons live only in TooltipContent; focusable span has no tap disclosure (`src/components/admin/DisabledReason.tsx:15`, `src/components/admin/DisabledReason.tsx:22`). | Add an always-visible or tap-open explanation for unavailable actions. Reaches staff/services, leads export, booking edit, property hotspot prerequisites. Accessible focus support exists; dependable sighted touch discovery is Unknown. |
| Event calendar (`src/components/reui/event-calendar/*`, `src/components/admin/AdminCalendarHeader.tsx`) | 128px resource minima, 6/8px hover resize edges, 36px toolbar controls (`src/components/reui/event-calendar/event-calendar-resource-view.tsx:210`, `src/components/reui/event-calendar/event-calendar-event.tsx:387`, `src/components/reui/event-calendar/event-calendar-event.tsx:413`, `src/components/admin/AdminCalendarHeader.tsx:39`). Optional month add affordance is 20px and hover/focus-revealed (`src/components/reui/event-calendar/event-calendar-month-view.tsx:955`); its default is off (`src/components/reui/event-calendar/event-calendar.tsx:1639`), so it is not an established active admin control. | Touch-visible editing affordances, larger handles, deliberate narrow-view default, and height-aware toolbar/grid. Benefits hotel/staff calendars. Preserve tap editors that already avoid drag-only operations. |
| Chat kit (`src/components/ui/chat/*`) | ChatInput is phone 16px but md 14px (`src/components/ui/chat/chat-input.tsx:20`); chat-bubble avatar text is 11px (`src/components/ui/chat/chat-bubble.tsx:26`). ExpandableChat has md overlay behavior (`src/components/ui/chat/expandable-chat.tsx:20`) but admin inbox uses its own Dialog. | Keep keyboard/safe-area policy consistent between dedicated public chat and admin composer; do not assume public overlay behavior covers admin. Avatar text is a kit finding, not proof that this avatar is rendered in every admin transcript. |
| SwipeRail / WheelPicker (`src/components/ui/SwipeRail.tsx`, `wheel-picker.tsx`) | SwipeRail has horizontal snap/hidden scrollbar and 84% → 58% item basis at sm (`src/components/ui/SwipeRail.tsx:78`, `src/components/ui/SwipeRail.tsx:90`); dots are 8px tall and arrows 40px (`src/components/ui/SwipeRail.tsx:110`, `src/components/ui/SwipeRail.tsx:124`). It has tap arrows/dots, so is not swipe-only. Wheel wrapper is fixed 224px (`src/components/ui/wheel-picker.tsx:22`), with library-owned interaction behavior. | Enlarge navigation hit regions and bound wheel width if used in narrow nested forms. No scoped admin route import was found for these two primitives; record as UI-kit inventory, not a present admin screen defect. Wheel gesture/tap behavior is Unknown from wrapper alone. |
| ScrollArea and passive wrappers (`src/components/ui/scroll-area.tsx`, `card.tsx`, `alert.tsx`, `label.tsx`, `separator.tsx`, `skeleton.tsx`, `spinner.tsx`) | ScrollArea clips its root and provides a thin custom scrollbar (`src/components/ui/scroll-area.tsx:14`, `src/components/ui/scroll-area.tsx:41`). Remaining wrappers do not introduce device-specific pane changes or mobile alternatives. | Ensure callers expose reachable overflow and avoid competing scroll regions; no independent blocking responsive defect established in passive wrappers. |

## Static verification limits for the improvement loop

- Exact overflow under 400px, software-keyboard focus visibility, side-popover collision, and canvas form visibility were not measured. Risks above are explicit source constraints or qualified potential failures, not screenshots of observed failures.
- Phone screenshot alone would miss the custom 1400px shell transition, portrait-to-landscape 1024px chat/checkout transition, container-based checkout columns, and coarse-pointer behavior. Test those independently.
- Highest-value real-device cases: 360px with keyboard open; 768/834px portrait with roster/matrix; 1024px landscape with maximum staff and long knowledge rows; 1280 vs 1400 desktop navigation; 1536+ checkout panel; short-height financial/roster confirmations; light/dark Safari and standalone safe areas. These are future verification cases, not tests run in this read-only inventory.
