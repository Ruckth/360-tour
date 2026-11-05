# UI scoring metric for the admin improvement loop (2026-11-05)

This is a decision document. It defines the scorecard that independent reviewers A and B use to audit admin screens in the loop described in `docs/plans/admin-ui-improvement-loop.md`. It replaces the 9-criterion gating rubric at the end of `docs/research/admin-ui-competitors.md`. The page-specific criteria (S1, C1–C2, H1–H2, B1–B2, P1–P2, F1, R1, L1, T1) stay as they are: tracked, not gating.

## Decisions at a glance

1. **11 scored categories plus a computed Overall.** These are the user's 7 visual-craft rows, plus 4 UX rows: Layout & responsiveness, Navigation, Status at a glance, and States & safety. They absorb the old rubric's 9 criteria (mapping in §1.2).
2. **Every category is scored on 4 devices:** phone 360×800, iPad portrait 820×1180, iPad landscape 1180×820 (primary), and desktop 1440×900. Each is a different Material 3 window size class, so each gets its own layout and its own score.
3. **Judges give integers only.** Decimals come from averaging 3 runs. Overall is computed by the orchestrator and the judges never write it.
4. **Equal weights.** Severity caps and a floor protect the critical rows, so weights would add little.
5. **Pass bar.** On every device and for both auditors: Overall ≥ 9.0, every category ≥ 8.0, no open major (severity ≥ 3) issue, and all deterministic checks green. The pass then has to hold in a cold confirmation round.
6. **Scores are tied to issues.** An auditor can't give 9 to a category that has a minor-or-worse issue listed against it. The orchestrator enforces this.
7. **Reliability.** Blinding (including neutral filenames and an isolated working directory), calibration anchors with a sensitivity probe every round, and pairwise comparison used only as a regression and inflation check. Pairwise never gates.
8. **Deterministic Playwright checks gate before any judge runs.** Judges don't estimate pixels.

---

## 1. Categories

### 1.1 The category table

| # | Category | Definition (admin UI) | Weight |
|---|---|---|---|
| 1 | Typography | Text is legible at the device's viewing distance, uses one small type scale, and sets data (money, times, counts) for scanning. | 1 |
| 2 | Hierarchy | The eye lands on the screen's job first: page title, then the decision-relevant data, then **one** primary action. Secondary actions are visibly quieter. | 1 |
| 3 | Spacing & density | Spacing follows one rhythm and groups related items by proximity. The device shows the working set without wasted space. On touch layouts, targets are finger-sized and separated. | 1 |
| 4 | Color & contrast | The palette is restrained and every colour means something. Text, input borders, focus rings and meaningful icons stand out from their background, including on glass. Colour is never the only signal. | 1 |
| 5 | Iconography | One icon family with consistent size and stroke. Each icon has one meaning across the app, and any icon without a universal meaning has a label. | 1 |
| 6 | Consistency & polish | The screen looks like one finished product. The same component looks the same everywhere, edges align, nothing is a browser default or broken, and the register is calm and premium. | 1 |
| 7 | Clarity | A new staff member can tell what the screen is for, what each control does and what each value means. The copy is plain enough for non-native English readers. | 1 |
| 8 | Layout & responsiveness | The layout is designed for this window size, not scaled from another one. Panes, sheets and navigation suit the size class, nothing is cut off or scrolls sideways, and context stays visible while editing. | 1 |
| 9 | Navigation | Staff can always tell where they are, get back, and reach the next place. The shell is stable and the current location is marked. | 1 |
| 10 | Status at a glance | The states staff act on (unpaid, unread, waiting, assigned, arrived, no-show, error) are visible in lists, calendars and cards without opening anything, and colour is backed by text or an icon. | 1 |
| 11 | States & safety | Empty, loading, error, saving and destructive moments tell the truth about the system and protect staff from costly mistakes. | 1 |
| — | **Overall** | Computed: the mean of rows 1–11 for one device and one auditor. Never written by an auditor. | — |

Rows 1–7 are the user's categories with their names unchanged. Rows 8–11 are the UX rows the visual list doesn't cover. Row order is fixed in every prompt, table and JSON, so order effects stay constant across rounds.

### 1.2 What merged where

| Old criterion (weight) | Now lives in |
|---|---|
| Primary task and action clarity (15) | **Hierarchy** (one primary action, verb + noun label) and **Clarity** (label wording) |
| At-a-glance status (15) | **Status at a glance** (unchanged in substance) |
| iPad-landscape layout fit (15) | **Layout & responsiveness**, now scored on all four devices instead of "phone/desktop can only lower it" |
| Navigation (10) | **Navigation** |
| Touch/density (10) | **Spacing & density** (density, rhythm, touch spacing). Target pixel sizes are measured by the §4 checks. |
| Editing and safety (10) | **States & safety** covers the save model and destructive actions. Where edits happen (inline or side sheet versus a full-page modal) goes to **Layout & responsiveness**. |
| Empty/loading/error states (10) | **States & safety** |
| Visual craft and brand fit (10) | Split across **Typography, Color & contrast, Iconography, Consistency & polish** (brand register lives in Consistency & polish) |
| Accessibility and language (5) | Contrast and focus go to **Color & contrast**, which follows WCAG 1.4.11's non-text contrast. Language and Thai/Korean rendering go to **Clarity**. Measurable parts are gated by §4. |

Sanity check against [NN/g's 10 heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/):

- Visibility of system status maps to Status at a glance and States & safety.
- Match with the real world maps to Clarity.
- User control/freedom, error prevention and error recovery map to States & safety.
- Consistency and standards maps to Consistency & polish.
- Recognition rather than recall maps to Navigation and Iconography (labels).
- Flexibility and efficiency maps to Spacing & density and Navigation.
- Aesthetic and minimalist design maps to Hierarchy and Color & contrast.

Only "help and documentation" is unscored, which is deliberate for a staff tool.

The user's example has 7 equal rows, so the visual side matches it. With 4 UX rows added, the split is about 6 UX-leaning rows (Hierarchy, Clarity and rows 8–11) to 5 craft rows. That balance is why equal weights work (§2.1).

### 1.3 Scale, anchors and severity caps

**Scale.** Each run gives an integer from 0 to 10 per category. Anchors are written for 10, 9, 7 and 5, and scores of 8 and 6 fall between them. Anchors are listed in **descending** order (10 → 5), because descending rubric order improved scoring accuracy for several judge models ([Evaluating Scoring Bias in LLM-as-a-Judge, 2025](https://arxiv.org/html/2506.22316v4)).

The evidence on scale range is mixed:

- GPT-4 aligned best with humans on 1–10 integers. A float modifier and 1–100 did worse, and 1–100 produced clustering on round numbers ([Stureborg et al. 2024](https://arxiv.org/html/2405.01724v1)).
- A 2026 study found 0–5 aligned best and 0–10 worst, though the gap was small: ICC 0.853 vs 0.805 ([Li et al. 2026](https://arxiv.org/html/2601.03444v1)).

So the user-facing scale stays 0–10, but in practice it's a four-anchor scale with interpolation.

**Severity caps tie the number to the issues.** Every issue carries an [NN/g severity](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/): 1 cosmetic, 2 minor, 3 major, 4 catastrophe. The orchestrator clamps each category score to the cap set by that category's open issues on that device:

| Open issues whose *primary* category is this one (this device) | Max score |
|---|---|
| None | 10 |
| 1–2 cosmetic (sev 1) | 9 |
| 3+ cosmetic, or 1 minor (sev 2) | 8 |
| 2+ minor | 7 |
| 1 major (sev 3) | 6 |
| 2+ major, or any catastrophe (sev 4) | 4 |

- Each issue has exactly one primary category, so one defect can't sink two rows.
- Issues marked `feature_gap` never count toward caps (§2.6).
- A clamp is logged. If clamps happen often, the auditor is scoring by feel instead of by its own findings, and that shows up in the report.

**Generic anchor meaning** (each category below makes this concrete):

- **10**: no issue of any severity in this category on this device. You would put this screen on the taste-reference board.
- **9**: at most two cosmetic issues. A design lead would ship it.
- **7**: minor problems present, nothing major. It works, but staff notice friction.
- **5**: a major problem (staff misread, mis-tap, or can't find something), or minor problems that together impair the task.

### 1.4 Devices

| Key | Viewport | DPR | Emulation | Material 3 size class ([Android docs](https://developer.android.com/develop/ui/compose/layouts/adaptive/window-size-classes)) | Expected layout model |
|---|---|---|---|---|---|
| `phone` | 360×800 | 3 | `hasTouch`, `isMobile` | Compact (<600) | Single column. Nav in a drawer or bottom bar. Detail pushes full-screen or opens as a bottom sheet with Back. |
| `ipad-p` | 820×1180 | 2 | `hasTouch`, `isMobile` | Medium (600–839) | List *or* detail, with the other pane as an overlay sheet or collapsible. Nav as a rail or drawer. |
| `ipad-l` (primary) | 1180×820 | 2 | `hasTouch`, `isMobile` | Expanded (840–1199) | Master-detail, with the list, grid or cart visible while detail is open. Nav as a sidebar or rail. |
| `desktop` | 1440×900 | 2 | mouse | Large (1200–1599) | Master-detail with the extra width used for content, not for stretched forms or empty gutters. Persistent sidebar. |

- **Touch emulation self-check.** Before capturing, the harness asserts `matchMedia('(pointer: coarse)').matches` is `true` on the three touch devices and `false` on desktop. Otherwise touch-specific CSS isn't being exercised.
- **Viewport screenshots only, never `fullPage`.** If a state scrolls, capture up to 3 viewport segments with about 15% overlap. Long full-page captures can be downscaled until small text is unreadable. Validate the selected evaluator's image limits and inspect the submitted resolution before each wave.
- **Freeze the clock** with `page.clock.setFixedTime(...)` so relative times ("5m ago") and "today" markers don't change between rounds. Use fixture routes for gate rounds where the shared dev data could otherwise change the screen.
- **Dark theme** stays as the plan has it: one extra `ipad-l` default capture. It goes into the `ipad-l` call and is judged under Color & contrast and Consistency & polish (parity). It doesn't get its own column.

### 1.5 Category anchors

The anchors describe things a reviewer can see in a screenshot. Pixel facts (font sizes, target sizes, contrast ratios, overflow) are gated by §4 before judging, so the anchors talk about what's visible ("text you'd have to zoom to read"), not measurements.

#### 1. Typography
- **10:**
  - Four or fewer visibly distinct text sizes. A single display number, such as the checkout total, is exempt.
  - Weights are used for one job each (e.g. regular body, medium labels, semibold headings).
  - Money, times and counts in columns are right-aligned with tabular figures, so digits line up.
  - Headings, labels and body are distinguishable by size *and* position, not weight alone.
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
- **All devices:** WCAG ratios are gated in §4, so judges score the *use* of colour, not the ratio.

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
- **Desktop:** a tooltip may carry the label for *secondary* icon-only actions, but only if `flow.md` shows it.

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
- **Phone:** nav collapses to a drawer or bottom bar, and the header must still show the current section.
- **iPad:** a rail with labels, or a drawer, is fine. The plan already keeps the sidebar fully closed on tablet, so the closed state must still show where you are.
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
- **All devices:** if the backend doesn't provide the state, it's a feature gap, not a deduction (§2.6).

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

**Scoring this category depends on the harness:**
- It can only be scored from captured states. The harness must capture default, empty, long-content, one dialog and **one error state** per screen. Error is a new requirement; use a fixture route where dev data can't produce it.
- A missing capture is a harness bug to fix before the audit. The auditor doesn't guess around it.

---

## 2. Aggregation and gating

### 2.1 Weights: equal

**Decision:** all 11 categories get weight 1.

1. **Equal weights are robust.** Unit-weighted composites predict about as well as "optimally" weighted ones when the inputs are positively correlated, which UI categories are ([Dawes 1979](https://www.cmu.edu/dietrich/sds/docs/dawes/the-robust-beauty-of-improper-linear-models-in-decision-making.pdf)).
2. **Near the bar, weights barely move the number.** Example: Hierarchy and Status both at 8, every other category at 9.3. Equal weights give 9.06. A 2× weight on the four "task" rows gives 8.95. That 0.1 shift only matters at the margin, and the floor rule (§2.4) already handles the margin more transparently.
3. **Severity caps already protect what matters.** A real task-blocking problem is a major issue, which caps that category at 6, which fails the floor, whatever the weight.
4. **People can check it.** The Overall is the plain average of the column, which is what the user's example shows. Weights also invite the implementer to farm high-weight rows.

### 2.2 How each device's Overall is computed

For screen *s*, device *d*, auditor *a*, with runs *r = 1…n* (n = 3 at gates):

```
cat(s,d,a,c)  = mean over runs r of clamp(score_r(c), cap_r(c))      // clamp per §1.3
overall(s,d,a) = mean over the 11 categories of cat(s,d,a,c)
display        = round-half-up to 1 decimal; the gate uses the displayed value
```

- **Gating on the displayed value** means a table can never show "9.0" next to FAIL.
- **Overall is never written by a judge.** In the user's example, the first reviewer column's seven rows average 8.94 but its Overall reads 9.0, and the second reviewer column averages 9.04 but reads 9.1. A judge's own Overall drifts upward exactly at the threshold.
- **There's no cross-device average.** A screen's headline number is its **weakest cell**: the minimum over 4 devices × 2 auditors.

### 2.3 The pass bar

**Decision: keep the user's "every device ≥ 9 for both auditors", and add three conditions.**

A screen passes when, for **all 4 devices × both auditors**:

1. `overall ≥ 9.0` (3-run mean), **and**
2. every category `≥ 8.0` (the floor), **and**
3. no open non-gap issue with severity ≥ 3 from either auditor, **and**
4. all §4 deterministic checks pass on that device.

It must then **hold in a confirmation round**: a fresh capture, fresh runs, and no code change in between, as the plan already requires.

Alternatives rejected:

- **Average across devices ≥ 9.** A great desktop would hide a broken phone, which is the opposite of the user's intent.
- **Primary device ≥ 9, others ≥ 8.5.** Tempting, since iPad landscape is primary, but the user asked for good UX everywhere. The primary device instead gets priority in *fix order*, not a lower bar elsewhere.
- **Mean of the two auditors ≥ 9.** Averaging hides self-preference (§3.8). Requiring both makes reviewer A an independent check on the implementer's work.
- **Statistical lower bound ≥ 9.** It's more rigorous, but the user can't read it. The borderline rule below gets most of the benefit.

**Borderline rule.** A conjunction of 8 noisy values fails more often than any one of them. If a cell lands at 8.8 or 8.9 and everything else passes, run 3 more runs for that device and auditor only, and gate on the 6-run mean. Resolve borderline cases with more samples, never by lowering the bar.

### 2.4 Floor rule

Every category must be ≥ 8.0 on every device for both auditors. With integer runs averaged over 3, 8.0 allows 7·8·9 or 8·8·8 but not 7·7·9. One run at 7 is tolerated as noise, and two are not.

The floor plus the severity caps means:
- one major issue anywhere blocks the pass, because the cap is 6 and that is below the floor;
- a minor issue is allowed in at most a few categories, because the cap is 8 and the overall must still reach 9.

### 2.5 Issue gate

**When an issue counts as "open" for an auditor at a gate.** It must appear in at least 2 of that auditor's 3 runs, the majority-vote rule from [Haldar & Hockenmaier](https://arxiv.org/html/2510.27106). The orchestrator matches issues across runs by screenshot, region and quoted text. An issue seen in only one run is listed as *unconfirmed*: it still caps that run's score, but it doesn't trigger the issue gate on its own.

Rule 3 of the pass bar (no open severity ≥ 3) is applied **across auditors**. If A reports a major issue that B didn't see, the screen doesn't pass until one of these happens:

- the issue is fixed, or
- in the next round, both auditors independently fail to reproduce it. It isn't re-shown to them; it is simply checked whether they report it again.

### 2.6 Feature gaps the frontend loop can't build

- **Known gaps are given to auditors as a list:** villa/folio charge, ⌘K search, per-fact AI switch and gap list, booking-to-cart prefill, messaging-window state, and channel health. A gap is logged in `feature_gaps` and **never lowers a score or counts toward a cap**.
- **New gap claims must name the missing data or mutation** (`missing_backend`). The orchestrator checks the claim against the Convex function return types the screen already uses (a grep in `convex/`). If the data is already available, the claim is reclassified as a normal, scored issue. This stops auditors excusing gaps and implementers hiding behind them.
- **Fake affordances are penalised.** A button or menu item for a feature that doesn't work (e.g. a disabled "Charge to villa" with no explanation, or a "coming soon" control) is a Clarity issue at severity 3. Feature gaps are listed, not mocked.
- **Gaps go to the wave PR's feature backlog**, as the plan already says.

### 2.7 Page-specific criteria

These stay tracked, not gating. They're scored once per screen on `ipad-l` in the same call, and reported as one line under the scorecard (e.g. `C1 8 · C2 7`).

---

## 3. Reliability protocol for the AI judges

### 3.1 What the research says, and what we do about it

| Finding | Source | Consequence here |
|---|---|---|
| VLMs are weak at judging fine visual craft in absolute terms. GPT-4V was at chance (51.6%) on UI design-quality pairs where a small CLIP model reached 75%. It preferred a variant with oversized, overflowing text. Even human designers agreed only weakly (Krippendorff's α = 0.37). | [UIClip, Wu et al. 2024](https://arxiv.org/html/2404.12500v1) | Pixel-level craft (overflow, font sizes, contrast, target sizes) is measured by Playwright (§4), not judged. Judges score composition and meaning. |
| The multimodal models evaluated in the cited study predict human UI ratings roughly: ±1 accuracy 0.72–0.77 on a 7-point scale. Pairwise accuracy is about 60% overall: near chance for small quality gaps and about 90% for large ones. Ease of use is near chance. One evaluated model compresses scores (SD 0.80 vs human 1.06) and over-rates ease of use. | [Luera et al. 2025, "MLLM as a UI Judge"](https://arxiv.org/html/2510.08783) | Expect about ±1 noise per category per run, so average 3 runs. Pairwise can't detect small improvements; use it only for regressions and inflation (§3.7). UX rows rest on observable anchors, not "feels easy". |
| MLLM judges align with humans better in pair comparison than in absolute scoring. | [MLLM-as-a-Judge, Chen et al. 2024](https://arxiv.org/abs/2402.04788) | Absolute scores need strong anchors and calibration (§1.5, §3.6). |
| Pairwise judgments flip in about 35% of cases under superficial distractors, versus 9% for absolute scores. | [Tripathi et al. 2025](https://arxiv.org/abs/2504.14716) | Absolute scoring is the gate. Pairwise is a secondary signal. |
| Zero-shot LLM UI critique is mostly invalid: only 13.1% of zero-shot Gemini comments were validated. Few-shot examples plus visual prompting improved critique quality by 55%. Experts' critique ratings agreed only fairly (Fleiss κ 0.29). LLM localisation is poor. | [UICrit, Duan et al. 2024](https://arxiv.org/html/2407.08850v3) | Give 2 worked example *issues* (format and specificity, no scores) in the prompt. Locate issues by quoted visible text plus region, not bounding boxes. |
| A multimodal-LLM heuristic evaluation found 73–77% of known issues versus 57–63% for five experienced humans. It was strongest on layout, and weaker on conventions and multi-screen issues. | [Zhong et al. 2025](https://arxiv.org/abs/2507.02306) | The judges' issue lists are the most valuable output. Make issues primary and scores derived from them (§1.3). |
| When one generation scores several attributes, later scores anchor on earlier ones: GPT-4 r = 0.979 between two attributes vs 0.315 for humans. Float modifiers didn't beat integers. Averaging 10 high-temperature samples *hurt* the 1–10 scale. | [Stureborg et al. 2024](https://arxiv.org/html/2405.01724v1) | Issues are written **before** scores, via schema key order. Integers only. A small number of runs (3), not 10. |
| LLM judges have low self-consistency across identical runs: Qwen 3 gave the same judgment in all 3 runs only 61.3% of the time on MT-Bench. A majority over 3 runs beat single runs, and 5–10 runs gave no significant further gain. Forcing determinism lowered accuracy. | [Haldar & Hockenmaier 2025, "Rating Roulette"](https://arxiv.org/html/2510.27106) | Use 3 runs at gates and escalate to 5 only when unstable. Don't try to force temperature 0. |
| Prior scores in context pull new scores toward them (\|d\| up to 0.71). Neither chain-of-thought nor a "disregard this" instruction removed the effect. | [Kapetanovic et al. 2026](https://arxiv.org/abs/2608.25869) | Hard blinding: previous scores, round numbers and revision framing are *absent*, not just labelled (§3.4). |
| A reference answer with an attached score pulls judgments toward it (about 45% flip rate for GPT-4o with a score-5 reference). Full-mark references gave the best accuracy. | [Evaluating Scoring Bias, 2025](https://arxiv.org/html/2506.22316v4) | Taste references are shown only as "what 10 looks like", never with mid scores. Calibration anchors are scored in separate calls, never side by side with the screen under test. |
| Position bias: Two evaluated models were consistent only 65% and 23.8% of the time when answer order was swapped. Their win rates on their own outputs rose by about 10% and 25%, respectively (tentative). Single-answer grading agreed with humans about as well as pairwise. | [Zheng et al. 2023](https://arxiv.org/html/2306.05685v4) | Pairwise is always run in both orders, and an inconsistent result counts as a tie. Work is never judged solely by the evaluator used to implement it. |
| Self-recognition correlates linearly with self-preference. A follow-up attributes it to familiarity (low perplexity). | [Panickssery et al. 2024](https://arxiv.org/abs/2404.13076), [Wataoka et al. 2024](https://arxiv.org/abs/2410.21819) | An evaluator may favour design idioms it produces. Watch for a persistent B-minus-A gap that doesn't show up on calibration anchors (§3.8). |
| Asking the judge to explain its ratings improves correlation with humans. | [Chiang & Lee 2023](https://arxiv.org/abs/2310.05657) | Every score carries evidence (§3.5). |
| Breaking criteria down into yes/no checklist items raised agreement between evaluator models by 0.45 and reduced variance. | [CheckEval, Lee et al. 2024–25](https://arxiv.org/abs/2403.18771) | Anchors are written as checkable observations ("one filled button", "legend present"), not adjectives. |
| A single evaluator's severity ratings are too unreliable. The mean of 3 independent evaluators is satisfactory, and evaluators must not see each other's work first. | [NN/g severity ratings](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/), [NN/g heuristic evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/) | 2 auditors × 3 runs, independent and merged only by the orchestrator. |
| Superficial tokens can fool LLM judges into false positives. | [Zhao et al. 2025, "One Token to Fool LLM-as-a-Judge"](https://arxiv.org/abs/2507.08794) | Gaming risk is real. See §6. |

### 3.2 Unit of judgment and inputs

- **One call = one screen × one device × one run.** Scoring all four devices in one generation would make the phone scores anchor on the desktop scores ([Stureborg](https://arxiv.org/html/2405.01724v1)). One call per category would be cleaner but costs 11× more. Instead, issues come first and are capped by severity.
- **Images per call:**
  - that device's state captures: default, empty, long, dialog and error, plus scroll segments (and the dark default on `ipad-l`);
  - 2–3 taste references *for the same device class*.
  - Keep each request within the selected evaluator's image and resolution limits; split states into separate calls if needed.
- **Text inputs:**
  - the frozen rubric (this document's §1);
  - a neutral `flow.md`: what each capture shows and which interaction produced it;
  - the known-gaps list;
  - a statement that "contrast, target size, overflow, font size, truncation and layout shift passed automated checks; do not estimate pixels".
- **Reviewer isolation:** run each reviewer in a fresh, read-only session that can access only a neutral temporary input folder. It must not access previous results under `output/ui-loop/**` or the repository history. Enforce the audit JSON schema for both reviewers.

### 3.3 Runs and variance thresholds

| Round type | Runs per auditor per device | Why |
|---|---|---|
| Working round (implement → audit) | **1** | The issue list drives the next fix, and the score is only a trend line. |
| Gate round (when the working-round Overall is ≥ 8.8 on all devices for that auditor) | **3** | The pass decision needs averaging. Three runs are where majority/mean gains appear, and more runs add little ([Haldar & Hockenmaier](https://arxiv.org/html/2510.27106)). |
| Confirmation round | **3** | Same as a gate, on a fresh capture. |
| Unstable cell (see below) | **+2 → 5**, use the **median** per category | Medians resist one outlier run. |

**Stability rule (per device and auditor, gate rounds):**
- The range of the 3 run Overalls must be ≤ 0.6.
- Every category's range across runs must be ≤ 2 points. A range of 3 or more means the runs disagree about which anchor applies.
- If either fails, add 2 runs. If a category is unstable on 2 or more screens in a wave, its anchor wording is ambiguous. Fix the wording *between* waves, never mid-wave, because the rubric is frozen per wave.

**Rules in the plan that should change (they currently fire on single-run noise):**
- **Revert** only when a 3-run mean drops more than 0.5 below the best, *or* a both-orders pairwise loss (§3.7) confirms it. Never revert on a single run.
- **Plateau** means two consecutive rounds in which no severity-≥2 issue was resolved. Score deltas under 0.3 are within noise.

**Agreement between auditors.** Report Krippendorff's α (interval) between A and B over all category × device cells in the section. If α is below 0.667 ("tentative" agreement; 0.8 is the commonly accepted good threshold per [Haldar & Hockenmaier](https://arxiv.org/html/2510.27106)), the section's PASS also needs a user spot check of the annotated screenshots.

### 3.4 Blinding

The auditor **never** receives:
- previous scores, previous issues or the round number;
- the implementer's rationale, the diff, commit messages or code;
- the other auditor's output;
- any wording such as "after fixes", "revised" or "improved".

Prior scores bias judges even when presented as metadata, and warnings don't neutralise them ([Kapetanovic et al. 2026](https://arxiv.org/abs/2608.25869)).

How to enforce it:
1. **Neutral paths.** Copy captures to `<tmp>/<random>/<screen>-<device>-<state>[-segN].png`. The plan's path `round-<n>/` leaks the round.
2. **Lint `flow.md`.** It must not contain `round`, `before`, `after`, `fix`, `improv`, `changed`, `previous` or `new` (when used as "new version"). It describes states, not history.
3. **Isolated working directory and a fresh session** for each reviewer call.
4. **Calibration anchors look like ordinary inputs** (§3.6), so the auditor can't tell when it's being tested.

### 3.5 Required evidence per score

The schema (§5.3) enforces it and the orchestrator validates it. An invalid response is re-run once, then flagged.

- **Issue:**
  - `screenshot`: an existing filename;
  - `where`: the quoted visible text or element label plus a coarse region, e.g. `"'Assign' button, top-right of detail pane"`;
  - `observation`: what is seen, not what is felt;
  - `severity` (1–4), one primary `category`, `fix`, and `feature_gap`.
- **Category score:**
  - `evidence`: one sentence naming what was observed;
  - `screenshots`: at least one.
- **Scores below 10** must list the `blocking_issue_ids` that prevent the next anchor up. A score of 10 must say what was checked.
- **Scores of 9 or 10** must cite the anchor conditions they meet. For Hierarchy, for example, "single filled button 'Charge ฿4,250', pinned bottom of cart".
- **Validation:**
  - exactly 11 unique categories;
  - all issue IDs exist;
  - every score is clamped to the cap set by its issues (§1.3), with clamps logged;
  - if the 11 scores in one response have a standard deviation below 0.3, flag a "halo". That pattern is all categories anchoring on one impression.

### 3.6 Calibration anchors (drift detection)

**The set.** Build it once at the start of wave 0, then freeze it.

- **8 anchor captures, 2 per device:**
  - one round-0 baseline screen (expected about 5–7);
  - one "known good" screen. At first this is the best existing screen, likely checkout. As screens pass confirmation, frozen copies replace it.
- **8 synthetic degradations** of the known-good captures, in the style of UIClip's jitter:
  - spacing noise;
  - a font-size swap;
  - a contrast drop on secondary text;
  - one misaligned column;
  - a status chip turned colour-only.
  Each degradation targets one known category.
- **Agreed scores.** Each auditor scores each anchor 5 times. The user reviews the medians and adjusts them. Those become the agreed scores per category.

**Every round.** Each auditor scores 1 anchor and 1 degradation per device, rotating through the set. Anchors look like normal inputs, use the same prompt, and run in separate calls.

**Alarms:**
- **Drift:** an anchor's Overall is more than 0.5 from its agreed value, or a category is more than 1.5 off.
- **Sensitivity:** a degradation isn't scored at least 1.0 lower than its original in the targeted category. This is the UIClip failure mode, where a judge doesn't see the flaw.
- **What an alarm does:** re-run that anchor once. If it still fails, that auditor's round is **uncalibrated**: its scores are reported but can't pass a gate this round.
- **Model change:** if the auditor model changes (including replacement evaluators), its anchors are re-baselined before its scores count. Absolute scores shift with the judge model more than pairwise results do ([Zheng et al.](https://arxiv.org/html/2306.05685v4)).

Competitor screenshots (Linear, Stripe) are *not* used as scored anchors, because judges recognise the brands, a familiarity effect ([Wataoka et al.](https://arxiv.org/abs/2410.21819)). They stay as unscored taste references.

### 3.7 Pairwise comparison: a check, not a gate

- **What it compares.** Each gate round, reviewer A only compares the current capture with the **best previous round**, per device. Images are labelled X and Y in random order. Each comparison runs **twice with the order swapped**: a winner counts only if consistent, otherwise it's a tie ([Zheng et al.](https://arxiv.org/html/2306.05685v4)).
- **Inflation check.** If an auditor's absolute Overall rose by 0.3 or more but pairwise says "previous better" or "tie", the rise isn't credited. The previous best is kept for that device, and the round is flagged as an inflation suspect.
- **Regression check.** A consistent pairwise loss on any device triggers the plan's revert rule.
- **Why it doesn't gate.** Pairwise can't tell whether something is a 9, it's near chance for small differences ([Luera et al.](https://arxiv.org/html/2510.08783)), and it's more easily distracted ([Tripathi et al.](https://arxiv.org/abs/2504.14716)).
- **Final report.** Baseline vs final pairwise feeds the annotated before/after set.

### 3.8 Stopping score inflation, and self-preference

These are the inflation guards, in order of strength:

1. Hard blinding (§3.4).
2. Severity caps: a score can't rise unless the issues behind it go away (§1.3).
3. Calibration anchors with drift and sensitivity alarms (§3.6).
4. The pairwise inflation check (§3.7).
5. A cold confirmation round.
6. A soft flag in the report when a category rises by 1.0 or more with no previously reported issue for it resolved. The orchestrator matches issues across rounds by screenshot, region and quoted text.

**Self-preference.** Reviewer B may share the implementation evaluator, so self-review is a risk ([Panickssery et al.](https://arxiv.org/abs/2404.13076)). Mitigations:

- **Both auditors must pass.**
- **Watch the gap.** Track the per-section mean of (B − A) on loop screens and on anchors separately. If the gap on loop screens is more than 0.4 above the gap on anchors for 2 rounds, pause the gate and recalibrate or replace reviewer B. Both reviewers must pass a fresh confirmation round; do not silently reduce the two-reviewer requirement.

---

## 4. Deterministic checks (gate before any judge runs)

**When they run.** For every screen × device × captured state, including the open dialog and the dark capture. A failing check blocks the audit for that screen: fix first, the same way as the plan's typecheck and lint gate. Results go in the report, not to the judges.

**Setup.**
- Add `@axe-core/playwright`. The repo only has `@playwright/test`.
- Run in Chromium, because the layout-shift API is Chromium-only.

**Exemptions** are allowed only through a `data-ui-exempt="<check>: <reason>"` attribute in code. Every exemption is listed in the report, so the user sees them.

| Check | How to measure in Playwright | Threshold (gate) |
|---|---|---|
| **axe serious/critical** | `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()` per state ([Playwright docs](https://playwright.dev/docs/accessibility-testing)). Count `violations` with `impact ∈ {serious, critical}`. Moderate and minor are reported, not gated. | **0** on all devices |
| **Colour contrast** | (1) The axe `color-contrast` rule. (2) A fallback for axe's `incomplete` results, which axe returns when a background is a gradient, an image, a pseudo-element or a blur ([axe-core #2781](https://github.com/dequelabs/axe-core/issues/2781), [#708](https://github.com/dequelabs/axe-core/issues/708)). The app uses `backdrop-blur` in 28 places, including dialog, sheet, button and checkout, so this path matters. For each incomplete node: take a screenshot clipped to its box with `color: transparent` injected, take the background luminance at the worst-case percentile (5th or 95th, whichever is closer to the text colour), and compute the ratio against the computed text colour (alpha composited). Also check input borders and focus rings against the adjacent background. | Text **≥ 4.5:1**, large text (≥ 24px, or ≥ 18.66px bold) **≥ 3:1**, UI component boundaries and meaningful icons **≥ 3:1** ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). Run in light theme everywhere and dark theme on `ipad-l`. |
| **Target size** | Collect visible `a[href], button, input, select, textarea, [role=button\|link\|tab\|checkbox\|switch\|menuitem], [tabindex]:not([tabindex="-1"])`. For each, take the centre of `getBoundingClientRect()` and probe `document.elementFromPoint` at the corners of a 44×44 box (touch) or 24×24 box (desktop). Each in-viewport probe must hit the element or a descendant. This counts padding and `::before` hit-area expansion, and catches neighbours that intrude. axe's `target-size` rule covers the 24px floor. | **Desktop:** 100% pass at 24×24 ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). **Phone and both iPads:** 100% of non-exempt targets pass at 44×44 ([Apple HIG buttons](https://developer.apple.com/design/human-interface-guidelines/buttons); [Vercel guidelines](https://vercel.com/design/guidelines): "on mobile, the minimum size is 44px"). Inline text links and dense calendar slots need an exemption. |
| **Horizontal overflow** | `document.documentElement.scrollWidth - document.documentElement.clientWidth`. Also list offenders: visible elements with `rect.right > innerWidth + 1` or `rect.left < -1` that have no ancestor with `overflow-x: auto\|scroll\|hidden\|clip`. Run with dialogs and sheets open as well. A report-only extra run at 320px width follows [WCAG 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). | **0 px** page overflow and **0** offenders on all devices. Intentional scrollers, such as the tape chart, need `data-ui-exempt="overflow: …"` on the scroll container. |
| **Min font size** | A `TreeWalker(SHOW_TEXT)` over visible, non-whitespace text nodes, reading the parent's computed `font-size`. Also report the number of distinct (size, weight) pairs as a typography fact for the report. | No visible text **< 12px** on any device. Report-only warning for text < 13px on touch devices and for more than 8 distinct size/weight pairs. |
| **Input font size (phone)** | On `phone`, the computed `font-size` of `input` (excluding checkbox, radio, range, color, file and hidden), `textarea`, `select` and `[contenteditable=true]`. iOS Safari zooms when a field's font is under 16px ([Vercel guidelines](https://vercel.com/design/guidelines)). | **100% ≥ 16px** on `phone`. Report-only on iPads. Don't use `maximum-scale=1` as a workaround, because it blocks user zoom. |
| **Clipped or truncated text** | For visible text-bearing elements with `overflow`/`overflow-x`/`overflow-y` set to `hidden` or `clip`, or with `text-overflow: ellipsis` or `-webkit-line-clamp`: flag when `scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1`. Classify a flag as **allowed** only if it's an ellipsis in a list row or table cell *and* the full text is reachable (a `title`, `aria-label`, tooltip trigger, or the detail pane). Also flag **collisions**: two visible text boxes, neither containing the other, whose rects intersect by more than 2px. **Thai/Korean guard:** an element containing `[฀-๿가-힯]` with clipping overflow and `line-height < 1.4 × font-size` is flagged, because Thai marks clip. Run on the long-content state, which uses long Thai and Korean names in the fixtures. | **0** unallowed truncations and **0** collisions. Allowed ellipses are reported as a count. |
| **Layout shift** | Before navigation, in `page.addInitScript`: `new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift', buffered: true })`. Navigate, wait for the network to be idle plus 2s, and read `__cls`. Repeat across each scripted interaction (opening a dialog, applying a filter). Shifts within 500ms of input are excluded by `hadRecentInput` ([web.dev CLS](https://web.dev/articles/cls)). | **≤ 0.1** per state, which is web.dev's "good". Report-only target **≤ 0.05**. Skeleton-to-content swaps should be close to 0, per Vercel's "skeletons mirror final content exactly". |
| **Focus visible** (extra; supports Color & contrast) | On `desktop`, press Tab through the first 15 focusables. For each, compare computed `outline`/`box-shadow` with the unfocused state, and check the indicator's contrast as in the contrast row. | 100% show a visible change of ≥ 2px at ≥ 3:1 ([WCAG 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html); Vercel: "every focusable element shows a visible, unobscured focus ring"). |

Automated tools catch only part of WCAG ([Playwright docs](https://playwright.dev/docs/accessibility-testing)). That's why Color & contrast, Clarity and States & safety still get human-style judgment.

---

## 5. Report format

### 5.1 Per-screen scorecard (user's style: rows are categories, columns are evaluators)

The columns are device × auditor, ordered by width so responsive behaviour reads left to right. ★ marks the primary device.

Display rules:
- Values are 3-run means, so steps of 0.3 (one decimal).
- **Bold** marks a cell below 9.0; **bold with †** marks a cell below the 8.0 floor.

**Chats · wave 1 · gate round · 3 runs · rubric v1 · A and B = independent reviewers**

| Category | Phone · A | Phone · B | iPad P · A | iPad P · B | ★ iPad L · A | ★ iPad L · B | Desktop · A | Desktop · B |
|---|---|---|---|---|---|---|---|---|
| Typography | 9.3 | 9.0 | 9.3 | 9.0 | 9.3 | 9.3 | 9.3 | 9.0 |
| Hierarchy | 9.0 | 9.0 | 9.3 | 9.3 | 9.7 | 9.3 | 9.3 | 9.0 |
| Spacing & density | **8.7** | **8.3** | 9.0 | **8.7** | 9.3 | 9.0 | 9.0 | **8.7** |
| Color & contrast | 9.3 | 9.0 | 9.3 | 9.0 | 9.3 | 9.0 | 9.3 | 9.3 |
| Iconography | 9.0 | 9.3 | 9.0 | 9.0 | 9.0 | 9.0 | 9.3 | 9.0 |
| Consistency & polish | 9.0 | 9.0 | 9.3 | 9.0 | 9.3 | 9.3 | 9.3 | 9.0 |
| Clarity | 9.3 | 9.0 | 9.3 | 9.3 | 9.3 | 9.0 | 9.3 | 9.3 |
| Layout & responsiveness | **8.3** | **7.0 †** | 9.0 | **8.7** | 9.7 | 9.3 | 9.0 | **8.7** |
| Navigation | 9.0 | 9.0 | 9.0 | 9.0 | 9.3 | 9.3 | 9.3 | 9.0 |
| Status at a glance | 9.0 | **8.7** | 9.3 | 9.0 | 9.3 | 9.0 | 9.3 | 9.0 |
| States & safety | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 |
| **Overall** | 9.0 | **8.8** | 9.2 | 9.0 | 9.3 | 9.1 | 9.2 | 9.0 |
| Checks (§4) | pass | pass | pass | pass | pass | pass | pass | pass |
| Open major issues | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Run spread (Overall) | 0.3 | 0.5 | 0.2 | 0.3 | 0.2 | 0.4 | 0.3 | 0.3 |

**Result: FAIL** on Phone · B. Its Overall is 8.8. Layout & responsiveness is 7.0, below the floor, because of major issue O-3: "Detail sheet covers the composer; no visible Back". That issue appeared in 2 of 3 runs, so its runs were capped at 6, 6 and 9. No borderline re-run is triggered, because the floor and the issue gate already fail. Phone · A's mean is exactly 9.00, so it passes with nothing to spare.
**Page-specific (ipad-l):** C1 9 · C2 7 (messaging-window state is a feature gap; not deducted).
**Feature gaps logged:** messaging-window state, ⌘K search.

Below the table, list the merged and deduplicated issues: highest severity first, primary device first, and at most 10 shown.

### 5.2 Section roll-up

Each cell is `A / B` Overall. **Lowest** is the weakest cell and the reason.

**Wave 1 · Daily drivers · gate round 2**

| Screen | Phone | iPad P | ★ iPad L | Desktop | Lowest | Status |
|---|---|---|---|---|---|---|
| Chats | 9.0 / **8.8** | 9.2 / 9.0 | 9.3 / 9.1 | 9.2 / 9.0 | 8.8: phone·B; floor: Layout 7.0; 1 major | FAIL |
| Checkout | 9.1 / 9.0 | 9.3 / 9.2 | 9.5 / 9.3 | 9.3 / 9.1 | 9.0 | PASS → confirm |
| Receipt | not audited | 9.2 / 9.1 | 9.4 / 9.2 | 9.2 / 9.0 | checks: phone overflow 14px | BLOCKED |

Footer line:

> Auditor agreement α = 0.71 · calibration: A OK, B OK (sensitivity probe: contrast-drop caught by both) · pairwise vs best: no regressions · exemptions: 3 (tape-chart overflow, 2 calendar slot targets) · feature gaps: 2

The plan's `index.html` timeline plots each screen's **Lowest** per auditor over rounds. That's the number the gate uses.

### 5.3 JSON the auditors return

Rules for the schema:

- Enforce this output schema for both reviewers.
- It's compatible with OpenAI strict mode: every property is required, `additionalProperties: false`, and ranges are expressed as enums.
- **`issues` comes before `categories`.** Structured outputs follow the schema's key order ([Azure OpenAI structured outputs](https://learn.microsoft.com/en-au/azure/ai-services/openai/how-to/structured-outputs)), so the model writes its findings before any number.
- There's **no `overall` field**.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ui-score/1/audit",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "screen", "device", "observed_states", "issues", "categories", "page_specific", "feature_gaps", "not_observed"],
  "properties": {
    "schema_version": { "type": "string", "enum": ["ui-score/1"] },
    "screen": { "type": "string" },
    "device": { "type": "string", "enum": ["phone", "ipad-p", "ipad-l", "desktop"] },
    "observed_states": {
      "type": "array",
      "items": { "type": "string", "enum": ["default", "empty", "long", "dialog", "error", "dark"] }
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "category", "severity", "screenshot", "where", "observation", "fix", "feature_gap"],
        "properties": {
          "id": { "type": "string", "description": "I1, I2, ... unique within this response" },
          "category": { "$ref": "#/$defs/category" },
          "severity": { "type": "integer", "enum": [1, 2, 3, 4], "description": "NN/g: 1 cosmetic, 2 minor, 3 major, 4 catastrophe" },
          "screenshot": { "type": "string", "description": "exact input filename" },
          "where": { "type": "string", "description": "quoted visible text or element label + region, e.g. \"'Assign' button, top-right of detail pane\"" },
          "observation": { "type": "string", "description": "what is visible, not an adjective" },
          "fix": { "type": "string" },
          "feature_gap": { "type": "boolean" }
        }
      }
    },
    "categories": {
      "type": "array",
      "description": "exactly 11 entries, in rubric order",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "score", "evidence", "screenshots", "blocking_issue_ids"],
        "properties": {
          "id": { "$ref": "#/$defs/category" },
          "score": { "type": "integer", "enum": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
          "evidence": { "type": "string", "description": "observed facts that meet the cited anchor; for 10 also what was checked" },
          "screenshots": { "type": "array", "items": { "type": "string" } },
          "blocking_issue_ids": { "type": "array", "items": { "type": "string" }, "description": "issues preventing the next anchor up; empty only when score = 10" }
        }
      }
    },
    "page_specific": {
      "type": "array",
      "description": "only on ipad-l; empty array on other devices",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "score", "evidence"],
        "properties": {
          "id": { "type": "string", "enum": ["S1", "C1", "C2", "H1", "H2", "B1", "B2", "P1", "P2", "F1", "R1", "L1", "T1"] },
          "score": { "type": "integer", "enum": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
          "evidence": { "type": "string" }
        }
      }
    },
    "feature_gaps": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["pattern", "missing_backend", "screenshot"],
        "properties": {
          "pattern": { "type": "string" },
          "missing_backend": { "type": "string", "description": "the data or mutation that does not exist" },
          "screenshot": { "type": "string" }
        }
      }
    },
    "not_observed": { "type": "array", "items": { "type": "string" }, "description": "anything the rubric asks about that no capture shows" }
  },
  "$defs": {
    "category": {
      "type": "string",
      "enum": ["typography", "hierarchy", "spacing_density", "color_contrast", "iconography", "consistency_polish", "clarity", "layout_responsive", "navigation", "status_glance", "states_safety"]
    }
  }
}
```

**Pairwise response** (`ui-score/1/pairwise`). It's run twice with A and B swapped.

```json
{ "device": "phone", "preferred": "A | B | tie",
  "decisive_differences": [{ "category": "layout_responsive", "better": "A | B", "screenshot": "…", "where": "…" }] }
```

**Orchestrator record** (computed, never written by a judge), one per screen × device × auditor × round:

```json
{ "screen": "chats", "device": "phone", "auditor": "A", "model_id": "record-actual-evaluator-version", "rubric": "v1",
  "runs": 3, "category_means": { "typography": 9.33 }, "clamps": 0, "overall": 9.0, "run_spread": 0.3,
  "checks": { "axe": 0, "contrast": 0, "targets": 0, "overflow": 0, "font_min": 0, "input_16": 0, "truncation": 0, "cls": 0.02, "focus": 0 },
  "calibrated": true, "pairwise_vs_best": "tie", "gate": { "overall": true, "floor": true, "majors": true, "checks": true } }
```

---

## 6. Risks of this metric and mitigations

| Risk | How it shows up | Mitigation |
|---|---|---|
| **Gaming / Goodhart** | The implementer adds what the rubric names (legends, badges, "Saved" toasts, extra labels) without making the screen better. Judges reward surface cues ([One Token to Fool](https://arxiv.org/abs/2507.08794)). Polish also makes things look more usable than they are ([NN/g aesthetic-usability effect](https://www.nngroup.com/articles/aesthetic-usability-effect/)). | <ul><li>Anchors describe outcomes ("state visible without opening"), not artifacts.</li><li>Severity caps mean only fixing issues raises scores.</li><li>Pairwise inflation check.</li><li>Fake affordances are severity 3.</li><li>The rubric is frozen per wave.</li><li>The user reviews the annotated before/after for every wave PR.</li></ul> |
| **False precision of decimals** | 9.0 vs 9.1 read as a real difference. | <ul><li>Judges give integers only. Decimals exist only as 3-run means (steps of 0.33), and a footnote says so.</li><li>Differences under 0.3 are noise unless confirmed by pairwise.</li><li>The borderline band (8.8–8.9) triggers more runs, not a judgment call.</li></ul> |
| **Auditor disagreement** | A passes and B fails, or the reverse, on the same cell. Even expert humans agree only weakly on UI quality (UICrit κ 0.29, UIClip α 0.37). | <ul><li>Both must pass. Disagreements are resolved through *issues* (fix it, or it's not re-reported), never by averaging scores.</li><li>Anchors separate a constant offset from real disagreement.</li><li>α is reported per section, and below 0.667 a user spot check is required.</li></ul> |
| **Self-preference** | A reviewer rates work produced by its own evaluator higher. | Both auditors are required, plus the B-minus-A gap monitor against anchors (§3.8). |
| **Halo / anchoring inside one call** | All 11 categories move together. | <ul><li>Issues come first via schema order.</li><li>Severity caps.</li><li>Flag when the SD across the 11 scores in one response is below 0.3.</li></ul> |
| **Judge blind spots** | Pixel flaws, counts and positions are misjudged (as observed in UIClip). | <ul><li>§4 checks gate those.</li><li>Counts that matter (rows visible, villas visible) belong in §4 or `flow.md` as facts, not judgments.</li><li>Issues are located by quoted text, not boxes.</li><li>The annotation boxes in the plan come from the implementer's selectors.</li></ul> |
| **Screenshot-only blindness** | Hover, focus, motion and keyboard paths are invisible. | <ul><li>`flow.md` describes the interactions.</li><li>The §4 focus check.</li><li>`not_observed` instead of guessing.</li><li>Any state the harness doesn't capture is a harness bug.</li></ul> |
| **Data and clock drift between rounds** | New chats or bookings on shared dev data change the screen independently of the code, which confuses pairwise and trends. | `page.clock.setFixedTime`, plus fixture routes for gate rounds where possible. Record the data snapshot time. |
| **Noise-driven churn** | Single-run scores trigger reverts and plateaus. | Revert and plateau rules use 3-run means, pairwise or resolved-issue counts (§3.3). |
| **Cost and time** | 4 devices × 2 auditors × 3 runs = 24 audit calls per screen per gate round, plus anchors and pairwise. | <ul><li>Working rounds use 1 run, with 3 runs only at gates.</li><li>Pairwise is A-only.</li><li>Phase 1 is A-only, as the plan says.</li><li>Record actual usage per reviewer.</li></ul> |
| **Model swaps mid-wave** | A replacement evaluator changes the score distribution. | Re-baseline anchors before counting its scores, and record `model_id` in every record (the plan already requires this). |

---

## 7. What this changes in the loop plan

These are follow-ups. The plan file isn't edited here.

1. **Add the iPad portrait viewport** (820×1180), so there are 4 devices instead of 3, and **add an error-state capture** per screen.
2. **Capture rules:** viewport screenshots in segments, no `fullPage`; DPR 3 phone and DPR 2 elsewhere; a fixed clock; the touch-emulation self-check.
3. **Neutralise audit input paths** (`round-<n>` leaks the round), lint `flow.md`, and run each reviewer in an isolated, read-only, fresh session with schema validation.
4. **Replace the "Rubric" section** of the plan with this document's §1–§2, and replace the auditor JSON example with §5.3.
5. **Revert and plateau rules** use 3-run means, pairwise and resolved issues, not single-run deltas.
6. **Add the §4 checks** as a Playwright spec (`tests/e2e/ui-gates.spec.ts` or `scripts/ui-loop/checks.ts`) that runs before every audit, and add `@axe-core/playwright`.
7. **Build the calibration set** (8 anchors + 8 degradations) and get the user's sign-off on the agreed scores before wave 0's first gate round.

---

## Sources

**LLM/VLM-as-judge and UI evaluation**
- UICrit (Duan et al., UIST 2024): https://arxiv.org/abs/2407.08850 · https://arxiv.org/html/2407.08850v3
- UIClip (Wu et al., 2024): https://arxiv.org/abs/2404.12500 · https://arxiv.org/html/2404.12500v1
- MLLM as a UI Judge (Luera et al., 2025): https://arxiv.org/abs/2510.08783 · https://arxiv.org/html/2510.08783
- MLLM-as-a-Judge (Chen et al., ICML 2024): https://arxiv.org/abs/2402.04788
- Synthetic Heuristic Evaluation (Zhong, McDonald, Hsieh, 2025): https://arxiv.org/abs/2507.02306
- Prometheus-Vision (Lee et al., 2024): https://arxiv.org/abs/2401.06591 (rubric-conditioned VLM judging; background)
- Judging LLM-as-a-Judge (Zheng et al., NeurIPS 2023): https://arxiv.org/abs/2306.05685 · https://arxiv.org/html/2306.05685v4
- Large Language Models are Inconsistent and Biased Evaluators (Stureborg et al., 2024): https://arxiv.org/abs/2405.01724 · https://arxiv.org/html/2405.01724v1
- Rating Roulette: Self-Inconsistency in LLM-as-a-Judge (Haldar & Hockenmaier, EMNLP Findings 2025): https://arxiv.org/html/2510.27106 · https://aclanthology.org/2025.findings-emnlp.1361
- Pairwise or Pointwise? (Tripathi et al., COLM 2025): https://arxiv.org/abs/2504.14716
- Anchoring Bias in LLM-as-a-Judge Systems (Kapetanovic et al., 2026): https://arxiv.org/abs/2608.25869
- Evaluating Scoring Bias in LLM-as-a-Judge (2025): https://arxiv.org/abs/2506.22316 · https://arxiv.org/html/2506.22316v4
- Grading Scale Impact on LLM-as-a-Judge (Li et al., 2026): https://arxiv.org/html/2601.03444v1
- LLM Evaluators Recognize and Favor Their Own Generations (Panickssery et al., NeurIPS 2024): https://arxiv.org/abs/2404.13076
- Self-Preference Bias in LLM-as-a-Judge (Wataoka et al., 2024): https://arxiv.org/abs/2410.21819
- A Closer Look into Automatic Evaluation Using LLMs (Chiang & Lee, EMNLP Findings 2023): https://arxiv.org/abs/2310.05657
- CheckEval (Lee et al., 2024–25): https://arxiv.org/abs/2403.18771
- One Token to Fool LLM-as-a-Judge (Zhao et al., NeurIPS 2025): https://arxiv.org/abs/2507.08794

**Heuristic evaluation and decision methods**
- NN/g 10 usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- NN/g severity ratings: https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/
- NN/g how to conduct a heuristic evaluation: https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/
- NN/g aesthetic-usability effect: https://www.nngroup.com/articles/aesthetic-usability-effect/
- Dawes 1979, The Robust Beauty of Improper Linear Models: https://www.cmu.edu/dietrich/sds/docs/dawes/the-robust-beauty-of-improper-linear-models-in-decision-making.pdf

**Platform and quality guidance**
- WCAG 2.2 Target Size (Minimum) 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG 2.2 Contrast (Minimum) 1.4.3: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG 2.2 Non-text Contrast 1.4.11: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- WCAG 2.2 Reflow 1.4.10: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- WCAG 2.2 Focus Visible 2.4.7: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- Apple HIG, Buttons (44×44 pt hit region): https://developer.apple.com/design/human-interface-guidelines/buttons
- Android/Material 3 window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/window-size-classes
- Vercel Web Interface Guidelines: https://vercel.com/design/guidelines
- web.dev Cumulative Layout Shift: https://web.dev/articles/cls
- Playwright accessibility testing (axe): https://playwright.dev/docs/accessibility-testing
- axe-core colour-contrast "needs review" behaviour: https://github.com/dequelabs/axe-core/issues/2781 · https://github.com/dequelabs/axe-core/issues/708
- Structured outputs follow schema key order: https://learn.microsoft.com/en-au/azure/ai-services/openai/how-to/structured-outputs
