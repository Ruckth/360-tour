# Direct entry and warm reopen experiments

Four alternating groups per implementation measured 60 successful opens on the same seeded local backend. All 60 passed the first usable frame and panorama request checks. In the combined candidate, direct entry and warm reopen improved over the first Stage E release. Both medians still exceeded the release targets of 6,758.5 ms and 222.5 ms.

| Implementation | Direct ms | Click ms | Reopen ms | Direct module ready to mount ms | Warm drag to changed frame ms |
|---|---:|---:|---:|---:|---:|
| First Stage E release | 6,916.8 | 2,781.1 | 346.3 | 197.5 | 136.5 |
| Prefetch scheduling via refs | 6,931.7 | 2,758.9 | 344.2 | 196.7 | 120.6 |
| Ref scheduling and opaque intro reveal | 6,825.9 | 2,740.8 | 326.0 | 168.8 | 94.8 |
| Effect-based viewer module loader | 6,981.3 | 2,779.8 | 344.0 | 13.0 | 125.0 |
| Combined candidate with selection guards | 6,833.4 | 2,748.7 | 322.1 | 12.5 | 96.2 |

Each arm used an independent Start build. The test used the same mobile CPU, network, first room, trusted touch sequence, pixel verification after the measured interval and first usable frame predicate as Stage E. Arm order alternated and rotated across the four groups. Additional input listeners and image inspection were present in every arm. This experiment measures paired differences and has four observations per cell.

Moving the module import out of a Suspense retry shortened the wait from module resolution to mount. The full direct-entry result varied with subsequent WebGL initialization. Keeping draw bookkeeping out of React state reduced the number of unchanged sphere frames before a drag. The first pointer movement still arrived late on warm reopen. The observed input intervals include the browser driver's sequential touch-event acknowledgements.

The local direct-entry gallery image transferred approximately 220,204 bytes from the remote fixture. A separate read against the protected Stage E Preview obtained the same first photograph at 828 pixels and quality 82 as a 32,757-byte AVIF body. Both used high fetch priority. These image measurements cover different renditions.

The archive includes all 60 observations, host snapshots, each experiment's source diff against the control and the hosted image measurement. Its SHA-256 is `cb386d39484b850b0020e74d8ae831d565247872ae778439cf69647e2b226ecd`. [Pilot inputs](tour-response-pilot-inputs.tar.gz) · [First Stage E release measurements](tour-entry-stage-e1.md)
