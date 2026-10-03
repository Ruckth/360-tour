# Calm inbox Kiro audit — 2026-10-03

Scope: PR #25, `codex/calm-inbox`, against `f9ee4e560b55b95fa5ab80e676062a75ad2b8745`. Three Kiro CLI agents using `claude-opus-5.5` with high effort independently reviewed Standards, Spec, and performance. Separate frontend/backend Kiro agents implemented the accepted findings; the coordinator fixed workflow navigation and search debounce. A final read-only Kiro review examined the combined changes.

## Standards

No documented AGENTS.md or Convex guideline violation was found. Four actionable findings were addressed:

1. Reply draft/feedback were per conversation but pending state was global. `useAdminReplyComposer` now groups draft, pending, error, and delivery feedback per session, with a synchronous duplicate-submit guard. Concurrent replies finish independently; failures and newer draft text are retained.
2. Overlapping settle operations shared one pending ID. A Set tracks each message independently and prevents repeat clicks/keyboard submissions.
3. Queue-to-URL mapping was duplicated. `queueParams` now supplies queue changes, reset actions, successful-reply navigation, and Reopen navigation.
4. URL patches started from the committed query and could overwrite pending filter changes. Patches now compose against the latest requested query. Search debounce preserves a newly chosen queue and cannot restore cleared filters while routing is pending.

The desktop transcript is no longer mounted alongside the mobile dialog. Viewport detection preserves desktop first paint and waits for the actual breakpoint before opening the mobile dialog.

## Spec

Five correctness findings were addressed; the reply-busy finding overlaps Standards:

1. Default Waiting URLs resemble incoming bare session links. Incoming-link normalization now runs once per initial selection. Live replies, settling, and later in-app selections stay in the chosen queue. Answered/completed incoming transcripts remain visible until their matching queue URL commits.
2. Old `state=done/resolved/archived` URLs without `view` inherited Waiting and hid completed conversations. These links now use All activity.
3. A slow reply in one chat disabled another chat's composer. Reply pending state is per session.
4. Resolve/Archive selected the first row instead of the adjacent row. Desktop selects the following row, falling back to the preceding row; mobile returns to the queue.
5. A live Convex reply update could hide the Waiting transcript before the HTTP response and Open navigation completed. It now remains mounted during the send and until the matching URL commits. The exemption clears on navigation, so a later Waiting visit remains filtered.

Ideas from the original design research (global Waiting counts, Send and close, a Next button in the closed-window notice) are design alternatives, not requirements of the chosen implementation plan. They remain outside this audit's fixes.

## Performance

Accepted changes have deterministic workload benefits; no measured latency improvement is claimed:

- The input remains immediate, while query arguments and pagination resets now follow the debounced URL search. Rapid keystrokes before the 300 ms pause no longer start separate search subscriptions.
- Mobile mounts one transcript/composer instead of two after viewport detection.
- Bounded filter batches run independent reads concurrently, then append matches in source order. Lookup memoization, overflow cursors, deduplication, result bounds, and the single Convex `paginate` call remain intact.
- Selected-channel details fetch one newest delivery event instead of up to ten. All four external channels use the same limit. The legacy `getTranscript` ten-event contract is preserved.

Development `convex insights --details` reported one historical `touchSession` OCC retry in 72 hours and no measured inbox slowdown. Larger changes are deferred:

- Done currently scans a bounded source page containing open chats; a high proportion of newer open chats can produce an empty filtered page with an older-page action. Merging resolved/archived index ranges needs workload measurements and a cursor that safely handles timestamp ties and live changes.
- Denormalized Waiting summaries, separate presence documents, and transcript memoization need profiling or read/invalidation evidence before adding schema or interface complexity.

## Verification

`pnpm verify` passed: 99 unit test files / 954 tests, app/test/Convex type checks, ESLint, and production build. New tests cover concurrent replies and settling, duplicate submits, failure/draft retention, mobile single-detail mounting, incoming-link lifecycle, old Done URLs, adjacent selection, debounce, all four delivery channels, filtered ordering, overflow, and deduplication. Kiro also verified that targeted regression tests fail when the corresponding old behavior is restored.

Authenticated browser checks confirmed exactly one desktop composer at 1169 × 731 and one mobile composer in a same-origin frame measured at 388 × 665. The mobile desktop-detail container had no children, no horizontal overflow was present, and Send stayed inside the viewport. The native resize tool timed out, so this was a responsive frame check, not a physical-device test. No real guest message was sent.

Final targeted Kiro review confirmed the delayed-URL composition and transcript-retention fixes. No remaining material Standards or Spec issue was reported. The four new timing regressions failed before the fixes and passed afterward. Standards: four findings addressed, no documented violations. Spec: five correctness findings addressed, with the reply-busy finding shared across axes.
