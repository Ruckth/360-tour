# Admin UI loop

Requires Node 24, pnpm dependencies, Chromium, the existing Next server at
http://localhost:3410, and `.env.local` with Clerk keys, UI_LOOP_ADMIN_EMAIL,
UI_LOOP_BASE_URL. Set UI_LOOP_NOW to override the fixed Bangkok clock.
No deployment, seeding, application writes, commits or pushes are performed.
Convex websocket writes and HTTP mutation/action/run POSTs are blocked.

```sh
pnpm ui-loop:capture --section 1-daily --round 0 --screens chats --devices phone,ipad-l
pnpm ui-loop:capture --section all --round 0 --check-only-devices
pnpm ui-loop:audit --section 1-daily --round 0 --auditor A --screens chats --devices ipad-l --runs 1
pnpm ui-loop:report --section 1-daily --round 0
pnpm ui-loop:report --all --round 0   # writes output/ui-loop/rollup-round-0.md
pnpm ui-loop:anchors build --from output/ui-loop/1-daily/round-0
pnpm ui-loop:audit --section 1-daily --round 0 --auditor A --runs 3 --calibrate
pnpm ui-loop:anchors agree --from output/ui-loop/1-daily/round-0/audit-A
pnpm ui-loop:audit --section 1-daily --round 0 --auditor B --runs 3 --prepare-only
pnpm ui-loop:audit ingest --section 1-daily --round 0 --auditor B
pnpm ui-loop:annotate strip --section 1-daily --screen chats --base 0 --current 1
pnpm ui-loop:annotate callouts --section 1-daily --round 0 --screen chats --device ipad-l --notes notes.json
```

Capture supports --concurrency, --debug-shots, --states, --inject and --out.
Filtered reruns replace matching manifest cells and preserve other cells.
--resume skips successful cells in an interrupted capture.
Check-only devices run default checks without PNGs; 320px and landscape phone
results are report-only. Captures use up to four viewport images (initial +
three scroll segments). Long/error fixtures remain pending in this wave.

Diagnostic audits may run on a failing baseline; their checks gate stays false.
A passing gate requires all four devices, three runs, calibration agreement,
and a separate confirmation capture/audit. Scores alone never establish PASS.
The external reviewer reads each printed TASK.md, returns out.json there,
and sets model_id in prepared.json to the actual model used. Ingest preserves
invalid inputs for correction; unstable cells prepare two more run directories.
No prior scores, round ids, check results or code are included in judge inputs.
The schema adds the task's keyboard state to metric v1's observed_states enum.

Reference assets are read from the local competitor board; override its folder
with UI_LOOP_REFERENCE_DIR. Anchor build defaults to chats + settings-business
from sibling sections of the supplied capture directory. Use --screens to
choose another frozen set. Agreement requires reviewer records with ≥3 runs.
Callout notes are [{"selector":"h1","label":"Title","text":"Observation"}];
--state chooses a live recipe (default if omitted).
