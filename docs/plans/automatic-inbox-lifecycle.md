# Automatic inbox lifecycle

Approved behavior: a successfully sent reply moves its guest turn to Done immediately when no staff task or handoff remains. A new guest message always reopens the conversation. Done describes responder work; booking and payment state stay separate.

The interactive plan is at `/prototypes/inbox-lifecycle-plan.html`.

## State and ownership

- **Needs you:** explicit staff handoff, unanswered staff turn, failed/uncertain delivery, or an unclassified legacy conversation awaiting review.
- **In progress:** AI answering, staff reply awaiting channel confirmation, or an explicit staff follow-up task.
- **Done:** accepted AI/staff answer or guest-details question without outstanding staff work; explicit No reply needed is also available.

All five channels use the same mutation helpers in `convex/lib/inboxLifecycle.ts`. Web completion requires a durable stored response; messaging completion follows provider acceptance. This is not proof that the guest has read the message. Generation or clicking Send alone never completes work. A 60-second AI watchdog and a 90-second staff-send watchdog expose interrupted or uncertain work.

`latestGuestMessageId` and each reply/alert's `replyToMessageId` correlate events with the guest turn. Staff attempts also have a unique request ID. Old success, failure, handoff, watchdog and duplicate callbacks cannot overwrite a newer turn, manual completion, or a newer staff attempt.

Staff takeover is released after successful completion unless **Keep with staff** is explicitly enabled. Pending sends, handoffs and follow-ups block Resume AI. Editing or completing a task preserves pending sending/failure state. Undo creates an explicit Review conversation task. The selected transcript stays visible when its queue changes; manually choosing another queue clears the previous selection.

The AI prompt requests answered / awaiting-guest / needs-staff outcome markers. The server removes them before sending and conservatively treats unknown/tool fallbacks and staff promises as handoffs. Staff set an explicit follow-up before sending an acknowledgement that promises further work. The system does not infer that a real-world task has finished from message wording.

## Existing data and deployment

The schema fields remain optional and reads retain a legacy fallback. New activity adopts the lifecycle automatically. Existing replies have no reliable outcome evidence, so the backfill preserves previous manual resolved/archived status and puts unclassified open conversations in Needs you for review. It never guesses that an old acknowledgement completed a task. Empty rows and embedded-only transcripts remain unchanged; migrate embedded messages first if needed.

Preview the target deployment in bounded pages:

```sh
pnpm exec convex run migrations:previewInboxLifecycle '{"paginationOpts":{"numItems":10,"cursor":null}}'
# Continue using the returned continueCursor until isDone.
pnpm exec convex run migrations:run '{"fn":"migrations:backfillInboxLifecycle","dryRun":true}'
# If the first batch is empty, use the cursor suggested by the dry-run output.
```

After reviewing the proposed changes and deploying the application/backend together:

```sh
pnpm exec convex run migrations:run '{"fn":"migrations:backfillInboxLifecycle"}'
pnpm exec convex run --component migrations lib:getStatus '{"names":["migrations:backfillInboxLifecycle"]}'
```

Use the CLI's `--prod` flag only for a deliberate production rollout. Do not narrow or remove the legacy schema yet. The migration is batched, resumable and idempotent. On the development deployment, all 368 sessions were previewed; 216 changes were proposed (188 review-required, 28 previously completed), a batch with changes passed dry run, and the migration completed successfully. Production was not migrated by this work.

## Verification and visual evidence

Verification passed: `pnpm verify` completed all application/test/Convex typechecks, 101 test files with 979 tests, and a production build of 147 routes. A final ESLint run after removing an unused hook dependency passed without warnings. Two independent code reviews reported no remaining blockers after the timing and failure regressions were fixed.

Backend regressions cover immediate completion, waiting for guest, all four messaging adapters, handoff visibility, failed send and retry, task completion, ownership pinning, stale drafted replies, older events, concurrent newer guest turns, duplicate sends, watchdog recovery, manual completion, archive and Undo. UI regressions cover retained desktop/mobile transcripts, navigation during pending work, queue switches and per-conversation drafts.

Real app checks used isolated development fixtures for the eight interactive-plan cases, with successful staff replies sent through the actual Web inbox. AI/provider results and delivery failures were simulated through the real lifecycle helpers; no messages were sent to external guests. Screenshots include each case plus retry/task/newer-turn completion, automatic reopening, Undo, No reply needed and the running app inside a 390 CSS-pixel mobile viewport. The temporary fixture functions, environment flag and fixture rows were removed after capture.

The local screenshot gallery is served at `http://localhost:3022/` and saved at `/tmp/automatic-inbox-evidence/index.html`. These artifacts are development evidence, not a production deployment.
