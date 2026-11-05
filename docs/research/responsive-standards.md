# Responsive admin: device matrix and measurable standards

Research/access date: **2026-11-04** for every linked source below. Market periods are stated separately. Dimensions are **width × height**. Recommendations are explicitly labeled; they are engineering choices informed by the cited facts, not standards requirements.

## 1. Device inventory and screenshot matrix

**Use CSS pixels for browser tests, not panel pixels.** The Apple sizes below are nominal full-screen logical canvases at default display scaling, useful as fixed Playwright viewport inputs. They are **not measured Safari content heights**: toolbars, keyboard, zoom, safe areas and windowing change the available space. Include `width=device-width, initial-scale=1`; without a mobile viewport declaration a browser can use a much wider virtual viewport. [MDN viewport](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), [MDN visual versus layout viewport](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API).

| Device / current status | Portrait CSS canvas | Landscape CSS canvas | Evidence / uncertainty |
|---|---:|---:|---|
| iPhone 17, current base model in Apple's Thai store | 402 × 874 | 874 × 402 | [Apple HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications); panel 1206 × 2622 in [Apple specs](https://www.apple.com/iphone-17/specs/). |
| iPhone 18 Pro Max, current Pro Max | **440 × 956 provisional proxy** | **956 × 440 provisional proxy** | Apple confirms the **1320 × 2868** panel in [current specs](https://www.apple.com/iphone-18-pro/specs/). These proposed CSS canvases reuse the earlier **iPhone 17 Pro Max** logical dimensions from [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications), whose panel dimensions match. **Inference only:** current-model CSS dimensions/DPR were not independently measured or confirmed by a current primary logical-size table. |
| iPhone SE, legacy only | 375 × 667 | 667 × 375 | The 4.7-inch SE appears in [Apple's earlier HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications); no SE in the [current Thai Apple sales lineup](https://www.apple.com/th/shop/buy-iphone). Reseller stock is not assessed. |
| iPad (A16; requested 11th generation) | 820 × 1180 | 1180 × 820 | [Apple HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications), [Apple A16 panel specs](https://www.apple.com/ipad-11/specs/). |
| iPad Air 11-inch / 13-inch (current M4) | 820 × 1180 / 1024 × 1366 | 1180 × 820 / 1366 × 1024 | [Apple HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications); current chip and unchanged panel dimensions: [Apple Air specs](https://www.apple.com/ipad-air/specs/). |
| iPad mini 7 / A17 Pro, requested legacy model | 744 × 1133 | 1133 × 744 | [Apple HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications), [Apple A17 Pro specs](https://support.apple.com/en-us/121456). |
| iPad Pro 11-inch / 13-inch (current M5) | 834 × 1210 / 1032 × 1376 | 1210 × 834 / 1376 × 1032 | [Apple HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications), [current Apple Pro panel specs](https://www.apple.com/ipad-pro/specs/). |

**Source limitation:** Apple's device-dimensions table was available in the search index when accessed, but is absent from the current Markdown version of the HIG page. Treat those rows as earlier Apple logical-size references, cross-checked against the linked current panel specifications; do not describe them as freshly measured browser viewports. The current [iPad mini specs](https://www.apple.com/ipad-mini/specs/) now describe **A20 Pro, 1512 × 2316 panel pixels**, so the requested mini 7 is no longer the latest model. A verified CSS viewport for that replacement was not established here; physical resolution alone is insufficient to assert it.

| Other coverage | Defensible reference dimensions / widths | Interpretation |
|---|---|---|
| Common Android-sized phones | 360 × 800, 384 × 832, 385 × 854 | Prominent Thailand mobile resolution buckets in §2. The dataset does not identify an OS for each resolution; use these as Android-sized browser probes, **not proven Android-only counts**. [StatCounter mobile](https://gs.statcounter.com/screen-resolution-stats/mobile/thailand/#monthly-202610-202610-bar). |
| Laptop / desktop | 1280 × 720, 1366 × 768, 1536 × 864, 1600 × 900, 1920 × 1080 | Thailand desktop resolution buckets in §2. Screen resolution is not browser content size; window size, OS scaling and browser chrome can reduce it. [StatCounter desktop](https://gs.statcounter.com/screen-resolution-stats/desktop/thailand/#monthly-202610-202610-bar), [MDN viewport](https://developer.mozilla.org/en-US/docs/Web/CSS/CSSOM_view/Viewport_concepts). |
| Historical iPad Split View / Slide Over | Narrow: 320 or 375 wide; portrait larger split: 438 or 639; landscape half: 507 or 678; landscape larger split: 694 or 981 | Firsthand web-viewport reference, last updated **2022-09-07**: [Firt mobile viewports](https://firt.dev/notes/viewports/). These describe earlier devices/configurations, **not guaranteed widths for today's listed iPads**. |
| Current iPad windowing / Stage Manager | No single universal CSS width | Apple documents freely resized, overlapped windows and tiling. Test the actual available window width, including narrow windows; record `innerWidth`, `innerHeight` and `visualViewport` on staff hardware. [Apple Stage Manager](https://support.apple.com/en-gb/guide/ipad/ipad1240f36f/ipados), [Apple windowing features](https://www.apple.com/sg/os/pdf/All_New_Features_iPadOS_26_Sept_2025.pdf), [Apple layout](https://developer.apple.com/design/human-interface-guidelines/layout). |

**Recommended minimal fixed screenshot matrix — seven viewports.** Heights are repeatable test canvases, not promises about browser chrome. This samples the reflow floor, narrow and wide phones, front-desk tablet orientations, a constrained owner laptop and a large desktop. The complete inventory above remains useful for device-specific regressions.

| CSS viewport | Why this baseline |
|---:|---|
| 320 × 800 | Synthetic reflow probe: width required by [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html); test height chosen to match the narrow-phone canvas below. Also exercises historical narrow iPad windows. |
| 360 × 800 | Common narrow mobile bucket in [Thailand data](https://gs.statcounter.com/screen-resolution-stats/mobile/thailand/#monthly-202610-202610-bar). |
| 440 × 956 | Wider-phone canvas from Apple's earlier iPhone 17 Pro Max dimensions; provisional proxy for the current model, as qualified above. [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications). |
| 820 × 1180 | A16 / Air portrait and a leading Thai tablet bucket. [Apple specs](https://www.apple.com/ipad-11/specs/), [Thai tablet data](https://gs.statcounter.com/screen-resolution-stats/tablet/thailand/#monthly-202610-202610-bar). |
| 1180 × 820 | The same front-desk iPad rotated; helps expose POS/calendar height constraints. [Apple HIG dimensions](https://developer.apple.com/design/human-interface-guidelines/layout#Specifications). |
| 1366 × 768 | Constrained laptop canvas using a common Thai desktop resolution. [StatCounter desktop](https://gs.statcounter.com/screen-resolution-stats/desktop/thailand/#monthly-202610-202610-bar). |
| 1920 × 1080 | Leading Thai desktop screen bucket; checks wide tables and calendars. [StatCounter desktop](https://gs.statcounter.com/screen-resolution-stats/desktop/thailand/#monthly-202610-202610-bar). |

Recommendation: supplement these screenshot baselines with numeric checks across the other device sizes above and around each breakpoint in §3. The minimal matrix does not claim to emulate every phone, every iPad window, or actual Safari chrome. Add a real Safari check in both orientations on the resort's iPad and phone; browser emulation cannot establish their actual browser UI/keyboard behavior. [Playwright emulation scope](https://playwright.dev/docs/emulation).

## 2. Thailand market evidence

The latest **complete calendar month retrieved was October 2026**. The pages initially returned mixed cached months; the following values use responses explicitly labeled October, not the URL fragment as evidence of the period. These are **web-usage/page-view shares**, not device ownership, sales, staff inventory or unique-user shares. [StatCounter methodology](https://gs.statcounter.com/faq#methodology).

| Population / period | Observed shares | Source |
|---|---|---|
| All device platforms, Thailand, October 2026 | Mobile **79.72%**; desktop **16.81%**; tablet **3.47%** | [StatCounter device platforms](https://gs.statcounter.com/platform-market-share/desktop-mobile-tablet/thailand/#monthly-202610-202610-bar) |
| Mobile OS, Thailand, October 2026 | Android **75.65%**; iOS **24.31%** | [StatCounter mobile OS](https://gs.statcounter.com/os-market-share/mobile/thailand/#monthly-202610-202610-bar) |
| Mobile screen resolutions, Thailand, October 2026 | **414 × 896: 14.09%**; **360 × 800: 10.49%**; **384 × 832: 7.83%**; **390 × 844: 6.05%**; **385 × 854: 4.62%**; **360 × 802: 3.40%** | [StatCounter mobile resolutions](https://gs.statcounter.com/screen-resolution-stats/mobile/thailand/#monthly-202610-202610-bar) |
| Tablet screen resolutions, Thailand, October 2026 | **820 × 1180: 6.41%**; **601 × 1007: 5.03%**; **810 × 1080: 4.74%**; **1180 × 688: 4.37%**; **768 × 1024: 4.12%**; **1280 × 800: 2.74%** | [StatCounter tablet resolutions](https://gs.statcounter.com/screen-resolution-stats/tablet/thailand/#monthly-202610-202610-bar) |
| Desktop screen resolutions, Thailand, October 2026 | **1920 × 1080: 26.84%**; **1536 × 864: 10.86%**; **1366 × 768: 7.42%**; **800 × 600: 4.91%**; **1280 × 720: 3.76%**; **1600 × 900: 3.03%** | [StatCounter desktop resolutions](https://gs.statcounter.com/screen-resolution-stats/desktop/thailand/#monthly-202610-202610-bar) |

**Caveats:** StatCounter samples traffic to sites using its analytics, identifies platforms through browser information, removes detected bots, and does not artificially weight the sample. Laptops are included in desktop. Its published FAQ permits revisions for **45 days** after publication; this month's values are therefore provisional. A current Thailand/tablet-specific sample count and confidence interval were not supplied on the retrieved result pages. Do not infer model counts or exact CSS content viewport sizes from resolution buckets, particularly the unusual tablet heights; the collection/environment effect was not independently resolved. The resort's known iPad/POS workflows justify tablet coverage despite the lower national tablet share. [StatCounter methodology, platform definitions and revision policy](https://gs.statcounter.com/faq).

## 3. Layout systems and recommended mapping

All sources in this section accessed **2026-11-04**. Native **dp** and **pt** are logical platform units; the proposed web mapping below deliberately reuses numeric thresholds in **CSS px**, not physical pixels or a universal unit conversion.

| System | Published width thresholds | Meaning for this app |
|---|---|---|
| Material-derived Android window classes | Compact **<600 dp**; medium **600–<840 dp**; expanded **840–<1200 dp**; large **1200–<1600 dp**; extra-large **≥1600 dp** | Classify the available app window, not hardware. Google's documentation distinguishes the original Material compact/medium/expanded classes from the added large/extra-large classes. [Google window classes](https://developer.android.com/develop/ui/views/layout/use-window-size-classes). |
| Apple HIG | Horizontal and vertical classes independently **compact / regular**; no universal CSS breakpoint table | Full-screen iPads traditionally regular/regular; iPhone portrait compact/regular. Apple's earlier table gives base iPhone 17 landscape compact/compact and Pro Max landscape regular/compact. Multitasking can produce every combination, so these native traits must not be inferred from a web user agent. [Apple layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Apple adaptivity](https://developer.apple.com/library/archive/featuredarticles/ViewControllerPGforiPhoneOS/TheAdaptiveModel.html). Earlier model examples have the source limitation noted in §1. |
| Tailwind CSS v4 viewport variants | `sm` **40rem / 640px**; `md` **48rem / 768px**; `lg` **64rem / 1024px**; `xl` **80rem / 1280px**; `2xl` **96rem / 1536px** | Mobile-first minimum-width queries; unprefixed styles apply below the first breakpoint too. Pixel equivalents assume the default initial font size. [Tailwind responsive design](https://tailwindcss.com/docs/responsive-design). |

**Tailwind container queries are a separate scale.** Mark a parent `@container`; `@md:` queries its inline width, whereas `md:` queries the viewport. Defaults: `@3xs` **16rem/256px**, `@2xs` **18rem/288px**, `@xs` **20rem/320px**, `@sm` **24rem/384px**, `@md` **28rem/448px**, `@lg` **32rem/512px**, `@xl` **36rem/576px**, `@2xl` **42rem/672px**, `@3xl` **48rem/768px**, `@4xl` **56rem/896px**, `@5xl` **64rem/1024px**, `@6xl` **72rem/1152px**, `@7xl` **80rem/1280px**. Use these for cards/forms within a pane. [Tailwind default theme source](https://github.com/tailwindlabs/tailwindcss/blob/v4.1.0/packages/tailwindcss/theme.css), [container-query syntax](https://tailwindcss.com/docs/responsive-design#container-queries).

| Canonical layout | Published behavior | Recommended application, not a standard |
|---|---|---|
| List-detail | Expanded space can show list and detail together; compact/medium show one with navigation between them, preserving selection across resizing. | Inbox conversations and records. |
| Supporting pane | Main task plus related secondary content; collapse/reposition the secondary pane when space is insufficient. | POS product selection plus basket; booking calendar plus booking editor. |
| Feed | Equivalent items arranged in an adaptive grid/list. | Product tiles and overview cards. |

Source for these patterns: [Google canonical layouts, derived from Material guidance](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts). Their use in the resort admin is a recommendation.

**Recommended single app scheme:** adopt the Material-derived widths below as named Tailwind viewport variants, leaving its standard variants available for small component adjustments. These exact choices are a proposed project policy, not externally mandated web breakpoints. Use the **content container's** available width before exposing multiple panes; a sidebar consumes room. [Google class thresholds](https://developer.android.com/develop/ui/views/layout/use-window-size-classes), [Tailwind custom breakpoints](https://tailwindcss.com/docs/responsive-design#using-custom-breakpoints).

| Available width, CSS px | Recommended behavior |
|---:|---|
| <600 | Single task pane; explicit navigation between list/detail and product/basket. |
| 600–<840 | Roomier single pane; secondary content remains reachable through navigation/sheets. |
| 840–<1200 | Permit list-detail or supporting panes when content fits; compact navigation. |
| 1200–<1600 | Persistent navigation and primary/supporting panes when they fit. |
| ≥1600 | Wider working area; optional inspector, with readable form widths. |

```css
/* Proposed app variants; rem equivalents use a 16px initial font size. */
@theme {
  --breakpoint-medium: 37.5rem;    /* 600px */
  --breakpoint-expanded: 52.5rem;  /* 840px */
  --breakpoint-large: 75rem;       /* 1200px */
  --breakpoint-wide: 100rem;       /* 1600px */
}
```

Recommendation: check immediately below, at, and above each threshold, in addition to §1 snapshots. Keep selected records, baskets and unsaved edits through resizing. Check short landscape windows separately: Google also defines compact height as **<480 dp**, and warns width alone can suggest impractical multiple panes. [Google width/height classes](https://developer.android.com/develop/ui/views/layout/use-window-size-classes).

## 4. Hard thresholds and browser behavior

All sources in this section accessed **2026-11-04**. The WCAG rows are requirements for **WCAG 2.2 AA** conformance, subject to their stated exceptions; the platform and project recommendations are separate. The normative source is [WCAG 2.2](https://www.w3.org/TR/WCAG22/); linked Understanding pages explain each criterion.

| Criterion | Numeric or behavioral requirement | Responsive admin check |
|---|---|---|
| **1.4.10 Reflow, AA** | Vertically scrolling content must retain information/function at **320 CSS px** width without two-dimensional scrolling; horizontally flowing content at **256 CSS px** height. **1280 CSS px at 400% zoom** is the width-equivalent example. | No page-level sideways scrolling for ordinary UI. Necessary two-dimensional content, including data tables, may have a scoped exception; a booking calendar needs a documented necessity assessment, not an automatic exemption for the entire screen. [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). |
| **1.4.4 Resize text, AA** | Text can resize up to **200%**, without assistive technology or loss of content/function; captions and images of text excepted. | Check labels, totals, dialogs and error text under browser zoom/text resizing. [Resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html). |
| **1.4.12 Text spacing, AA** | No loss when users simultaneously set line height **1.5×** font size, paragraph spacing **2×**, letter spacing **0.12×**, word spacing **0.16×**. | Override styles and inspect clipping/overlap. These are tolerances, not required default typography; apply the criterion's language/script exception where a property is not used, including assessment of Thai text. [Text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html). |
| **1.3.4 Orientation, AA** | View and operation cannot be restricted to a single orientation unless essential. | Complete checkout and booking edits in portrait and landscape. [Orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html). |
| **2.5.7 Dragging movements, AA** | Drag-operated functionality must have a single-pointer alternative without dragging, unless essential or an unmodified user-agent function. | Calendar rescheduling needs a tap/click edit alternative; keyboard support alone does not satisfy this pointer criterion. [Dragging](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html). |
| **2.5.8 Target size (minimum), AA** | Pointer target **≥24×24 CSS px**, or an applicable exception. Spacing exception: a **24 CSS px diameter circle** centered on each undersized target's bounding box must not intersect another target or another undersized target's circle. | This is **not** a universal edge-to-edge gap rule. Other exceptions: equivalent compliant control on the same page, inline target, unmodified user-agent control, essential/legally required presentation. [Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). |
| **2.4.11 Focus not obscured (minimum), AA** | A component receiving keyboard focus must not be entirely hidden by author-created content; criterion includes user-movable/user-opened content qualifications. | Tab through sticky bars, sheets and checkout summaries; partial visibility meets this minimum, though full visibility is preferable. [Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). |
| **1.4.3 Contrast (minimum), AA** | Text **≥4.5:1**; large text **≥3:1**. Large means **≥18pt** regular or **≥14pt** bold; equivalents **24 CSS px** and approximately **18.67 CSS px**, respectively, by CSS unit conversion. Inactive/incidental text and logotypes have exceptions. | Include placeholder, error and selected-state text; do not round a failing ratio upward. [Text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [CSS absolute units](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length#absolute_length_units). |
| **1.4.11 Non-text contrast, AA** | Necessary component/state cues and meaningful graphic parts **≥3:1** against adjacent colors; inactive, unmodified user-agent and essential-presentation exceptions apply as specified. | Check identifying icons, required input boundaries and meaningful calendar cues. Decorative boundaries do not all require this ratio. [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). |

| Platform guidance / browser fact | Evidence and project interpretation |
|---|---|
| Apple **44×44 pt** | Apple's button HIG gives this as the general minimum hit region; its design tips explicitly call it a minimum. **Qualification:** the current accessibility HIG also lists **44×44 pt default / 28×28 pt minimum control size**, so “every Apple control has an unconditional minimum of 44” overstates the current guidance. Use the general button hit-region recommendation here. [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [design tips](https://developer.apple.com/design/tips/), [current accessibility table](https://developer.apple.com/design/human-interface-guidelines/accessibility). |
| Material **48×48 dp** | Minimum touch target recommendation; the drawn icon may be smaller when its clickable padding is included. [Google Material accessibility defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults). |
| **Recommended app threshold: 48×48 CSS px** | Adopt for standalone staff controls, including POS actions, across touch and mouse layouts; review inline text links separately. This is a web project policy inspired by Material and exceeding the WCAG size floor, **not** a claim that CSS px, native pt and dp are interchangeable. [Material guidance](https://developer.android.com/develop/ui/compose/accessibility/api-defaults), [WCAG floor/exceptions](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). |
| iOS focus zoom and **16 CSS px** input font | WebKit's focus-zoom implementation uses a standard font size of **16**, dividing it by the focused font size when scaling is allowed. This supports the familiar below-**16px** zoom behavior at ordinary page scale. It is a browser heuristic, **not a WCAG rule or unconditional guarantee** across scale/settings/releases. Proposed policy: editable text controls at least **16px** computed font size; confirm with real iPhone Safari. Do not disable user zoom to work around it. [WebKit source, `_zoomToFocusRect`](https://github.com/WebKit/WebKit/blob/ce830ac05b0ae7e9a5f70302395d68cae40a673b/Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm#L1824), [MDN viewport accessibility](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#accessibility). |
| `svh`, `lvh`, `dvh` | Small viewport follows expanded browser chrome; large follows retracted chrome; dynamic follows the changing viewport. **100** of each unit represents that viewport's full height. `vh` is currently equivalent to `lvh` in browsers. `dvh` can resize while scrolling; it does not by itself prove keyboard clearance. [MDN viewport units](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length#relative_length_units_based_on_viewport), [visual viewport and keyboard](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport). |
| `env(safe-area-inset-*)` | Use top/right/bottom/left insets with `viewport-fit=cover`; preserve ordinary padding as well. Safe-area values are dynamic and are **not fixed device constants or universal keyboard heights**. [WebKit safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/), [MDN visual viewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport). |
| iPad Safari desktop requests | Since desktop-class browsing, iPad Safari generally presents a macOS-style user agent. WebKit's original documentation includes mini and narrow-window exceptions, and resize-versus-reload behavior. A desktop UA therefore does **not** establish mouse input or a desktop-sized content viewport. Use responsive layout and feature detection; inspect actual current staff devices/settings instead of assuming historical exception behavior is unchanged. [WebKit desktop browsing](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/). |
| Touch versus mouse queries | `pointer: coarse` tests primary pointer accuracy; `hover` tests the primary input's hover ability. `any-hover: hover` means **an available input** can hover; `any-pointer: coarse` can remain true alongside a fine pointer. An iPad with trackpad is a mixed-input case. Keep required actions reachable without hover. [MDN pointer](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/pointer), [hover](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/hover), [any-hover](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/any-hover), [any-pointer](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/any-pointer). |

Illustrative CSS; numbers below reuse the cited app policies and viewport-unit definitions, rather than introducing new standards:

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover">
```
```css
.admin-shell { min-height: 100svh; }
.task-dialog { max-height: 100dvh; overflow: auto; }
.bottom-actions { padding-bottom: env(safe-area-inset-bottom, 0px); }
.staff-control { min-width: 48px; min-height: 48px; }
input, textarea, select { font-size: max(1rem, 16px); }
@media (any-hover: hover) { .staff-control:hover { text-decoration: underline; } }
/* Optional adaptations; do not make controls smaller merely because a mouse exists. */
@media (pointer: coarse), (any-pointer: coarse) {
  .staff-control { min-width: 48px; min-height: 48px; }
}
```

## 5. Automated measurement with Playwright

All sources in this section accessed **2026-11-04**. These are implementation examples for the future test harness; they were **not run against this app**.

| Check / tool | Supported use and limitation |
|---|---|
| `@axe-core/playwright`: **`target-size`** | Checks WCAG target size/spacing, not the proposed larger staff-control policy. Verified in **axe-core 4.11**; its rule definition has `enabled: false`, so explicitly enable it and pin/log the installed version. [Deque rule](https://dequeuniversity.com/rules/axe/4.11/target-size), [versioned rule source](https://raw.githubusercontent.com/dequelabs/axe-core/v4.11.0/lib/rules/target-size.json). |
| **`color-contrast`** | Text-contrast rule for SC 1.4.3. Review `incomplete` results; a clean scan does not establish non-text contrast or all WCAG requirements. [Deque contrast rule](https://dequeuniversity.com/rules/axe/4.11/color-contrast), [Playwright accessibility limitations](https://playwright.dev/docs/accessibility-testing). |
| Document horizontal overflow | Compare document `scrollWidth` to `clientWidth`; this detects excess scrollable width, not hidden clipping or correctness of intentionally scrolling subregions. Scope approved two-dimensional regions separately. [MDN `scrollWidth`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth). |
| Small interactive controls | `getBoundingClientRect()` returns CSS border-box dimensions. A selector-based listing is a **triage tool**, not a WCAG verdict: labels/wrappers, inline exceptions, occlusion, custom hit areas, shadow DOM and frames need attention. [MDN rectangles](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect), [WCAG target exceptions](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). |
| Lighthouse / CI | Useful supplementary automated accessibility/performance audits. Its accessibility score excludes manual checks and is not a conformance certificate. Do not substitute the legacy Lighthouse tap-target audit's heuristics for WCAG or the app policy. [Lighthouse scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring), [legacy tap-target audit](https://developer.chrome.com/docs/lighthouse/seo/tap-targets). |

Run the following after authentication and rendering the chosen route/state at a §1 viewport. `.options()` replaces other configured options, so specify filtering and rule enablement together. [AxeBuilder API](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md), [axe run options](https://github.com/dequelabs/axe-core/blob/v4.11.0/doc/API.md#options-parameter).

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

// `page` is an authenticated Playwright Page at the selected fixed viewport.
const audit = await new AxeBuilder({ page }).options({
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  },
  rules: { 'target-size': { enabled: true } },
}).analyze();
expect(audit.violations).toEqual([]);
console.log('Needs review:', audit.incomplete);
// For a focused diagnostic instead: options({
//   runOnly: { type: 'rule', values: ['target-size', 'color-contrast'] },
//   rules: { 'target-size': { enabled: true } },
// })

const horizontalExcess = await page.evaluate(() => {
  const root = document.documentElement;
  return Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0)
    - root.clientWidth;
});
expect(horizontalExcess).toBeLessThanOrEqual(0); // Proposed strict shell policy.

const smallControls = await page.evaluate((minimum) => {
  const selector = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    'summary', '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[tabindex]',
  ].join(',');
  return [...document.querySelectorAll<HTMLElement>(selector)].flatMap(el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (el.closest('[hidden], [inert]') || s.visibility !== 'visible' ||
        s.display === 'none' || !r.width || !r.height) return [];
    return r.width < minimum || r.height < minimum ? [{
      tag: el.tagName, id: el.id,
      name: el.getAttribute('aria-label') ?? el.textContent?.trim(),
      width: r.width, height: r.height,
    }] : [];
  });
}, 48); // App policy; 24 measures only the WCAG size branch, not its exceptions.
console.table(smallControls);
```

**Recommended execution coverage:** run numeric checks on every matrix size and breakpoint boundary; scan open menus, dialogs, validation messages and checkout states as well as initial pages. Use Chromium and WebKit projects, with touch enabled where appropriate, and Firefox for desktop coverage. Playwright can emulate viewport, screen, DPR, touch and user agent; these are browser-context settings, not real Safari chrome/keyboard or hardware validation. [Playwright emulation](https://playwright.dev/docs/emulation), [state-specific accessibility scans](https://playwright.dev/docs/accessibility-testing).

**Still requires interaction/manual review:** browser **200%** text resizing and **400%** reflow equivalence, text-spacing overrides, orientation, drag alternatives, focus behind sticky overlays, meaningful graphics contrast and real Safari keyboard/safe-area behavior. `deviceScaleFactor` changes pixel density; it is not a replacement for browser zoom. A narrow screenshot and an axe pass cannot alone establish these criteria. [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html), [Playwright emulation](https://playwright.dev/docs/emulation).

## 10-line summary

1. Use the seven fixed CSS canvases in §1; their heights are test inputs, not measured Safari content heights.
2. Current base iPhone is 17; Pro Max is 18 Pro Max; its CSS dimensions remain provisional; SE is legacy (§1).
3. Include every requested iPad model in extended coverage; mini 7 is now a legacy model (§1).
4. Treat historical Split View widths as probes; current resizable iPad windows require actual measurements (§1).
5. Thailand October 2026 usage: mobile 79.72%, desktop 16.81%, tablet 3.47%; provisional [StatCounter data](https://gs.statcounter.com/platform-market-share/desktop-mobile-tablet/thailand/#monthly-202610-202610-bar).
6. Mobile OS usage: Android 75.65%, iOS 24.31%; [StatCounter](https://gs.statcounter.com/os-market-share/mobile/thailand/#monthly-202610-202610-bar).
7. Proposed layout thresholds are 600/840/1200/1600 CSS px, adapted from [Google classes](https://developer.android.com/develop/ui/views/layout/use-window-size-classes).
8. Gate reflow at 320 CSS px and text resizing at 200%; [WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [Resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html).
9. WCAG target floor is 24×24 CSS px with exceptions; proposed staff-control policy is 48×48 CSS px (§4).
10. Enable axe target-size explicitly, audit text contrast/overflow/control sizes, and retain real-device/manual checks (§5).
