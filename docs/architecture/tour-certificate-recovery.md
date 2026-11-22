# Tour certificate recovery

The optional scene marker proves that a tour had at most 50 rooms, and canonical application writers preserve that fact. A partial snapshot import, direct dashboard edit, or deployment running writers that predate the marker can change membership outside that proof. Clear every scene marker on each affected property before those edits can go live. For uncertain scope, clear the entire scene table. A quiesced full snapshot from the matching writer revision can retain its markers if its scene membership is intact. The discarded property-level count ran only on checkout-local deployments. Production and shared QA never received that field.

## Pause and bind the operation

1. Record the verified deployment name and its Convex cloud origin. Verify the deployment mapping independently of local environment files. Block staff and guest writes with `ARCH_RESET_PAUSED=1`, pause any direct operator writes and drain changes that were already in flight.
2. Keep a verified deployment export with its SHA-256 in the operation log. Rehearse the import and recovery on an isolated target before any shared run. For a mixed import, record both the prior export hash and the imported artifact hash. Pass the final verified artifact hash to the function to bind the resume cursor to that operation.
3. While still paused, finish the import or stop the older writer. Run the current recovery endpoint before unpausing. If the destination will run a schema that rejects `ordinaryTourCertified`, clear the markers under the compatible paused schema first and omit the field in the snapshot being restored.

## Inspect and clear pages

Use the deployed internal function at the reviewed revision. Start a fresh sweep with a null cursor and checkpoint. Pass an exact property ID for a known affected property. Omit it for a full sweep.

```sh
bun run convex run maintenance/tourCertificates:page \
  '{"targetOrigin":"https://verified-deployment.convex.cloud","snapshotSha256":"REPLACE_WITH_64_LOWERCASE_HEX","mode":"check","cursor":null,"checkpoint":null}' \
  --deployment VERIFIED_DEPLOYMENT --codegen disable
```

The function refuses an unpaused deployment, a mismatching origin or a checkpoint from another target, snapshot, scope, mode or cursor. The SHA-256 checkpoint binds those inputs and detects a mismatched resume. It is independent of the operator credential and does not verify a file on disk. Keep the export and private cursor log in the approved location.

Each call reads at most eight scenes with a 4 MiB pagination read budget and only updates marked rows in clear mode. Use the returned cursor and checkpoint together for the next request. If a call is interrupted, repeat it from the last recorded input pair. Clearing a page twice is safe. Record the result and keep the sweep paused until `isDone` is true. If a cursor fails to advance, keep writes paused and investigate the target before resuming.

Run the clear sweep with `mode: "clear"` and a fresh null cursor and checkpoint. Then repeat a complete check sweep. Confirm it reports zero remaining markers in the affected scope, the expected scene counts, and the correct opening scene and hotspot references. Resume the new canonical writer only after those checks. Ordinary unmarked scenes can certify on their next eligible edit. No mass certification is necessary.

The room audit insert check budgets the maximum 37-character Convex v6 document ID, derived from 23 encoded bytes. [ID encoding](https://github.com/convex/convex-backend/blob/main/crates/value/src/id_v6.rs) · [Base32 length](https://github.com/convex/convex-backend/blob/main/crates/value/src/base32.rs)


## Isolated rehearsal

Run the native smoke in the checkout of the revision under review. Use fresh absolute output paths. It creates a local anonymous deployment, imports synthetic scenes into two villas and exercises scoped and whole-table repair. It also verifies an edit at the native document-size limit and saves the generated API from the isolated deployment.

```sh
node scripts/heavy.mjs node scripts/bench/tour-certificate-smoke.mjs   /absolute/private/tour-certificate-smoke.json /absolute/private/api.d.ts
```

The command uses the local admin key only inside its private temporary directory. It records counts, the export hash and the repair results. It leaves the raw export and logs private and stops the local deployment on exit.

The checkout-local rehearsal passed. A scoped clear removed two stale marks from a 51-scene tour. The whole-table clear removed another 11 marks across 62 scenes, including a nonterminal page stopped by the native byte budget. A fresh check found no remaining marks. After writes reopened, the imported tour still rejected over-budget growth. An ordinary near-limit rename wrote exactly 1,048,576 bytes and released its marker. [Native smoke evidence](../plans/benchmarks/catalog/tour-certificate-native-smoke.json)
