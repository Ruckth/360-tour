# UX/UI scorecard rubric

Target: every screen scores **9 or 10 in every category**. Score each 1–10, honestly; a 9 means a demanding product designer would ship it with at most a nit.

Context: an admin app for a small Thai villa resort and spa. Staff use it on iPad at the front desk (1180×820), on phones (390×844), and managers on desktop. Money is Thai baht (฿). Design system: Tailwind + shadcn/ui; brand serif for page titles, sans for UI and money; see `docs/reviews/ux-audit/visual-brief.md` for the house rules.

## Categories

1. **Hierarchy** – the one thing that matters on the screen is obvious within a second; primary action is unmistakable; secondary content recedes.
2. **Typography** – coherent scale (label 12 / body 14 / row 15 / hero 28–40), weights used sparingly, money in sans tabular numerals, no truncation or awkward wraps.
3. **Layout & spacing** – consistent rhythm, aligned edges, no dead space or cramming, no element covering another (sticky bars, toasts).
4. **Consistency** – same component for the same job across screens (cards, buttons, chips, segmented controls, sheet headers), same radius and borders.
5. **Color & contrast** – meaning-driven color only (destructive, success, warning), text ≥ 4.5:1 (≥ 3:1 for large), no faint or ambiguous buttons.
6. **Efficiency** – fewest taps for the common task, sensible defaults, no needless confirmation, no hunting.
7. **Clarity** – plain short copy, no jargon or duplicated explanations, labels say what happens, nothing to decode.
8. **States & feedback** – disabled/loading/empty/error/success states are visible and explained where they occur (check the component code for states the screenshot doesn't show).
9. **Responsive** – each viewport is designed for, not squeezed: phone thumb-reachable, iPad uses width well, desktop not stretched.
10. **Accessibility** – touch targets ≥ 44px on touch screens, visible focus, labelled inputs and icon buttons, not colour-only meaning.

## Output format (per screen)

```
### <screen> (<files>)
| Category | Score | Evidence | Fix needed for 9+ |
```
Every score below 9 must name a concrete, buildable fix (component, file, class or copy change). Do not suggest removing money safeguards (approvals, attempt keys, revision checks, permission gates).
