# Codebase optimization audit

Independent standards and specification reviews compared implementation snapshot `8e64636` with `ae5c123`. The source specification is [the optimization plan](./codebase-optimization.md), with [AI context retirement](./ai-context-retirement.md) defining the saved-answer behavior. Reviewers inspected a fixed commit rather than a moving working tree. The coordinator reproduced or checked actionable findings, assigned corrections to Kiro and the audit agents, and added integration regressions.

## Standards review

The first review found an in-flight panorama shared across generations could be disposed by a stale prefetch and then returned by navigation. Incoming readiness also inherited the outgoing texture, completing a transition before the requested panorama loaded. Both require resource ownership and room identity tests.

Bulk missing-information resolution bounded each group but not the entire transaction, and filtered property after taking rows. This could falsely report completion and exceed Convex array/read limits. A total transaction budget and property-scoped index are required.

The demo server deleted optional credentials, allowing Next to reload them from local dotenv files; its reusable-build marker was not tied to the build identity. Recovery lacked unmount cancellation. Queued legacy deletion workers and several rejection/property-scope writers bypassed retirement guards. The review also found unused lifecycle helpers whose tests did not exercise the public hook.

No separate documented coding-standard violation was established. The findings concern correctness, lifecycle ownership, bounds, and preserving the specified archive behavior.

## Specification review

The second review independently reproduced the cache race and confirmed transition, recovery, and property-resolution gaps. It also found that the shared messaging timeout began after a preliminary booking query, so a stalled query prevented fallback. Resolver turn IDs did not reach concierge generation and channel delivery metrics.

Reduced-motion users still received an animated poster cycle. The AI-unavailable fallback used web-only booking-card copy on messaging channels and omitted missing-information reporting for unsupported policy questions.

Conditional provider relocation, presence-table splitting, summary tables, durable queues, migrations, and calendar-vendor rewrites were not treated as required work. They remain dependent on representative measurements.

## Fix verification

Final correction status and check results are recorded in [the implementation report](./codebase-optimization-implementation.md). The fix diff was independently re-reviewed with no remaining blocking findings. Final validation passes: all typechecks, lint, 94 unit files/889 tests, the production build, and 63 disconnected browser tests. The concurrent `main` merge received a semantic review preserving the newer provider/model safety and optional guest-service behavior. An actual LINE handler regression additionally caught privacy scrubbing of UUID digits; generated turn IDs now preserve correlation without weakening the scrubber. Representative production costs and live integration remain unmeasured.
