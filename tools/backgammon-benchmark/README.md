# Backgammon: TD vs Expectiminimax benchmark

The game is the single HTML file in the repository root. The engine is extracted directly from its `<script id="engine">` block at runtime; this harness does not implement a substitute evaluator, search, or move generator. The bundled GNUBG WASM and weights are loaded from the same HTML. If WASM loading fails, the test fails rather than silently substituting EM.

Current campaign: 15 matchups, 600 completed games per matchup (9,000 intended games total). The original eight pairs remain unchanged: `td1-em1`, `td1-em6`, `td5-em1`, `td5-em6`, `td1-td5`, `td4-td5`, `em1-em6`, `em5-em6`. Seven adjacent-level comparisons are added: `td1-td2`, `td2-td3`, `td3-td4`, `em1-em2`, `em2-em3`, `em3-em4`, `em4-em5`. The earlier `td5-em5` batch was an unintended configuration; its raw data is retained for audit but excluded from the current 15-matchup matrix.

Node >= 22; no npm install required.

```sh
node tools/backgammon-benchmark/run.cjs --mode probe --pair td1-em6
node tools/backgammon-benchmark/run.cjs --pair td1-em1 --games 600 --seed 910001 --budget-seconds 3300
node tools/backgammon-benchmark/run.cjs --mode summarize --pair td1-em1 --games 600
```

Each run appends one JSONL record only after the whole game finishes. Restarts skip existing records. Files appear under `tools/backgammon-benchmark/results/`; each pair has a `.jsonl` and `.summary.json`.

**Protocol:** Games with indices 2k and 2k+1 use the same seed and exchange which AI controls each board color. The deterministic RNG covers opening rolls and subsequent rolls. The game's standard doubling and acceptance policies remain enabled, with an unlimited point match (`len=0`). Outcomes record points and whether the opponent declined a cube. All records carry the SHA-256 of the original HTML. A single unfinished game cannot be counted as a loss, and incomplete batches cannot be described as 600-game results.

A full high-effort EM6 search includes an extra ply and is computationally expensive. An initial bounded feasibility pilot was completed first. The corrected Actions workflow has now completed **100 games for each of the eight intended matchups (800/800)**, with all jobs successful and no unfinished games. The initial run mistakenly used `td5-em5` instead of `td4-td5`; those 100 games are preserved as a separate excluded experiment and are not included in the intended 800-game matrix. The corrected `td4-td5` result is 49–51. See [results/REPORT.md](results/REPORT.md) for the full results and audit trail. The current 600-game campaign uses a 55-minute game-process budget, a 57.5-minute external process timeout, and a 65-minute per-job limit. A validation step requires exactly 600 contiguous completed records, zero unfinished games, and one consistent source hash; a green job alone is not treated as proof of completion.


The `Backgammon-TD-vs-EM 100-game comparisons` results and `results/REPORT.md` document the earlier eight-pair, 100-game campaign as a historical snapshot (800 intended games). Its raw results are retained unchanged; the current campaign extends those same eight pairs to 600 games and adds seven adjacent-level pairs. The runner's default `--games` value is now 600, while explicit values remain supported.

Limitations: deterministic paired initial seeds do not make moves/dice paths identical after two agents choose different moves; confidence intervals and statistical comparisons should account for the pair design. In `max-turns` termination, the game counts as unfinished, not a loss. Cube actions are counted separately.
