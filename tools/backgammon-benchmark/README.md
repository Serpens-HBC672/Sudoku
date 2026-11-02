# Backgammon: TD vs Expectiminimax benchmark

The game is the single HTML file in the repository root. The engine is extracted directly from its `<script id="engine">` block at runtime; this harness does not implement a substitute evaluator, search, or move generator. The bundled GNUBG WASM and weights are loaded from the same HTML. If WASM loading fails, the test fails rather than silently substituting EM.

Pairs: `td1-em1`, `td1-em6`, `td5-em1`, `td5-em6` (primary), `td1-td5`, `td4-td5` (TD-L4 vs TD-L5), `em1-em6`, `em5-em6`. The earlier `td5-em5` batch was an unintended configuration; its raw data is retained for audit but excluded from this eight-matchup matrix.

Node >= 22; no npm install required.

```sh
node tools/backgammon-benchmark/run.cjs --mode probe --pair td1-em6
node tools/backgammon-benchmark/run.cjs --pair td1-em1 --games 100 --seed 910001 --budget-seconds 3600
node tools/backgammon-benchmark/run.cjs --mode summarize --pair td1-em1 --games 100
```

Each run appends one JSONL record only after the whole game finishes. Restarts skip existing records. Files appear under `tools/backgammon-benchmark/results/`; each pair has a `.jsonl` and `.summary.json`.

**Protocol:** Games with indices 2k and 2k+1 use the same seed and exchange which AI controls each board color. The deterministic RNG covers opening rolls and subsequent rolls. The game's standard doubling and acceptance policies remain enabled, with an unlimited point match (`len=0`). Outcomes record points and whether the opponent declined a cube. All records carry the SHA-256 of the original HTML. A single unfinished game cannot be counted as a loss, and incomplete batches cannot be described as 100-game results.

A full high-effort EM6 search includes an extra ply and is computationally expensive. An initial bounded feasibility pilot was completed first. The subsequent Actions workflow completed **100 games for each of the eight matchups (800/800)**. The initial 800-game run completed, but post-run review found that one matrix entry was mistakenly `td5-em5` rather than the requested `td4-td5`. That 100-game batch is preserved and excluded from the intended comparison. The corrected workflow now schedules 100 games of `td4-td5`; see [results/REPORT.md](results/REPORT.md) for the audit trail. The full batches use a finite 45-minute-per-job limit.

Limitations: deterministic paired initial seeds do not make moves/dice paths identical after two agents choose different moves; confidence intervals and statistical comparisons should account for the pair design. In `max-turns` termination, the game counts as unfinished, not a loss. Cube actions are counted separately.
