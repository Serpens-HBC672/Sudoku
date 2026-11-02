# Backgammon TD vs EM — corrected eight-matchup benchmark

Test date: 2026-11-02. Source branch: `Backgammon-TD-Testing`. GitHub Actions run: https://github.com/Serpens-HBC672/Sudoku/actions/runs/41404711207 (completed successfully)

**Final status:** all eight intended matchups have 100/100 completed games (800/800 intended games; 0 unfinished). The corrected Actions run completed successfully. The earlier unintended `td5-em5` batch is preserved separately as an excluded experiment, so the branch contains 900 recorded games in total: 800 across the intended matrix plus 100 from the misconfigured batch. All intended JSONL files were checked for contiguous indices 0–99, winner labels, game counts, and the common source hash.

## Results (first named algorithm = A)

| Matchup (A vs B) | A wins | B wins | A win rate | 95% Wilson interval | Mean move-search time per game | Cube declines |
|---|---:|---:|---:|---:|---:|---:|
| td1-em1 | 77 | 23 | 77.0% | 67.8%–84.2% | 0.009 s | 18 |
| td1-em6 | 58 | 42 | 58.0% | 48.2%–67.2% | 2.091 s | 21 |
| td5-em1 | 77 | 23 | 77.0% | 67.8%–84.2% | 0.601 s | 20 |
| td5-em6 | 61 | 39 | 61.0% | 51.2%–70.0% | 2.385 s | 22 |
| td1-td5 | 54 | 46 | 54.0% | 44.3%–63.4% | 0.779 s | 1 |
| em1-em6 | 28 | 72 | 28.0% | 20.1%–37.5% | 2.114 s | 9 |
| td4-td5 | 49 | 51 | 49.0% | 39.4%–58.7% | 0.674 s | 4 |
| em5-em6 | 39 | 61 | 39.0% | 30.0%–48.8% | 3.365 s | 9 |

`td1`/`td4`/`td5`: GNUBG TD-L1/L4/L5. `em1`/`em5`/`em6`: Expectiminimax L1/L5/L6. Each matchup includes 50 unique opening seeds, run twice with A/B exchanging colors. The eight intended matchups are now all complete.

## Reproducibility and methodology

- Source HTML: `Backgammon(Single File Ver) - Built by Claude.html` (SHA-256 `25cf4ff14c35f64067da71fcdac295dde68fb6ceb2ab52962dc7e5f8cd0eacb6`). The benchmark extracts the **unchanged** `engine` script and calls its `Rules.gen`, `SEARCH.plan`/`SEARCH.score`, GNUBG WASM and bearoff tables. No alternate move evaluator or game generator was used.
- Runtime: GitHub-hosted Ubuntu runners, Node.js v24.22.1; logs confirm WASM SIMD and bearoff table initialization (`wasmLoaded=true`, `bearoffLoaded=true`).
- Each game uses deterministic seed `910001 + floor(gameIndex/2)`; odd game indices swap A/B board colors. Initial roll follows the original distinct two-dice opening rule. Move selection uses original search tie-breaking. Cube offer and acceptance formulas mirror the original UI, and `len=0` gives independent unlimited-score games.
- Individual records include color swap, winner, win type, points, number of moves, cube offers, move-search time, and source hash. The JSONL files are the authoritative raw results. Each `*.summary.json` is derived from them.
- The timing column is cumulative **move choice/search computation per completed game**, excluding process startup, network initialization, cube decisions, logging, browser rendering and worker scheduling. It is not an end-user wall-clock latency benchmark.
- The displayed Wilson confidence intervals are simple per-game binomial intervals for orientation. Because pairs share seeds and outcomes may be correlated, formal inference should use a paired design. These are outcomes under the game's specific rules, dice generator, cube policies, and frozen AI weights, not universal strength ratings.

## Interpretation

- TD outperformed EM in each of the four extreme cross-algorithm matchups, including TD-L1 versus EM-L6 (58–42) and TD-L5 versus EM-L6 (61–39). The 58–42 result is not conclusive on its own at a conventional 95% confidence level.
- EM-L6 beat EM-L1. TD-L1 beat TD-L5 54–46, but that near-even result does not establish that the lower setting is better.
- TD-L4 and TD-L5 finished 49–51. This is effectively a near-even result in this 100-game sample and provides no evidence that either level is stronger. In the 50 matched seed pairs, 49 pairs split one win each; the remaining pair was won twice by TD-L5 (0 pairs were double-won by TD-L4). An exact paired McNemar test on the discordant pairs gives p=1.00, but there is only one discordant pair, so this test has very little power.
- The previously listed `td5-em5` result (64–36) was an unintended configuration and is excluded from the intended eight-matchup benchmark. It must not be interpreted as TD4-vs-TD5 evidence.
- Before deleting the temporary testing branch, preserve this report, the eight intended matchup `*.jsonl` / `*.summary.json` pairs, and the excluded `td5-em5` archive; deleting the branch will remove the repository copy unless they are copied or merged elsewhere.

## Excluded misconfigured batch

The preserved files `td5-em5.jsonl` and `td5-em5.summary.json` record GNUBG TD-L5 vs Expectiminimax-L5 (64–36 over 100 games). This is genuine data from the original run, but it was not one of the requested matchups and is excluded from the intended benchmark totals. The corrected `td4-td5` files now provide the intended TD-L4 vs TD-L5 comparison: 49–51 over 100 completed games.

## Run it again

```sh
node tools/backgammon-benchmark/run.cjs --pair td5-em6 --games 100 --seed 910001
node tools/backgammon-benchmark/run.cjs --mode summarize --pair td5-em6 --games 100
```
