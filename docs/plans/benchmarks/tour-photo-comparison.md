# Direct tour gallery request timing

The three cohorts used independent revision builds, one seeded local backend, the 390 × 844 touch profile, 4× CPU throttling, 150 ms RTT and 1.6 Mbps down. Open-to-response ends at the first changed panorama frame after a real touch drag. The release ceilings are 6,758.5 ms for the cold direct median and 222.5 ms for the warm reopen median.

Each arm ran 4 groups in rotated order. The table gives medians in milliseconds over successful observations. Every timed failure remains in the archive. These are exploratory comparisons. The release decision requires two 50-group batches on the shipping revision.

| Implementation | Direct | Click | Reopen | Reopen drag | Reopen WebGL ready | Failed |
|---|---:|---:|---:|---:|---:|---:|
| Direct intro with the covered gallery eager at low priority | 6,555.4 | 2,765.3 | 191.4 | 57.2 | 90.2 | 0 |
| Start gallery when viewer code is ready or on early close | 6,634.8 | 2,879.4 | 256.5 | 65.5 | 109.4 | 0 |

The two arms used the same explicit bottom-up image capture and bundled panorama sampler. Ordinary room visits retained their priority hero. On direct visits the alternative starts the covered photo after the viewer module loads or immediately when a guest closes the intro. The 1200-pixel remote fixture and hosted 828-pixel optimized photo have different transfer sizes.

In the separate direct-entry trace, loading the viewer took 5,888 ms with the eager gallery and 4,618 ms with the deferred gallery. The alternative then started the 220,000-byte gallery transfer at 4,659 ms, just before the first panorama request at 4,678 ms. Both galleries decoded to 1,200 pixels and their URLs were requested once through close. The four-group medians give no reason to ship this change on its own. The next comparison defers that same covered photo to the first sphere draw.

Archive SHA-256 `612206d278a06abaee7ba4a3cc7c01dc6a1e01207be4a375db2949b4c0a664bd`. [Observations, source diffs and gallery request traces](tour-photo-comparison-inputs.tar.gz) · [Stage E1](tour-entry-stage-e1.md)
