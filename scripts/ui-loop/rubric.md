# Frozen UI rubric v1

Scores are integers 0–10. Read anchors in descending order: 10, 9, 7, 5; interpolate 8 and 6.

| #   | Category                | Definition (admin UI)                                                                                                                                                                                        | Weight |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Typography              | Text is legible at the device's viewing distance, uses one small type scale, and sets data (money, times, counts) for scanning.                                                                              | 1      |
| 2   | Hierarchy               | The eye lands on the screen's job first: page title, then the decision-relevant data, then **one** primary action. Secondary actions are visibly quieter.                                                    | 1      |
| 3   | Spacing & density       | Spacing follows one rhythm and groups related items by proximity. The device shows the working set without wasted space. On touch layouts, targets are finger-sized and separated.                           | 1      |
| 4   | Color & contrast        | The palette is restrained and every colour means something. Text, input borders, focus rings and meaningful icons stand out from their background, including on glass. Colour is never the only signal.      | 1      |
| 5   | Iconography             | One icon family with consistent size and stroke. Each icon has one meaning across the app, and any icon without a universal meaning has a label.                                                             | 1      |
| 6   | Consistency & polish    | The screen looks like one finished product. The same component looks the same everywhere, edges align, nothing is a browser default or broken, and the register is calm and premium.                         | 1      |
| 7   | Clarity                 | A new staff member can tell what the screen is for, what each control does and what each value means. The copy is plain enough for non-native English readers.                                               | 1      |
| 8   | Layout & responsiveness | The layout is designed for this window size, not scaled from another one. Panes, sheets and navigation suit the size class, nothing is cut off or scrolls sideways, and context stays visible while editing. | 1      |
| 9   | Navigation              | Staff can always tell where they are, get back, and reach the next place. The shell is stable and the current location is marked.                                                                            | 1      |
| 10  | Status at a glance      | The states staff act on (unpaid, unread, waiting, assigned, arrived, no-show, error) are visible in lists, calendars and cards without opening anything, and colour is backed by text or an icon.            | 1      |
| 11  | States & safety         | Empty, loading, error, saving and destructive moments tell the truth about the system and protect staff from costly mistakes.                                                                                | 1      |
| —   | **Overall**             | Computed: the mean of rows 1–11 for one device and one auditor. Never written by an auditor.                                                                                                                 | —      |

Rows 1–7 are the user's categories with their names unchanged. Rows 8–11 are the UX rows the visual list doesn't cover. Row order is fixed in every prompt, table and JSON, so order effects stay constant across rounds.

**Severity caps tie the number to the issues.** Every issue carries an NN/g severity: 1 cosmetic, 2 minor, 3 major, 4 catastrophe. The orchestrator clamps each category score to the cap set by that category's open issues on that device:

| Open issues whose _primary_ category is this one (this device) | Max score |
| -------------------------------------------------------------- | --------- |
| None                                                           | 10        |
| 1–2 cosmetic (sev 1)                                           | 9         |
| 3+ cosmetic, or 1 minor (sev 2)                                | 8         |
| 2+ minor                                                       | 7         |
| 1 major (sev 3)                                                | 6         |
| 2+ major, or any catastrophe (sev 4)                           | 4         |

- Each issue has exactly one primary category, so one defect can't sink two rows.
- Issues marked `feature_gap` never count toward caps .
- A clamp is logged. If clamps happen often, the auditor is scoring by feel instead of by its own findings, and that shows up in the report.

**Generic anchor meaning** (each category below makes this concrete):

- **10**: no issue of any severity in this category on this device. You would put this screen on the taste-reference board.
- **9**: at most two cosmetic issues. A design lead would ship it.
- **7**: minor problems present, nothing major. It works, but staff notice friction.
- **5**: a major problem (staff misread, mis-tap, or can't find something), or minor problems that together impair the task.

**Responsive rules.** Every screen is built to these; deduct under the named category when a capture breaks one.

1. **Navigation changes form; it never disappears** (Navigation). Phone: a bottom tab bar (daily sections, Search, Menu). iPad, both orientations: a visible icon rail with short labels, expandable to the sidebar. Desktop: a persistent sidebar, collapsible to the rail. Menu lists the other sections with the same names and order as the sidebar.
2. **Panes by size** (Layout & responsiveness). Phone: drill in, and Back keeps your place. iPad portrait: one pane plus a side sheet. iPad landscape: two panes. Desktop: up to three. The open record, the cart and draft replies survive rotation and resizing.
3. **Overlays by size** (Layout & responsiveness). Phone: a full-screen page or a bottom sheet, never a modal on top of a modal. iPad and desktop: a side panel, or a dialog for short confirmations. Dialogs are height-capped and scroll.
4. **Where the primary action goes** (Hierarchy). iPad and desktop: top right, or the bottom of the side panel. Phone: "+" in the top bar for creating, a pinned bottom bar for a record's next step (e.g. "Charge ฿X"), Save in the top bar for forms so the keyboard can't hide it.
5. **Every input has a tap route** (States & safety). Hover, drag, swipe and long-press may only add speed; each needs a visible tap path (⋯ menu, Select, a "Reschedule" form). Calendar drags need a confirm step.
6. **Same everywhere** (Consistency & polish). Labels, section and field order, status colours, the primary action's label, and what staff can do. Only navigation form, number of panes, density and overflow placement may change between devices.
7. **Phone basics** (Layout & responsiveness). The composer and the primary action stay above the keyboard; bottom-pinned bars clear the home indicator.

The anchors describe things a reviewer can see in a screenshot. Pixel facts (font sizes, target sizes, contrast ratios, overflow) are gated by §4 before judging, so the anchors talk about what's visible ("text you'd have to zoom to read"), not measurements.

#### 1. Typography

- **10:**
  - Four or fewer visibly distinct text sizes. A single display number, such as the checkout total, is exempt.
  - Weights are used for one job each (e.g. regular body, medium labels, semibold headings).
  - Money, times and counts in columns are right-aligned with tabular figures, so digits line up.
  - Headings, labels and body are distinguishable by size _and_ position, not weight alone.
  - Thai and Korean strings sit on the same baseline and look the same size as Latin text, with marks fully visible.
- **9:** As 10, with one slip, e.g. a fifth size used once, or one column of numbers left-aligned.
- **7:**
  - Near-duplicate sizes sit side by side (a 13 next to a 14).
  - Some secondary text is hard to read at this device's distance.
  - A numeric column doesn't line up.
  - A heading and a label are distinguished only by bold.
- **5:**
  - Text has to be zoomed to read, or there's light grey text on a tinted surface.
  - Words or numbers break mid-token ("฿4,2 / 50").
  - Thai marks are cropped.
  - There's no visible difference between headings and body.

Device notes:

- **Phone:** body copy should read without effort at arm's length in daylight, and two-line wrapping in list rows is fine if it's deliberate.
- **iPad (both):** the iPad sits on a counter at more than arm's length, so secondary metadata must still be readable.
- **Desktop:** prose (settings descriptions, fact text) should not run edge to edge. Lines over about 90 characters count as a slip.

#### 2. Hierarchy

- **10:**
  - At a glance the reading order is unambiguous: title, then the key data (total, queue, balance), then exactly one filled primary button labelled verb + noun or verb + amount ("Charge ฿4,250").
  - All other actions are outline, ghost or in menus.
  - Section headings group content.
  - Nothing decorative (illustrations, hero images, gradients) competes with the work.
- **9:** As 10, with one minor competitor, e.g. a badge or a secondary heading as loud as the title.
- **7:**
  - The primary action is identifiable but competes with a second filled button, or it's below the fold on this device.
  - Or two regions carry equal weight, so the starting point is unclear.
- **5:**
  - There's no discernible primary action, or three or more elements carry equal top weight.
  - The decisive number (total, balance due) is no larger than the text around it.

Device notes:

- **Phone:** the primary action is visible without scrolling. A pinned bottom bar counts.
- **iPad:** the primary action sits in the panel header or is pinned to the bottom of the panel it acts on.
- **Desktop:** top right of the page or panel header. The extra width must not create a second focal point, such as a large empty area or a stretched banner.

#### 3. Spacing & density

- **10:**
  - Gaps come from a few repeated values, and spacing inside groups is clearly tighter than between groups.
  - Density is uniform within each region.
  - The working set fits: e.g. 10 or more inbox rows on iPad landscape, every villa in the tape chart, the whole cart beside the catalog.
  - On touch devices, tappable things are visibly finger-sized with clear gaps between neighbours.
- **9:** As 10, with one local inconsistency, e.g. one card with different padding or one cramped toolbar.
- **7:**
  - Spacing visibly mixes tight and airy cards.
  - Or density doesn't suit the device: oversized padding leaves about 6 rows on a 900px desktop, or a desktop table is crammed onto a phone.
  - Or small touch targets sit edge to edge.
- **5:**
  - Elements touch or overlap, there's no rhythm, and dead zones sit beside cramped areas.
  - Touch targets are clearly smaller than a fingertip and adjacent to each other.

Device notes:

- **Phone:** lower density is correct. One primary column, and lists may show fewer fields per row.
- **iPad landscape:** the hardest case, with touch-sized targets at near-desktop information volume. Judge it strictly.
- **iPad portrait:** less width, same touch rules. It's fine if a pane collapses.
- **Desktop:** pointer targets can be compact. An under-used width, such as a narrow centred column with 40% empty, counts against density.

#### 4. Color & contrast

- **10:**
  - Neutral base, one brand accent, and semantic colours (success, warning, danger, info) used only for meaning.
  - Every status colour is paired with text or an icon.
  - All text is clearly readable, including on glass, blur and photos.
  - Input borders, focus rings, toggles and meaningful icons are clearly distinct from their surroundings.
  - If dark mode was captured, it carries the same meaning and contrast.
- **9:** As 10, with one weak spot, e.g. faint placeholder text, or one tint that is decorative but harmless.
- **7:**
  - Several secondary texts are hard to read (grey on tinted glass).
  - Or a semantic colour is used decoratively (red for a non-danger thing).
  - Or one place shows status by colour alone.
  - Or input boundaries are barely visible.
- **5:**
  - Body text or key numbers are hard to read.
  - Status across a list relies on colour alone.
  - Two or more accents compete.
  - Text sits on a photo without a scrim.

Device notes:

- **Phone and iPad:** judge as if the screen is used in bright ambient light (poolside, reception). Low contrast costs more here.
- **Desktop:** hover, selected and focus states must be distinguishable from each other where the flow shows them.
- **All devices:** WCAG ratios are gated in §4, so judges score the _use_ of colour, not the ratio.

#### 5. Iconography

- **10:**
  - One icon family, with one size per context (e.g. inline vs toolbar) and one stroke weight.
  - Icons are optically centred with their labels.
  - Each icon means one thing across the screen and the shell.
  - Icon-only buttons are universal (close, search, more, back). Anything else has a visible label.
  - Channel marks (LINE, WhatsApp, Messenger) are the official marks at a legible size.
- **9:** As 10, with one inconsistency, e.g. one icon slightly heavier or one misaligned.
- **7:**
  - Filled and outline styles are mixed without meaning, or sizes are mixed in the same toolbar.
  - Or several icon-only buttons are non-obvious.
  - Or one icon is used for two different actions.
- **5:**
  - Mixed icon sets, or ambiguous icons on key actions.
  - Pixelated or stretched icons.
  - Decorative icons on every row, adding noise.

Device notes:

- **Phone:** icon-only is acceptable in bottom bars only if labels sit beneath.
- **iPad:** there's no hover on touch, so tooltips don't exist and any non-universal icon-only control is an issue.
- **Desktop:** a tooltip may carry the label for _secondary_ icon-only actions, but only if `flow.md` shows it.

#### 6. Consistency & polish

- **10:**
  - The same role always looks the same: buttons, inputs, chips, cards, radii and shadows match each other and the shell.
  - Edges align to shared columns.
  - No browser-default controls (select, date picker, scrollbars styled inconsistently).
  - Photos are sharp and correctly cropped.
  - Capitalisation and terminology are uniform.
  - The register matches the taste references: calm and premium, nothing loud.
- **9:** As 10, with one or two small slips, e.g. an edge a few pixels off or one radius mismatch.
- **7:**
  - Two button styles for the same role, mixed radii, a default `<select>`, a stretched photo, or Title Case mixed with sentence case.
- **5:**
  - It looks assembled from different kits.
  - Template defaults, broken images, overlapping elements, debug or placeholder text.

Device notes:

- **Phone:** sheets and drawers must look like members of the same family as desktop dialogs.
- **iPad landscape (dark capture):** dark mode parity is judged here.
- **All devices:** compare against the taste references for this device class only.

#### 7. Clarity

- **10:**
  - The page title names the job.
  - Every button is a verb + noun or verb + amount.
  - Every number has a label and unit or currency.
  - No raw enums, IDs or code words ("PENDING_PAYMENT", "fact_23").
  - Dates and times use the local format, with relative time where it helps.
  - One term per concept (not "villa", "property" and "room" for the same thing).
  - Thai and Korean content displays correctly, and copy is short and literal enough for non-native English speakers.
- **9:** As 10, with one vague label ("Details", "Submit") or one unexplained abbreviation.
- **7:**
  - Several vague labels, a visible raw enum or ID, a number whose meaning isn't stated, or mixed terminology.
- **5:**
  - You can't tell what the screen does or what the main button will do.
  - Technical error text, placeholder or lorem text, or idioms.

Device notes:

- **Phone:** truncation must not remove meaning ("Che…" for "Check out" is an issue).
- **Desktop:** the extra space should go to labels instead of icon-only controls.

#### 8. Layout & responsiveness

- **10:**
  - The layout is clearly native to this size class (see the §1.4 table).
  - Detail opens without losing the list or cart where the size class allows.
  - Edits happen in place or in a side or bottom sheet, not a full-page modal.
  - Sticky headers and action bars never cover content.
  - Long content (long names, long Thai strings, many items) wraps or scrolls inside its pane.
- **9:** As 10, with one region that isn't optimal, e.g. a form slightly too wide on desktop, or a modal where a side sheet would keep context.
- **7:**
  - The screen is visibly another device's layout scaled: a shrunken desktop on a phone, or a stretched phone column on desktop.
  - Or a full-page modal hides the list on iPad landscape.
  - Or a pane needs sideways scrolling for primary content.
- **5:**
  - Content is cut off or overlapping.
  - Controls are unreachable, or a sticky element covers the primary action or content.

Device notes:

- **Phone:** stacking is expected. The detail has a visible Back, and the bottom sheet or bar must not hide the last list row.
- **iPad portrait:** often the weakest device. A collapsed list behind a toggle is acceptable only if the toggle is obvious.
- **iPad landscape:** master-detail is the bar for a 10.
- **Desktop:** the width must be used for content (wider list, more columns, persistent detail), not empty gutters.

#### 9. Navigation

- **10:**
  - The shell is identical to the other pages, with the current section highlighted.
  - The page title matches the nav label.
  - Tabs show the active tab clearly.
  - Detail and sub-views have Back, a breadcrumb or a close control.
  - There are 9 or fewer top-level items.
  - Count badges appear only on queues that need action.
- **9:** As 10, with one minor gap, e.g. a subtle active state, or a missing breadcrumb on one sub-view.
- **7:**
  - The current location is ambiguous, or the title differs from the nav label.
  - Or there's a dead end with no way back.
  - Or the nav changes shape between pages.
  - Or there are badges on things that need no action.
- **5:**
  - Nothing tells you where you are.
  - The nav is hidden with no affordance, or it's duplicated or broken.

Device notes:

- **Phone:** a bottom tab bar for the daily sections plus Menu (a drawer alone breaks rule 1); the header must still show the current section.
- **iPad:** a visible icon rail with short labels, expandable to the full sidebar. Navigation hidden behind a drawer or a lone menu button breaks responsive rule 1 (major, Navigation).
- **Desktop:** a persistent sidebar.
- **Global ⌘K search is a known feature gap.** Don't deduct for it.

#### 10. Status at a glance

- **10:**
  - Every row, card or bar shows the state staff act on, e.g. balance or unpaid, unread count, waiting time, assignee or "Unassigned", booking lifecycle, or channel error.
  - Colour is always paired with a text label or icon.
  - Any colour encoding has a legend.
  - Urgent items (overdue, waiting long) stand out.
  - Time views have a now or today marker.
- **9:** As 10, with one secondary state that needs the item opened, or one minor encoding without a legend.
- **7:**
  - A primary actionable state is only in the detail view (e.g. payment status).
  - Or the status chips differ between list and detail.
- **5:**
  - Lists show names only, so you have to open each item.
  - Colour carries no stated meaning, or badges sit on things that need no action.

Device notes:

- **Phone:** compact rows may drop secondary metadata but must keep the actionable state (unread, unpaid, waiting).
- **iPad landscape and desktop:** list and detail are both visible, so their statuses must agree.
- **All devices:** if the backend doesn't provide the state, it's a feature gap, not a deduction .

#### 11. States & safety

- **10:**
  - Empty states name the cause and offer one verb + noun action, and "no results for this filter" differs from "nothing yet".
  - Loading skeletons match the final layout.
  - Errors sit next to the field or item, in plain language, with a recovery action.
  - There's one save model with a visible saved state.
  - Destructive actions are set apart, red, and either confirmed with the consequence named or undoable.
  - Overrides ask for a reason.
- **9:** As 10, with one weaker state, e.g. generic empty copy, or a confirmation that doesn't name the consequence.
- **7:**
  - A blank pane or a spinner-only state.
  - Or technical error text, or mixed save models (autosave next to a Save button).
  - Or Delete next to Edit at the same visual weight.
- **5:**
  - A state is missing or broken (an empty list shows nothing at all).
  - Or a destructive action has no confirmation or undo, or you can't tell whether data saved.

Device notes:

- **Phone:** bottom-sheet confirmations are fine, but swipe-to-delete without Undo is an issue.
- **Desktop:** a destructive dialog must not have the destructive button as the default focused action, if the flow shows focus.

Only judge captured states. Put missing states in not_observed; never invent evidence.

the frontend loop can't build

- **Known gaps are given to auditors as a list:** villa/folio charge, ⌘K search, per-fact AI switch and gap list, booking-to-cart prefill, messaging-window state, and channel health. A gap is logged in `feature_gaps` and **never lowers a score or counts toward a cap**.
- **New gap claims must name the missing data or mutation** (`missing_backend`). The orchestrator checks the claim against the Convex function return types the screen already uses (a grep in `convex/`). If the data is already available, the claim is reclassified as a normal, scored issue. This stops auditors excusing gaps and implementers hiding behind them.
- **Fake affordances are penalised.** A button or menu item for a feature that doesn't work (e.g. a disabled "Charge to villa" with no explanation, or a "coming soon" control) is a Clarity issue at severity 3. Feature gaps are listed, not mocked.
- **Gaps go to the wave PR's feature backlog**, as the plan already says.

## Page-specific criteria (ipad-l only, non-gating)

(each scored 0–10 and reported separately from the overall score)

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
