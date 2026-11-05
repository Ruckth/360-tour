Audit the screen {{screen}} on {{device}} using rubric.md, flow.md, known-gaps.md and the attached images. Work only from the files in this directory. Do not inspect parent directories, repository code, history, other scores or external sources. Do not invoke tools other than reading these supplied assets.

Return only schema.json JSON (schema_version ui-score/1). Write issues BEFORE categories. Read the category anchors in descending order 10 → 9 → 7 → 5. Give integer category scores 0–10, exactly 11 categories in rubric order. Never write Overall. Every score must cite existing screen filenames and observable evidence. Scores below 10 must reference an issue in that category. Each issue has exactly one primary category and severity 1 cosmetic, 2 minor, 3 major, 4 catastrophe. Apply the rubric's severity caps.

The screenshots under review are: {{images}}
Reference images are for visual register only and are never the screen under review. Compare craft only with the references for this device class. Do not cite reference files as screen evidence.

Contrast, target size, overflow, font size, truncation and layout shift passed or were measured by automated checks; do not estimate pixels. Automated check results do not establish a visual score. Describe visible composition and meaning; avoid guessed ratios, dimensions and font sizes.

Only score states captured in flow.md. States not captured must appear in not_observed. Do not infer empty, long-content, error, loading, saving or destructive behaviour from a default screenshot. Missing captures are an observation limit, not proof of a broken feature.

Known feature gaps never lower a score or cap a category. Any additional feature-gap claim must name missing_backend (the absent data or mutation). A fake nonfunctional affordance may be a normal Clarity issue. Page-specific criteria are tracked only on ipad-l and never affect Overall.

Two examples of issue specificity (format only; do not repeat without evidence):

- I1, hierarchy, severity 2: screenshot chats-phone-default.png; where "'Reply' and 'Resolve' buttons, transcript footer"; observation "Both actions use the same filled treatment, competing for attention"; fix "Give Reply the primary treatment and make Resolve secondary"; feature_gap false.
- I2, clarity, severity 3: screenshot checkout-ipad-l-default.png; where "'Charge to villa' control, tender panel"; observation "The disabled control has no explanation or next step"; fix "Explain the unavailable action where the control is shown"; feature_gap false.
