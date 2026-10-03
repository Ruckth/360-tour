# Concierge model routing

Audited: 2026-10-03. Luna remains the default for all concierge requests, including planning with multiple constraints. Constraint count is a routing hint, not evidence that Luna cannot handle the request.

## Configuration

- `AI_SIMPLE_MODEL` defaults to `openai/gpt-6-luna`.
- An absent or blank `AI_COMPLEX_MODEL` follows the effective simple model. `.env.example` explicitly sets both routes to Luna.
- To evaluate Sol, explicitly set `AI_COMPLEX_MODEL=openai/gpt-6.1-sol`. Only then do comparison/recommendation/planning requests matching at least three constraint groups use Sol. The groups are budget, party size, dates/duration, villa requirements, and services/activities; English, Thai, and Korean patterns are recognized.
- Basic questions, quotes, bookings, and simple comparisons use the simple model even when a complex-model override exists. The heuristic is not an exhaustive difficulty classifier.

Existing deployment overrides take precedence over source defaults. Merging this change does not change Convex environment values. To use Luna for every request on an existing deployment, remove the complex override or set it to the chosen simple model. Earlier local rollout notes reported a Sol production override and smoke tests on 2026-10-01; those historical observations are not verification of the current deployment or comparative model accuracy.

## Provider and tool safety

Luna retains Chat Completions with `reasoning_effort: none` and its supported completion limit. Opt-in Sol uses Responses with low reasoning effort and a 4,096-token budget including reasoning. Encrypted reasoning and function call IDs survive tool rounds in memory, without becoming saved chat content. [Official OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-6.1-sol) requires Responses for Sol tool calling; [reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning) describes preserving reasoning items across tool calls.

The provider adapter validates every call in a response batch before returning executable calls: nonempty unique call IDs/names and arguments that parse as JSON objects. Explicitly incomplete/pending Responses items, malformed content or reasoning, unknown item types, and provider failures are rejected. Truncated output cannot execute tools; an initially truncated response fails without another request. A rejected replacement batch carries only recognized preparation names to the responder, which defensively invalidates the old draft without executing any requested tool. This preserves the existing protection against a later yes confirming old dates. Existing server argument/ownership/consent checks, sequential writes, transaction results, deadlines, and tool budgets remain in effect. Writes are not blindly retried or transferred to another model after a failure.

## Audit findings and validation

Standards review found no hard violations of AGENTS.md or Convex guidelines. It identified duplicate provider transport code as a low-priority maintenance heuristic; provider-specific adapters remain separate in this focused change.

Spec review found two issues, fixed here: automatic Sol defaults without comparative accuracy evidence, and incomplete/malformed call batches reaching tools. The full test suite also verified that failed replacement preparations must invalidate old drafts; that safeguard is retained. Regression coverage includes default Luna planning, opt-in Sol, custom simple-model fallback, multilingual routing, Responses reasoning/tool ID replay, whole-batch rejection, pending/incomplete output, provider errors/timeouts, and proposal safety.

Promote Sol only after a paired, labeled accuracy evaluation demonstrates a meaningful improvement on representative planning cases. Compatibility smoke tests and deterministic mocked tests establish neither comparative accuracy nor external messaging delivery.

Validation on Node 22.22.3: typecheck and lint passed; 78 unit-test files / 719 tests passed; the production build passed using the same placeholder Convex/Clerk configuration as CI. Standards and Spec re-reviews found no remaining blocking findings. No new live-model accuracy comparison or external delivery test is claimed.
