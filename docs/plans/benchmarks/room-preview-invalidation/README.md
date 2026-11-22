# Villa push invalidation on a dedicated Preview

This is the pre-promotion proof required by the [accepted room-cache contract](../room-preview-cache.md#what-a-guest-sees-after-a-write) and [cutover runbook](../../../architecture/phase4-cutover-runbook.md) Stage 1. Sanitized results are in [`evidence.json`](evidence.json). Private values (deployment URL and ID, backend name, secret, bypass, run-owned emails, raw logs) stay out of the repository.

## Target

The frontend is exact source `249e52d1a1907443a1ff6510e952b44662d96473`. It was built remotely by the tracked `vercel-build` with the default Start framework and the `bun1.4.x` runtime. No fault fixture or runtime override was used.

The run used one run-owned Vercel Preview with deployment protection, no aliases, and metadata carrying the commit and the branch `perf-phase4-invalidation-validation`. That branch name created and seeded its own Convex Preview. The fixture villa was unedited. Shared production and development backends are refused.

Provider dispatch was disabled on both sides. Frontend provider keys were blanked per deployment, and the response header reported `x-start-provider-isolation: verified`. The Convex provider keys were empty.

`START_VILLA_INVALIDATION_SECRET` was generated for this deployment only and set with deployment-scoped `--env`. No project env or settings changed. On that Preview's Convex backend only:

- `START_VILLA_INVALIDATION_ORIGIN` was set to the Preview's exact origin.
- `START_VILLA_INVALIDATION_SECRET` was set to the matching value.
- `START_VILLA_INVALIDATION_BYPASS_TOKEN` was set to the project's existing automation bypass.

All three were written from private files and never printed. All three started unset.

## Result

**Passed** on 2026-11-22.

| Step | Observation |
|---|---|
| Prime | `/rooms/pool-villa` answered 200 `stale`, then 200 `hit`, a fresh entry inside its 60 s window. |
| Authenticated edit | A run-owned Clerk test owner, granted only on this backend, renamed the villa through `catalog.properties.update`. The mutation took 714 ms. |
| Guest page | The first poll, 602 ms after the commit, showed the new name as 200 `miss` under a new generation. That was 1.7 s after the fresh hit, well before the freshness window ended. |
| Delivery | `catalog/properties:deliverVillaInvalidation` ran once, completing at 07:22:57.513Z in 199 ms. There was no retry and no rejection log. |
| Acknowledgement | The CDN request record at 07:22:57.349Z shows `POST /api/internal/villa-cache` → **204**, user agent `Convex/1.0`, region `iad1`: the action's own signed request. |
| Direct probe | Unsigned → 401. Signed → 204 with no `X-Villa-Cache-Scope: process`, so the shared cache confirmed the rotation. `Cache-Control: no-store`. |
| Restore | Renaming back produced another `Convex/1.0` 204 at 07:23:40.960Z. The seeded name was visible as `miss` 741 ms after the commit. |

Cleanup:

- The three invalidation variables were removed from the Convex Preview.
- `ADMIN_EMAILS` was restored to its prior value.
- The run-owned Clerk users were deleted and the villa keeps its seeded name.
- The Vercel deployment was removed by exact name. The Convex Preview follows its normal expiry.

## Reusable commands for staged validation

Keep values in mode-600 files. `$DEPLOYMENT` is the immutable deployment ID and `$ORIGIN` its exact `https://` origin.

1. **Bind the backend.** Use the `--from-file` form so no value reaches argv or logs. Use `--prod` (production) or `--preview-name <name>` with a project selector env file (Preview):

   ```sh
   convex env set START_VILLA_INVALIDATION_ORIGIN --from-file origin.txt   # "$ORIGIN/"
   convex env set START_VILLA_INVALIDATION_SECRET --from-file secret.txt   # >= 32 of [A-Za-z0-9_-]
   convex env set START_VILLA_INVALIDATION_BYPASS_TOKEN --from-file bypass.txt   # protected origins only
   ```

   Provision the same `START_VILLA_INVALIDATION_SECRET` server-side on the Start deployment.
2. **Prime a fresh entry, then make an admin edit.** Expect the guest page to show it within seconds, as `miss`.
3. **Trace the acknowledgement:**

   ```sh
   vercel logs requests --deployment "$DEPLOYMENT" --since 15m --json \
     -q 'requestPath:"/api/internal/villa-cache"'   # expect httpStatus 204, clientUserAgent Convex/1.0
   timeout 30 convex logs --history 200 --success --jsonl --deployment <convex-deployment>   # one deliverVillaInvalidation Completion, no "rejected"/"exhausted"
   ```

4. **Run the direct signed probe** with `curl -sS -o /dev/null -D - -X POST "$ORIGIN/api/internal/villa-cache" -H @auth-header.txt -H 'content-type: application/json' --data '{"slugs":["garden-suite"]}'`, plus the protection-bypass cookie or header. Expect 204 without `X-Villa-Cache-Scope`; without auth, expect 401.
5. **On rollback**, restore the Stage 0 state of all three Convex variables and the Vercel secret, as runbook §5 item 4 requires.
