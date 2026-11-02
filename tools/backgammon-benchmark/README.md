# Backgammon: TD vs Expectiminimax benchmark

The game is the single HTML file in the repository root. The engine is extracted directly from its `<script id="engine">` block at runtime; this harness does not implement a substitute evaluator, search, or move generator. The bundled GNUBG WASM and weights are loaded from the same HTML. If WASM loading fails, the test fails rather than silently substituting EM.

Pairs: `td1-em1`, `td1-em6`, `td5-em1`, `td5-em6` (primary), `td1-td5`, `em1-em6`, `td5-em5`, `em5-em6` (optional).

Node >= 22; no npm install required.

```sh
node tools/backgammon-benchmark/run.cjs --mode probe --pair td1-em6
node tools/backgammon-benchmark/run.cjs --pair td1-em1 --games 100 --seed 910001 --budget-seconds 3600
node tools/backgammon-benchmark/run.cjs --mode summarize --pair td1-em1 --games 100
```

Each run appends one JSONL record only after the whole game finishes. Restarts skip existing records. Files appear under `tools/backgammon-benchmark/results/`; each pair has a `.jsonl` and `.summary.json`.

**Protocol:** Games with indices 2k and 2k+1 use the same seed and exchange which AI controls each board color. The deterministic RNG covers opening rolls and subsequent rolls. The game's standard doubling and acceptance policies remain enabled, with an unlimited point match (`len=0`). Outcomes record points and whether the opponent declined a cube. All records carry the SHA-256 of the original HTML. A single unfinished game cannot be counted as a loss, and incomplete batches cannot be described as 100-game results.

A full high-effort EM6 search includes an extra ply and is computationally expensive. The initial Actions workflow is only a **bounded feasibility pilot** (probe and at most two games per primary matchup); it does **not** claim that the requested 100 games are finished. Only scale up after inspecting real timings and any correctness issues.

Limitations: deterministic paired initial seeds do not make moves/dice paths identical after two agents choose different moves; confidence intervals and statistical comparisons should account for the pair design. In `max-turns` termination, the game counts as unfinished, not a loss. Cube actions are counted separately.
