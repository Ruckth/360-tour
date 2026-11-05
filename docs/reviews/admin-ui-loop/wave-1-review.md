# Admin daily-driver merge review

The user authorized merging the implemented changes on 2026-11-05 after reviewing the unfinished visual gate. This ships responsive navigation and shared controls, chat and business-fact form improvements, checkout keyboard layout, receipt controls, and the audit harness. It does not complete the full admin UI improvement plan.

The eight calibration reference scores are approved; see [approval](./calibration-approval-2026-11-05.md). The round 7 evaluator failed planted-flaw sensitivity on all four device classes. Its screen scores are diagnostic only. The last visual capture (round 8) has 51 states with zero capture errors or deterministic-check failures; it predates the final code-review fixes and is not a confirmation pass.

Code review identified and fixed unresolved chat-villa scoping, cross-model calibration inheritance, and auditing failed checks without an explicit diagnostic flag. Removed the unreachable collapsed-sidebar Search branch and unused checkout-preview display-control prop. Production customer-display controls remain in use.

Remaining visual work: a versioned correction to the evaluator prompt's unsupported check-status assertion, fresh evaluator calibration, chat landscape density, long/error fixtures, real iPhone/iPad Safari checks, pairwise comparison, independent A/B review, unchanged-code confirmation, and later screen waves. None is represented as passed by this merge. The existing frozen reference scores, old evaluator outputs, and gate thresholds were not rewritten.

Local screenshots, raw audits, logs and device strips stay outside version control in `output/ui-loop/`. CI and PR checks record validation of the final merged revision.
