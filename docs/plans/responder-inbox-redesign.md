# Calm inbox implementation

Implemented on `codex/calm-inbox` in a separate worktree. Research and design alternatives are recorded in [the research note](../research/responder-inbox-redesign.md). The standalone reference preview at `/prototypes/responder-inbox.html?variant=A` also supports variants B and C with simulated data.

## Responder workflow

- **Waiting** shows open conversations that need a staff reply. **Open** shows all open conversations. **Done** combines resolved and archived conversations.
- Search stays visible. Activity, channel, date, empty-chat and detailed status filters live in the filter popover. Existing filter URLs continue to work.
- The two-pane workspace prioritizes the queue, transcript and composer. The setup banner and permanent shortcut strip are removed from the inbox.
- The header shows the guest, channel and property, with one Resolve or Reopen action. Archive and AI ownership controls live in More. Contact, presence, identifiers and delivery diagnostics remain accessible in the details drawer.
- Drafts and reply feedback are scoped to each conversation. Sending from Waiting moves the conversation to Open; resolving or archiving selects the next conversation on desktop. Mobile closes the conversation and returns to the queue.
- Reply availability comes from the backend. A closed messaging window replaces the composer with an explanation. Reopen changes the work status without changing channel restrictions.
- Existing links from staff alerts and Missing Information open the selected conversation in its appropriate queue. The transcript action adds a Business Fact using the current admin workflow.
- Pagination is shown only when needed. A filtered cursor page with no matches offers navigation to older conversations instead of claiming the entire queue is empty.

## Implementation boundaries

The existing Convex queries, permissions, delivery workflow and transcript pagination remain in use. `adminChat.listSessions` accepts `adminStatus: "done"` and applies it to the existing bounded filter scan; no schema migration is needed. The reply route now accepts `PUBLIC_CONVEX_URL` as a fallback, matching the application's configuration.

## Verification — 2026-10-03

- Full unit suite: 99 files, 954 tests passed.
- Type checking, full ESLint and production build passed (147 generated pages).
- Authenticated browser checks: separate drafts, successful Web reply, retained draft on send failure, AI pause after staff reply, Resolve to next conversation, Reopen to Open, Archive to Done, details drawer and empty search clearing the selected transcript.
- Mobile checks used authenticated same-origin frames at 390 × 844 and 375 × 667. No horizontal overflow; Send remained within the viewport; Back returned to the queue. These are responsive browser checks, not physical-device tests.
- Two temporary Web conversations were archived and deleted after verification. No real guest or external channel received a test reply.
- Parallel Standards and Spec reviews identified four navigation issues: off-page Waiting selection, delayed actions replacing newer navigation, Archive from Done not advancing, and unqualified staff links hiding answered conversations. All were fixed and covered by regression tests; final reviews found no remaining material issue.
- A real browser walkthrough records separate drafts, the details drawer, a successful Web reply and AI pause, Resolve advancing to the next conversation, Done, and Reopen. Only temporary demo conversations appear in the recording.
- A follow-up multi-agent Kiro audit fixed per-conversation pending replies, overlapping settle operations, incoming-link lifecycle, older Done URLs, and adjacent selection. It also extracted the reply composer, debounced backend search, removed the hidden mobile transcript, parallelized bounded filter reads, and narrowed delivery-event reads. Findings and deferred optimizations are in [the Kiro audit](../reviews/calm-inbox-kiro-audit.md).

The T3 preview resize tool timed out, so responsive checks used measured DOM bounds. A final desktop screenshot of the light theme was captured after a browser repaint; earlier screenshots sometimes omitted painted content despite complete DOM state. The design still needs evaluation with responders to measure usability improvements.
