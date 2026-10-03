# Concierge model routing

Production rollout: 2026-10-01, deployment `wary-toad-189`.

- `AI_SIMPLE_MODEL=openai/gpt-6-luna`: ordinary questions, basic comparisons, quotes, bookings, and follow-ups.
- `AI_COMPLEX_MODEL=openai/gpt-6.1-sol`: comparison/recommendation/planning requests combining at least three constraint groups: budget, party size, stay duration/dates, villa requirements, and services/activities. Current routing recognizes English, Thai, and Korean patterns. This conservative heuristic does not identify every difficult question; no production traffic frequency has been measured.

Source defaults and `.env.example` match these routes. Environment overrides remain supported. Local and Convex dev complex-model overrides were also updated.

Sol uses OpenRouter's Responses endpoint with low reasoning effort and a 4,096-token budget including reasoning. Encrypted reasoning and function call IDs survive tool rounds in memory; they are not saved as chat content. Existing transaction guards, sequential writes, deadlines, and tool budgets remain in effect. Incomplete or malformed provider output cannot execute tools. Luna continues using its existing Chat Completions configuration.

[Official OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) specifies Responses for Sol tool calling and supports low reasoning effort.

Validation used an isolated checkout of `ae5c123` containing only the model-routing changes, because a separate Q&A retirement change was in progress in the shared workspace. All 78 unit test files / 685 tests passed there, along with type checking and focused lint. The latest focused test run passed 68 tests. A live OpenRouter Sol tool round-trip passed before deployment.

Production smoke checks, with no explicit model override or external message delivery:

| Guest request | Expected and observed model | Verified tools |
| --- | --- | --- |
| Basic villa comparison | Luna | Property list and details |
| Quiet 3-night stay, 4 adults, budget THB 30,000, price and trade-offs | Sol | Two authoritative price calculations |
| Villa amenities follow-up | Luna | Property details |

Full production replies and tool results are in `output/sol-routing-2026-10-01/production-smoke.json` (local, unversioned). These checks verify routing and tool compatibility; they do not establish comparative accuracy or a production routing percentage.
