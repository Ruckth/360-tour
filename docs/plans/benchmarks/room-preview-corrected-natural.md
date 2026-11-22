# Corrected natural room cache replay

Both verified Preview builds served 99 of 100 scheduled requests from cache. The observed change was 0 percentage points and the floor was 97%. The hit-rate, same-region and document gates passed with zero unknown responses in either arm.

The hosted replay used `6280c3b9`. Its villa cache, keys, expiry windows, recovery policy and classification are identical to the release. Later changes aligned Sentry versions and shared Clerk and Floating UI packages. The result measures the matched replay on the recorded builds.

| Build | Verified / scheduled | Fresh hits | Nonblocking stale | Origin fetches | Recovery | Unknown | Cache-served | Header / SSR observations |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Next | 100 / 100 | 70 | 29 | 1 | 0 | 0 | 99.0% | 70 / 30 |
| Start | 100 / 100 | 70 | 29 | 1 | 0 | 0 | 99.0% | 100 / 0 |

Both immutable Previews and the comparator used `6280c3b9aa68b92dad534d924d063446bc0cf94d`. Both uploaded archives matched their Vercel source file IDs and contained 1,866 byte-identical tracked files from the named revision. Each included its intended read-only `vercel.json` build override and omitted the same two tracked files. Both ran on Node 22.x in `iad1`, with the same read-only public Convex Preview fixture and Clerk test configuration. The source attestation records the archives, build configuration digests and module hashes.

The replay used a separate namespace per arm, the same seed `20261122`, a 20-second configured mean gap and a 90-second cap. It alternated request order. Each arm had 100 verified origin responses in the scheduled replay, plus two excluded warmups. Nonblocking stale responses count as served from cache. Recovery responses count as known non-hits. The gate allows a loss of two percentage points and at most 5% unknown observations per arm. Start had zero early observed misses within 45 seconds of a confirmed write, so both its observed and optimistic rates were 99.0%.

The [earlier exact-source attempt](./room-preview-swr-results.md) retains 29 unknown Next observations when cold workers skipped the native header hook. The corrected Next cold pilot reproduced this path with a real cold miss and a stale response after a 65-second idle period. The proxy echoed the validated namespace and a fresh response witness. The comparator verified the matching namespace, witness and cache state emitted by the SSR document. Warm Next and all Start observations used native cache-state response headers. Pilot requests used separate namespaces outside this replay.

Curl measured TTFB on fresh connections. The median client wall time outside curl’s own total was 1,029.0 ms for Next and 1,039.2 ms for Start. This includes CLI launch and authentication around curl. It extended the elapsed schedule and is excluded from reported curl TTFB.

[Scrubbed samples, exact source attestation, pilots and gates](./room-preview-corrected-natural.json.gz).
