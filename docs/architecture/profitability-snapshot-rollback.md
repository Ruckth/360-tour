# Profitability snapshot rollback

The profitability report keeps immutable source views for up to 15 minutes and allows up to three active transaction scopes per source. Each caller can hold up to four active source views. Retiring a view invalidates it immediately and queues indexed cleanup in batches of 32 chunks. Every page and export checks the caller’s current permissions, saved scope, and snapshot expiry.

A previous Convex revision can use the original source views. Drain the prepared transaction views before deploying a backend revision without prepared-page support. The previous cleanup handler cannot drain a multi-batch prepared view. Its schema also lacks the child and pending-build fields.

1. Set `PROFIT_PREPARATION_PAUSED=1` on the target deployment. Confirm that an authorized preparation request is refused. Existing scheduled cleanup continues.
2. Run the internal `marketing/profitViews:drainPreparedViews` mutation with `{}` on the same deployment. Repeat until it returns `true`. Each call drains prepared views and unfinished source jobs by deleting up to 32 chunks and can safely be retried after interruption. The source views remain available.
3. Check that a second drain returns `true`. Deploy the previous Convex revision after this check. The original source-view index remains defined, and both revisions use the same source payload format. Any scheduled child-expiry call that runs after rollback finds its data already gone.
4. Verify the previous profitability report opens for finance and still applies its original permission checks. Remove the pause when deploying a revision that supports prepared pages again.

## Large source snapshots

When the report cannot assemble its source in one read transaction, an authorized open starts a short-lived internal job. The job reads at one database timestamp using the pinned Convex SDK and the deployment’s own HTTP origin. It scans bounded appointment pages and publishes the completed snapshot in one mutation. The worker discards the whole attempt if it loses that timestamp, reaches its page or size limit, or cannot reach the deployment’s timestamp endpoint. The first query fixes the timestamp for visits, fees and expenses. This path currently uses the SDK’s experimental consistent-query method. [Convex HTTP client documentation](https://docs.convex.dev/api/classes/browser.ConvexHttpClient)

The caller can retry the report or choose a shorter period after a failed build. The browser only receives the build status. It never receives the worker’s capability.
