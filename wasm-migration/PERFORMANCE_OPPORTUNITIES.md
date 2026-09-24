# PERFORMANCE_OPPORTUNITIES.md

These are performance opportunities deliberately **not** applied to the strict behavioral migration.

| Current JS contract | Faster idea | Expected benefit | Semantic risk / prerequisite |
|---|---|---|---|
| assumption propagation starts from cloned/snapshotted state | in-place mutation + undo log | lower copy traffic and allocation pressure in forcing chains | restoration order and intermediate observable state must be proven identical; requires new mutation/undo differential contracts |
| TECHNIQUE_CHAIN is strictly ordered and returns first match | reorder techniques by observed hit rate/cost | potentially large whole-solve latency reduction | changes selected Finding whenever multiple techniques are available; requires changing the user-visible behavioral contract |
| combinations and candidates use frozen enumeration order | reorder candidates/combinations by heuristic | reduces search work in chains, ALS, Exocet and pattern search | can change first pattern, elimination order, contradiction and DFC budget consumption |
| DFC budget is 6790 shared calls | wall-clock / adaptive / larger budget | may solve more expensive branches or exploit faster WASM | budget itself is calibrated behavior; changing it can expose different findings or allow paths the JS oracle currently aborts |
| nested Nishio depth is exactly one static level | deeper nesting | stronger deduction / fewer fallbacks | changes solver power, work ordering and budget use; explicitly outside behavioral port |
| per-technique search is recomputed for each hint state | cross-technique / cross-step caches | avoids repeated graph/ALS/fish construction | cache lifetime/invalidation and insertion order may alter first-match behavior; needs dedicated equivalence tests |
| Map/Set insertion order is observable in several advanced techniques | canonical sorting / unordered compact hash tables | simpler data structures and potentially faster lookup | sorting or hash iteration can change chain/path/reason selection and Finding array order |
| branch-heavy graph/path search | batch/vectorized/SIMD reformulation | possible speedup in dense mask operations | changing traversal to suit SIMD can change first-hit order; automatic SIMD enablement alone currently gives no guarantee of vector instructions |
| full Finding context is materialized after search | return smaller UI-only Finding | lower boundary conversion cost | current renderer/tests consume technique-specific context and ordered pattern data; would require a new public Finding contract |

The migration already applies representation changes that are behaviorally transparent and verified: 9-bit masks, integer fact ids, fixed indexed buffers, incremental unit masks, and a coarse WASM search boundary.

Any future optimization in this file should be treated as a **contract change proposal**, not silently folded into the migration branch.
