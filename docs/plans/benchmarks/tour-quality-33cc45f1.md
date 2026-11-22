# Mobile panorama quality comparison

The direct, first-open, warm and recovered-warm initial screenshots were pixel-identical between full-quality baseline `e9af90facd76ad4e2e9aae195baf74d38a05ce41` and candidate `33cc45f1578be86f17f5797ce72852fd4894ed9a`. Both used the same living 2048 WebP, 390 × 844 CSS canvas, 585 × 1,266 backing store and drawing buffer, and original 780 × 1,688 PNGs. Both real Playwright fixtures passed. The candidate warm open included `first_panorama_cache_hit` before the captured draw. A native context loss and restore then produced the same initial screenshot.

| Capture | Mean absolute channel difference (0–255) | Pixels with any channel difference >6 |
| --- | ---: | ---: |
| Initial captures, four pairs | 0.000 | 0.00% |
| Right | 1.227 | 4.83% |
| Upper left | 0.089 | 0.15% |
| Lower right | 0.142 | 0.15% |
| Recovered lower right | 0.217 | 0.32% |
| Full Detail lower right | 0.264 | 0.26% |

The right pair differed by 0.185° of measured yaw. The other tilted pairs differed by at most 0.072° on either axis. Whole-image differences include the remaining pose offsets. The upper-left PNGs were visually inspected as a pair. The manifests retain all measured angles, trusted touch events, WebGL dimensions, context attributes, loss/restore markers, required cache hit and PNG hashes. The control and candidate each completed both context restorations, and explicitly requested the Full Detail master after the 2048 captures.

| One slow pitch sweep per arm | Baseline | Candidate |
| --- | ---: | ---: |
| First draw gap crossing +14° | 24.9 ms | 28.8 ms |
| Maximum draw gap across sweep | 33.2 ms | 33.9 ms |
| Maximum native move delivery gap | 55.1 ms | 62.8 ms |

The eight-move sweep was requested at 60 ms intervals. Baseline observed +10.09° to +17.48° and candidate +10.09° to +17.48°. The small sample can reveal large one-off stalls in this fixture. It provides no estimate of a population latency distribution. The diagnostic and its screenshots are separate from canonical timing.

Baseline attempts 1 and 2 retained partial evidence after an overly strict restore-pose tolerance and a wait on an ignored touch correction. Candidate attempt 1 stopped on an identical-pose redraw during capture. The final rig uses the shared 0.2° settled-pose tolerance for restoration, bounds and retries ignored corrections, and requires stable poses, dimensions and context through capture while recording any redraw. Both final arms ran the same diagnostic file hash. This archive excludes private fixture logs and auth data.

## Replay

Use the repository's pinned Bun 1.4.5, Node 22.22.3 and Chromium 148.0.7778.96. Prepare both application worktrees and a separate diagnostic worktree with the normal frozen setup. Use isolated local integration credentials for the fixture. Extract the archive to an empty directory and copy the fixture files into their corresponding paths in the diagnostic worktree. The included wrapper starts the real local production build and disposable seed for each exact application SHA.

```sh
mkdir -p "$quality_output"
tar -xzf "$quality_archive" -C "$quality_output"
cp "$quality_output/fixture/tests/bench/"* "$diagnostic_checkout/tests/bench/"
cp "$quality_output/fixture/scripts/bench/"* "$diagnostic_checkout/scripts/bench/"

runner="$diagnostic_checkout/scripts/bench/tour-quality-reference.sh"
bash "$runner" "$baseline_checkout" e9af90facd76ad4e2e9aae195baf74d38a05ce41 "$quality_output/replay-baseline"
BENCH_TOUR_QUALITY_REQUIRE_CPU_HIT=1 bash "$runner" \
  "$candidate_checkout" 33cc45f1578be86f17f5797ce72852fd4894ed9a "$quality_output/replay-candidate"
node "$diagnostic_checkout/scripts/bench/tour-quality-compare.mjs" \
  "$quality_output/replay-baseline/reference" "$quality_output/replay-candidate/reference"
```

To replay the recorded comparison without browser work, pass the archive's `baseline` and `candidate` directories to the same comparator. It verifies the PNG SHA-256 digests, fixture hash, room asset hash, browser profile, CSS bounds and pose tolerance before computing pixel differences. The original suite SHA-256 was `a71999dbd9b049d5100bfb6a0768bc2d6d8637f459076e7ff486e53e917a8e40`.

The archive SHA-256 is `ecd95232607aadf2e5fe853e04be4d03575a0148fdafd65f41c826ebf744ad9d`. [Original PNGs, manifests, comparator and report](tour-quality-33cc45f1-inputs.tar.gz)
