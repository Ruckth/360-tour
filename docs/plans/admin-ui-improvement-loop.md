# Admin UI improvement loop

**Status:** planning only; no UI changes or audit scores are delivered by this document. Source findings reflect the 2026-11-04 snapshot and must be rechecked before implementation.

**Goal:** every admin screen scores 9/10 on **phone, iPad portrait, iPad landscape and desktop**. Each round runs implement → screenshot → check → audit.
- **Phase 1:** independent reviewer A audits.
- **Phase 2:** reviewers A and B audit independently, and both must pass.
- **Progress screenshots:** once a section reaches 8/10, every second round produces annotated before/after screenshots for each device.

## Research behind this plan

| Doc | What it settles |
|---|---|
| `docs/research/admin-ui-competitors.md` | Desktop/iPad competitor patterns, page-specific criteria, feature gaps |
| `docs/research/admin-ui-responsive.md` | How the best products adapt each of our screen types to phone / iPad portrait / iPad landscape / desktop, with "9/10 looks like" per device, an anti-pattern list, and about 230 sources |
| `docs/research/ui-scoring-metric.md` | The 11-category scorecard, anchors, gating, judge reliability, deterministic checks, report format, audit JSON schema |
| `docs/research/responsive-standards.md` | Device sizes, Thailand usage data (Oct 2026), breakpoint systems, WCAG 2.2 / Apple / Material thresholds, Playwright measurement |
| `docs/research/admin-responsive-inventory.md` | Today's code, per screen and device, with file:line risks and the shared primitives worth fixing once |
| Local reference board (review artifact, excluded from this merge) | 38 curated references (13 desktop, 9 iPad, 16 phone), labelled **taste** (how it should look) or **pattern** (how it works) |

**Visual benchmark.**
- Taste references come only from design-led products, dated 2024 or later, with populated data, legible text, and no marketing art.
- Each audit call gets 2–3 taste references **for the same device class**.
- "Consistency & polish" and the other visual rows are judged only against taste references.
- Pattern references inform the page-specific criteria and the feature-gap list.

## What the research changed

1. **Every device is scored and gated**, not just iPad landscape. A 9.5 on desktop can't hide a 7 on phone.
2. **The scorecard format:** category rows, one decimal, auditors side by side. It is expanded to device × auditor columns, with 11 categories: 7 visual rows plus 4 UX rows.
3. **Pixel facts are measured by code, not guessed by AI.** Contrast, tap size, overflow, font size, truncation and layout shift are Playwright checks that gate before any judge runs.
4. **Judges are calibrated.**
   - Integers only, with decimals coming from averaging 3 runs.
   - Overall is computed, never written by a judge.
   - Judges are blind to earlier scores.
   - Every round includes known-score anchor screenshots, to catch drift and score inflation.
5. **The biggest current gap is navigation on iPad.** Since #32 (2026-10-31), the sidebar is hidden in a drawer below 1400px. iPad landscape (1180), iPad portrait (820) and common Thai laptops (1366) therefore show no navigation at all. Apple, Google and NN/g all advise against hiding navigation at those widths. This is open decision 2.

## Devices

Thailand context (StatCounter, October 2026, page views): mobile 80%, desktop 17%, tablet 3.5%. Android is 76% of mobile, and the most common phone widths are 360–414. Tablet share is low nationally, but the iPad is the front-desk and POS device here, so it stays primary.

**Judged and gated:** screenshots go to both auditors, and every column must pass.

| Key | Viewport (CSS px) | Emulation | Size class | Expected layout |
|---|---|---|---|---|
| `phone` | **360×800**, DPR 3 | touch, mobile | Compact | One pane; drill-in; bottom tab bar; sheets; primary action pinned or in the top bar |
| `ipad-p` | 820×1180, DPR 2 | touch, mobile | Medium | One main pane plus a side sheet; nav rail |
| `ipad-l` ★ | 1180×820, DPR 2 | touch, mobile | Expanded | Two panes (list + detail, catalog + cart); nav rail or sidebar |
| `desktop` | 1440×900, DPR 2 | mouse | Large | Up to three panes; persistent sidebar; keyboard shortcuts |

The phone is judged at **360**, consistently with the scorecard. It is the narrowest common Thai width, and wider sizes remain covered by automated checks; a pass at one width does not establish correctness at another.

**Checked only by automated checks (not judged):**
- **320×800:** WCAG reflow probe, report-only.
- **440×956:** large iPhone.
- **844×390:** landscape phone, report-only. This is where sticky headers eat the screen.
- **744×1133:** iPad mini, or a narrow iPad window.
- **1366×768:** a common Thai laptop.
- **1920×1080:** wide desktop.

**Breakpoints.** Keep Tailwind's defaults, because they already separate the four judged devices:

| Device | Width (CSS px) | Tailwind range |
|---|---|---|
| Phone | 360 | below `sm` |
| iPad portrait | 820 | `md` |
| iPad landscape | 1180 | `lg` |
| Desktop | 1440 | `xl` |

Use container queries (`@container`) inside panes, so a card reflows to its pane rather than to the window. The custom 1400px sidebar threshold goes away if decision 2 is approved.

**Real Safari pass.** Once per wave, check the iPhone and iPad (Simulator or the resort's own devices) for the things emulation can't show: the keyboard, safe areas and the Safari toolbars.

## Responsive rules every wave follows

These rules come from `admin-ui-responsive.md`. Implementers build to them, and auditors deduct for breaking them.

1. **Navigation changes form; it never disappears.**

   | Device | Navigation |
   |---|---|
   | Phone | Bottom tab bar (proposed: **Chats · Hotel · Spa · Search · Menu**) |
   | iPad, both orientations | Visible icon rail with short labels, expandable to the sidebar |
   | Desktop | Persistent sidebar, collapsible to the rail |

   Menu lists the other sections with the same names and order as the sidebar.
2. **Panes by size.**
   - **Phone:** drill in, and Back keeps your place.
   - **iPad portrait:** one pane plus a side sheet.
   - **iPad landscape:** two panes.
   - **Desktop:** up to three.
   - **On every size:** the open record, the cart and draft replies survive rotation and resizing.
3. **Overlays by size.**
   - **Phone:** a full-screen page or a bottom sheet, never a modal on top of a modal.
   - **iPad and desktop:** a side panel, or a dialog for short confirmations.
   - Dialogs get a height cap and scroll.
4. **Where the primary action goes.**
   - **iPad and desktop:** top right, or the bottom of the side panel.
   - **Phone:** a "+" in the top bar for creating, a pinned bottom bar for a record's next step (e.g. **Charge ฿X**), and Save in the top bar for forms, so the keyboard can't hide it.
5. **Every input has a tap route.** Hover, drag, swipe and long-press may only add speed. Each needs a visible tap path (⋯ menu, Select, a "Reschedule" form). Calendar drags need a confirm step (WCAG 2.5.7).
6. **Same everywhere:** labels, section and field order, status colours, the primary action's label, and what staff can do. Only navigation form, number of panes, density and overflow placement may change.
7. **Phone basics:**
   - text inputs at least 16px (below that, iOS zooms);
   - tap targets at least 44×44 on touch;
   - `dvh` instead of `100vh`;
   - safe-area insets on bottom-pinned bars;
   - the composer and the primary action stay above the keyboard.

## Scope and waves

There are **16 screens** across 4 judged devices: about 64 screen × device cells, each with several states. That's too much for one pass, so the work runs in **waves**. Each wave is one workflow run and one PR, and you review it before the next wave starts.

| Wave | Screens | Why this order |
|---|---|---|
| **0a. Harness + baseline** | No UI changes | Builds the capture harness, deterministic checks and calibration anchors. Delivers the **baseline scorecard for all 16 screens × 4 devices**, so we know where we stand before changing anything. |
| **0b. Responsive shell + shared kit** | Navigation per device, page frame, inputs, buttons, dialogs/sheets, tables, pickers, empty/loading/error states | Every page inherits these. The inventory shows most phone/iPad risks live in shared primitives (below), so fixing them once lifts every screen. |
| 1. Daily drivers | Chats, Checkout (+ receipt, customer display) | Used all day; their quality is the most visible. |
| 2. Scheduling | Hotel bookings, Staff calendar, Roster | The hardest responsive problems: tape chart and day grid on a phone. |
| 3. Records | Staff, Services, Properties (list + detail), Business facts, Leads | List/detail/form patterns that share fixes. |
| 4. Settings | Business, AI assistant, Email, Channels, Admins | Form-heavy, and mostly covered by the 0b kit. |

Each section is capped at **8 rounds per phase** (user decision, 2026-11-04). If it doesn't pass within the cap, the loop stops and reports where it plateaued and why.

### What wave 0b fixes (from the code inventory)

| Primitive | Today | Fix |
|---|---|---|
| Shell (`sidebar.tsx`, `AdminSidebar.tsx`, `AdminShell.tsx`) | Drawer only below 1400px; 40px trigger and rows; no safe-area insets; `min-h-screen` | Navigation per device (rule 1), 44px targets, safe areas, `dvh` |
| Input / Textarea / Select (`ui/input.tsx:10`, `textarea.tsx:10`, `select.tsx:19`) | 14px on every device, so the phone zooms on focus; Select is 36px high | 16px below `md`; 44px high on touch |
| Button (`ui/button.tsx:23`) | 40px default, 36px small; many callers override to 28–36px | 44×44 minimum hit area on coarse pointers, including the overrides |
| Dialog / Sheet (`ui/dialog.tsx`, `sheet.tsx`) | Centred at all widths; no height cap or scroll; ~32px close button; no safe-area insets | Bottom sheet or full screen below `md`; height cap and scroll; 44px close; insets |
| Tables (`admin-bulk.tsx` STACKED_TABLE; Leads, Roster, service matrix) | Leads uses a 640px table, Roster an 896px grid, the services matrix a wide grid, none with a phone form | Reuse STACKED_TABLE for rows on phone; give Roster a per-person week view and the matrix a per-service checklist (in their waves) |
| Pickers, tabs, checkboxes, badges | Day buttons 32–36px, checkboxes 16px, badge remove ~16px, 11px headings | Touch-size hit areas; nothing under 12px |
| DisabledReason / Tooltip | The reason is visible only on hover | Show it on tap, or always |
| Root layout | No `viewport` export, `viewport-fit`, or theme colour | Add a `viewport` export with `viewport-fit=cover` |

The inventory comes from static source inspection. Its per-screen grades are mostly "Usable", but the first real captures in wave 0a are the ground truth.

## Prerequisite: the capture harness (wave 0a)

Today only checkout can be captured without sign-in (`/dev/checkout-preview`, which runs on fixtures).

- **Sign-in:** `scripts/ui-loop/capture.ts` signs in with `@clerk/testing`, using a testing token plus a dedicated dev-instance admin user. It visits each route **read-only** against the shared dev Convex deployment.
- **Frontend only:** the shared deployment must not receive schema or function pushes, so loop rounds change frontend code only. Anything that needs a new query or mutation becomes a backend follow-up.
- **States per screen:**
  - default, empty, long content (long Thai and Korean names), one open dialog or sheet, and an error;
  - on phone, also **keyboard open** where it matters (chat composer, a settings form, cash entry). The proxy is: focus the field and shrink the viewport by the iOS keyboard height; the real Safari pass confirms it;
  - dark theme only for the `ipad-l` default state.

  Where dev data can't produce a state, it comes from a small dev-only fixture route, the way checkout already works.
- **Capture rules:**
  - viewport screenshots only, never full-page; up to 3 scroll segments with overlap;
  - the clock is frozen, so "5m ago" and Today markers don't change between rounds;
  - a self-check confirms `pointer: coarse` on the touch devices.
- **Output:** `output/ui-loop/<section>/round-<n>/<screen>-<device>-<state>.png` plus a neutral `flow.md` describing the interactions captured. Auditors get **copies with neutral filenames** in an isolated temp folder, so the round number never leaks.

## Deterministic checks (gate before any audit)

These run on every screen × device × state; details are in `ui-scoring-metric.md` §4. A failing check blocks that screen's audit until it is fixed. It needs `@axe-core/playwright`.

| Check | Gate |
|---|---|
| axe serious/critical violations | 0 |
| Colour contrast, including a fallback for glass/blur surfaces axe can't measure | Text ≥ 4.5:1, large text ≥ 3:1, UI edges and icons ≥ 3:1 (light; dark on `ipad-l`) |
| Tap target size | 44×44 on phone and iPads; 24×24 on desktop |
| Horizontal page overflow | 0px, with dialogs and sheets open too; intentional scrollers like the tape chart are marked exempt |
| Smallest text | ≥ 12px |
| Phone input font size | ≥ 16px |
| Unallowed truncation / overlapping text, including a Thai-clipping guard | 0 |
| Layout shift | ≤ 0.1 per state |
| Focus visible (desktop) | 100% |

Exemptions are allowed only through a `data-ui-exempt="<check>: <reason>"` attribute in code, and every exemption is listed in the PR.

## The scorecard

The scorecard is defined in `docs/research/ui-scoring-metric.md` and frozen per wave. It **replaces** the 9-criterion rubric in `admin-ui-competitors.md`; all 9 old criteria are absorbed into the rows below.

| # | Category | What it judges |
|---|---|---|
| 1 | Typography | Legible at the device's viewing distance, one small type scale, money/times/counts set for scanning |
| 2 | Hierarchy | Eye lands on title → key data → **one** primary action; secondary actions quieter |
| 3 | Spacing & density | One spacing rhythm; the device shows the working set; finger-sized, separated targets |
| 4 | Color & contrast | Restrained palette where every colour means something; colour never the only signal |
| 5 | Iconography | One icon family, one meaning per icon, labels where meaning isn't universal |
| 6 | Consistency & polish | One finished, calm, premium product; same component looks the same everywhere |
| 7 | Clarity | A new staff member can tell what the screen is for and what each control does, in plain words for non-native English readers |
| 8 | Layout & responsiveness | Designed for this window size, not scaled; nothing cut off; context stays visible while editing |
| 9 | Navigation | Always clear where you are, how to get back and how to reach the next place |
| 10 | Status at a glance | Unpaid, unread, waiting, assigned, arrived and error states visible without opening anything |
| 11 | States & safety | Empty, loading, error, saving and destructive moments tell the truth and protect staff from costly mistakes |
| | **Overall** | Mean of the 11 rows, per device and auditor. Computed, never written by an auditor |

**Scoring rules.**
- Rows are weighted equally.
- Judges give whole numbers against written anchors (5 / 7 / 9 / 10), and every score cites a screenshot.
- Issues are written **before** scores and cap them: a cosmetic issue caps its row at 9, a minor at 8, a major at 6.
- Page-specific criteria (C1–C2, H1–H2, B1–B2, P1–P2, F1, R1, L1, T1, S1) are reported per device with device-specific bars. For example, the inbox needs 6+ rows on phone and 10+ on iPad landscape. These don't gate.

**Pass bar, per screen.** On **every judged device**, for **each gating auditor**:
- Overall ≥ **9.0**;
- every category ≥ **8.0**;
- no open major issue;
- all deterministic checks green.

The pass then has to hold in a **confirmation round**: a fresh capture and fresh audits with no code change in between.

| Phase | Gating auditors | Columns that must pass |
|---|---|---|
| 1 | A | the 4 A columns |
| 2 | A and B | all 8 columns |

**Report format: one scorecard per screen.** Rows are categories, columns are device × auditor, scores have one decimal, and the primary device is starred. Cells below 9.0 are bold; cells below the 8.0 floor are bold with †.

| Category | Phone · A | Phone · B | iPad P · A | iPad P · B | ★ iPad L · A | ★ iPad L · B | Desktop · A | Desktop · B |
|---|---|---|---|---|---|---|---|---|
| Typography … States & safety | | | | | | | | |
| **Overall** | | | | | | | | |
| Checks · open majors · run spread | | | | | | | | |

In phase 1 the B columns are blank. Under each scorecard: the merged, deduplicated issues, highest severity first, at most 10.

**Section roll-up:** one line per screen showing `A / B` Overall for each device, the **lowest** cell and why, and PASS / FAIL / BLOCKED. The `index.html` timeline plots each screen's lowest cell per auditor over rounds, because that is the number the gate uses.

## Making review scores trustworthy

- **Blinding.**
  - Auditors never see previous scores, the round number, the implementer's rationale, or each other's output.
  - Each reviewer runs in a fresh, read-only session with access only to an isolated folder of neutral inputs. Earlier results and repository history must be inaccessible.
- **One call = one screen × one device × one run.** Scoring all four devices in one call would make the phone score anchor on the desktop score.
- **Runs per auditor and device:**

  | Round type | Runs |
  |---|---|
  | Working round | 1 |
  | Gate round (when that auditor's working Overall is ≥ 8.8 on every device) | 3 |
  | Confirmation round | 3 |
  | Unstable result: Overall range > 0.6, or a category range > 2 | 5, using the median |
- **Calibration anchors.**
  - Wave 0a builds a frozen set of 8 anchor screenshots (2 per device) plus 8 deliberately degraded copies. Each degraded copy has one known flaw, such as a contrast drop or a misaligned column.
  - Every round, each auditor also scores one anchor and one degraded copy per device.
  - If an auditor drifts more than 0.5 from the agreed score, or misses the planted flaw, its round is marked **uncalibrated** and can't pass a gate.
  - The agreed anchor scores need your sign-off once, at the end of wave 0a.
- **Reviewer replacement.** Record the evaluator version for every run. A replacement must be calibrated against the frozen anchors before its scores count, followed by a fresh confirmation round.
- **Pairwise check.** Each round, compare against the section's best round, run in both orders. This only flags regressions and inflation; it never decides a pass.
- **Agreement.** The roll-up reports agreement between A and B (Krippendorff's α). If α < 0.67, a section's PASS also needs your spot check of the annotated screenshots.

## The loop (per section)

```
baseline: capture → checks → A audit, all 4 devices      ← round 0, no code changes
phase 1:  repeat ≤8: implementer fixes top issues → typecheck/lint/tests/e2e →
          capture → checks → A audits
          until A passes on every device (gate + confirmation)
phase 2:  repeat ≤8: B + A audit independently → merge/dedupe issues →
          implementer fixes → checks → capture
          until both pass on every device (gate + confirmation)
```

- **Implementer:** assigned separately from reviewer A. Each round fixes the 3–5 highest-severity issues, weakest device first, so score changes trace back to specific edits.
- **Revert:** only when a 3-run mean drops more than 0.5 below the section's best, or a both-orders pairwise loss confirms a regression. Never on a single noisy run.
- **Plateau:** two consecutive rounds that resolve no minor-or-worse issue. The loop stops early and reports the blockers.
- **Feature gaps are logged, not scored.** A new gap claim must name the missing backend data. A placeholder button for a missing feature counts as a major issue. Known gaps:
  - charge to villa/folio;
  - global ⌘K search;
  - per-fact AI on/off, stale flag and gap list;
  - booking → cart prefill;
  - messaging-window state;
  - channel health.

## Annotated progress screenshots

These start once a section's **lowest** device Overall first reaches 8, then come every 2nd round and always on the final round.

- **Device strip** for each key screen: baseline vs current at phone, iPad portrait, iPad landscape and desktop, side by side, so responsive gains are visible in one image.
- **Numbered callouts** on the current screenshots, drawn by Playwright on the bounding boxes of the selectors the implementer changed.
- **Legend:** *#n: what changed → why (category or competitor pattern) → score change on that device*.
- **Output:** `docs/reviews/admin-ui-loop/<section>/round-<n>-<device>.png`, plus an `index.html` timeline per section that plots the lowest cell per auditor.

## Deliverables per wave

- One branch and one PR per wave (`ui-loop/wave-<n>-<name>`), with the scorecards, device strips and score timeline in the PR body.
- The list of exemptions and of deferred backend follow-ups.
- Final confirmation results from both auditors, plus the real-Safari notes.

## Review workload

Four devices multiply the review work compared with a single-device audit. For four screens, a phase-2 working round requires 16 calls per reviewer; a gate or confirmation round requires 48 per reviewer, excluding calibration and pairwise checks. Record actual usage and elapsed time per wave rather than assuming a provider is free.

## Open decisions

1. **Clerk test admin.** A dev-instance test admin user for the harness, created once. Supply credentials through the secure secret workflow and keep them out of version control. This blocks wave 0a.
2. **Navigation per device.**
   - **The proposal:** phone bottom tab bar (Chats · Hotel · Spa · Search · Menu), iPad icon rail in both orientations, and a persistent sidebar from 1280px.
   - **The conflict:** this reverses #32, which hides the sidebar in a drawer below 1400px.
   - **Recommendation:** yes. The drawer leaves the primary device with no visible navigation. This blocks wave 0b.
3. **Wave order:** whether wave 0b ships before wave 1, or together with it.
4. **Feature gaps to build** as separate, non-loop work. Charge to villa/folio is the biggest.
5. **Anchor scores:** a quick approval of the calibration anchor scores at the end of wave 0a.
