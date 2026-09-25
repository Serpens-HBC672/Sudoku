# MIGRATION.md

## Local delivery addendum

The local completion starts at `caaef8df1b939142ac79445f33696e16bb092f78`; the final local source commit and file identities are in the delivery manifest. AssemblyScript solver sources and the frozen oracle are unchanged from that starting point. The Windows corpus parser now normalizes CRLF for parsing while retaining the original-byte hash. The browser Worker accepts optional `solution` on `loadPosition` and uses the exact original `exocetFindingMatchesSolution` boundary rule; it resets that value on every load and initialization. No technique algorithm, ordering, budget or Finding representation changed.

The full local trace gate passed 57 puzzles / 4886 ordered Findings at budget6790; direct coarse Node/browser entries and real Edge Worker were also checked at their documented scopes. Actual performance and the seven techniques not observed in trace/coverage samples are reported in BENCHMARK.md and COVERAGE.md. Do not interpret adapter acceptance as an already-deployed original application; original HTML is retained as oracle and application-level integration/custom-order/detailed-chain UI validation has not been performed.

# Human-technique JS → WASM migration

## Authority and scope

Authoritative readable source:

- branch: `feat/android-release-packaging`
- baseline: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- source Git blob: `80402c3fadd8a7cd408fc283ea6e9632fa8833cc`
- benchmark: `求解器的数独基准测试盘面参考.txt`
- benchmark Git blob: `3ebce44796bc41a18d94f2b00925f762a13365fd`

The readable DevVer implementation remains the behavioral oracle. The mangled/minified `main` HTML is not a migration source.

In scope: the human-style solving / technique-discovery engine, candidate state, forcing-chain propagation, JS Finding compatibility, main/Worker computation adapters, differential/oracle/coverage/benchmark infrastructure.

Explicitly excluded: **MRV/backtracking generator**, UI/UX, DOM rendering, message text generation, CSS/navigation, Android packaging, APK/AAB/signing/release work, Base64 embedding, and DLX except as an independent pre-existing validation helper if needed.

No commit in this migration is a merge to `main`.

## Language decision

AssemblyScript **0.27.31** is retained.

The real forcing-chain hotspot, not a helper microbenchmark, was ported first: board/candidate masks, incremental unit masks, static propagation, dynamic mid-level propagation, nested Nishio, shared DFC budget, Dynamic Nishio/Unary/Multiple.

A C++ fallback was **not** started because AssemblyScript produced a practical improvement on the actual forcing-chain workload while passing exact behavioral gates. The final benchmark evidence is recorded in `BENCHMARK.md`.

The migration runtime is AssemblyScript `incremental`, selected from controlled shared-instance evidence rather than theory. On workflow `36018679055`, the historical `stub` runtime failed at #22 step 5 after reaching the wasm32 4 GiB linear-memory ceiling, while `incremental` completed #1→#22 with exact 1867/1867 selected-Finding parity, peak/final linear memory of 524288 bytes (8 pages), and no explicit collection calls. `minimal` plus explicit `__collect()` at completed-puzzle boundaries also preserved 1867/1867 parity, but retained a 2 GiB peak/final linear-memory footprint and requires explicit lifecycle hooks, so it is not the production runtime.

## Candidate and board representation

- board: fixed 81-cell row-major byte storage
- candidate state: fixed 81-entry `u16` masks
- authoritative invariant: `(mask & ~0x1FF) == 0`
- bit `d-1` represents Sudoku digit `d`
- row/column/box candidate positions: 9-bit masks
- facts: integer ids `r*81 + c*9 + (d-1)`
- temporary digit arrays exist only at compatibility/context boundaries

Candidate Sets/Arrays are not the authoritative migrated representation.

## Propagation representation

The WASM propagation core mirrors the incremental JS `propagateAssumptionCore` contract:

- fixed grid and cell candidate masks
- unit-digit position masks
- placed-digit masks
- ordered true/false fact buffers plus membership bitsets
- touched-cell and touched-unit/digit tracking
- explicit outer-frame snapshot/restore for one nested dynamic layer
- stable contradiction checks
- row-major / unit / digit ordering
- 200-iteration guard
- exact shared budget accounting

Dynamic mid-level propagation remains:

`Naked Single → Hidden Single → Locked Candidates → Naked Pair → Hidden Pair → Naked Triple → Hidden Triple → X-Wing → Swordfish → one-level nested Nishio`

No technique was added to or removed from that propagation list.

## DFC and nesting contract

Current frozen DFC budget: **6790 calls**.

The value is a semantic limit, not a wall-clock target. Faster WASM execution does not reset or raise it.

Preserved:

- shared call counter across branches;
- abort when the current JS contract aborts;
- fresh empty result membership state on budget abort;
- all Dynamic Multiple branches are evaluated before contradiction aggregation, matching JS array construction / `.some()` semantics;
- nested Nishio depth remains exactly one static-propagation level;
- candidate/assumption order is unchanged;
- first contradiction selection remains deterministic.

## Technique mapping

Ids are zero-based `TECHNIQUE_CHAIN` positions. The registry is derived from the oracle.

| id | JS technique key | WASM implementation |
|---:|---|---|
| 0 | nakedSingle | `basic-finders.ts / findNakedSingle` |
| 1 | hiddenSingle | `basic-finders.ts / findHiddenSingle` |
| 2 | lockedCandidate | `basic-finders.ts / findLockedCandidate` |
| 3 | gsp | `basic-finders.ts / findGsp` |
| 4 | nakedPair | `basic-finders.ts / findNakedSubset(2)` |
| 5 | hiddenPair | `basic-finders.ts / findHiddenSubset(2)` |
| 6 | nakedTriple | `basic-finders.ts / findNakedSubset(3)` |
| 7 | hiddenTriple | `basic-finders.ts / findHiddenSubset(3)` |
| 8 | nakedQuad | `basic-finders.ts / findNakedSubset(4)` |
| 9 | hiddenQuad | `basic-finders.ts / findHiddenSubset(4)` |
| 10 | xWing | `basic-finders.ts / findFish(2)` |
| 11 | swordfish | `basic-finders.ts / findFish(3)` |
| 12 | skyscraper | `basic-finders.ts / findSkyscraper` |
| 13 | twoStringKite | `basic-finders.ts / findTwoStringKite` |
| 14 | emptyRectangle | `basic-finders.ts / findEmptyRectangle` |
| 15 | jellyfish | `basic-finders.ts / findFish(4)` |
| 16 | squirmbagFish | `basic-finders.ts / findFish(5)` |
| 17 | finnedXWing | `basic-finders.ts / findFinnedFish(2)` |
| 18 | finnedSwordfish | `basic-finders.ts / findFinnedFish(3)` |
| 19 | finnedJellyfish | `basic-finders.ts / findFinnedFish(4)` |
| 20 | uniqueRectangleType1 | `basic-finders.ts / findUniqueRectangleType1` |
| 21 | uniqueRectangleType2 | `basic-finders.ts / findUniqueRectangleType2` |
| 22 | hiddenUniqueRectangle | `basic-finders.ts / findHiddenUniqueRectangle` |
| 23 | bugPlusOne | `basic-finders.ts / findBugPlusOne` |
| 24 | xyzWing | `basic-finders.ts / findWing(3,2)` |
| 25 | wWing | `basic-finders.ts / findWWing` |
| 26 | wxyzWing | `basic-finders.ts / findWing(4,3)` |
| 27 | xyChain | `basic-finders.ts / findXYChain` |
| 28 | aic | `aic-finder.ts / aicFind` |
| 29 | niceLoop | `aic-finder.ts / niceLoopFind` |
| 30 | sueDeCoq | `sdc-finder.ts / sdcFind` |
| 31 | fireworkTriple | `firework-finder.ts / fireworkFind(31)` |
| 32 | fireworkQuadruple | `firework-finder.ts / fireworkFind(32)` |
| 33 | fireworkWWing | `firework-finder.ts / fireworkFind(33)` |
| 34 | fireworkAlp | `firework-finder.ts / fireworkFind(34)` |
| 35 | pom | `basic-finders.ts / findPom` |
| 36 | alsXZ | `basic-finders.ts / findAlsXZ` |
| 37 | ahsXZ | `basic-finders.ts / findAhsXZ` |
| 38 | alsChain | `als-advanced.ts / alsChainFind` |
| 39 | deathBlossom | `als-advanced.ts / deathBlossomFind` |
| 40 | medusa3D | `medusa-finder.ts / medusaFind` |
| 41 | tridagon | `tridagon-finder.ts / tridagonFind` |
| 42 | unaryChain | `core.ts / runStaticUnaryFinder` |
| 43 | nishioChain | `core.ts / runStaticNishioFinder` |
| 44 | multipleChain | `core.ts / runStaticMultipleFinder` |
| 45 | tridagonForce | `core.ts / runTridagonForceFinder` |
| 46 | skLoop | `skloop-finder.ts / skLoopFind` |
| 47 | msls | `msls-finder.ts / mslsFind` |
| 48 | juniorExocet | `exocet-finder.ts / juniorExocetFind` |
| 49 | seniorExocet | `exocet-finder.ts / seniorExocetFind` |
| 50 | dynamicNishioChain | `core.ts / runDynamicNishioFinder` |
| 51 | dynamicUnaryChain | `core.ts / runDynamicUnaryFinder` |
| 52 | dynamicMultipleChain | `core.ts / runDynamicMultipleFinder` |

The shared propagation functions corresponding to JS `propagateAssumptionCore`, `propagateAssumption`, `propagateAssumptionDynamic` and nested Nishio are implemented in `assembly/core.ts`.

## Ordering guarantees

The behavioral port intentionally preserves:

- TECHNIQUE_CHAIN order;
- row / column / box order;
- digit ascending order;
- JS combination enumeration order;
- Set/Map insertion-order dependent outputs where observable;
- candidate enumeration order;
- first-match selection;
- selected pattern;
- fill selection;
- elimination order;
- patternCells order;
- AIC/Medusa/chain traversal order;
- forcing-chain assumption order;
- contradiction order;
- DFC budget and abort behavior.

Mathematical equivalence alone is not accepted.

## Finding ABI and adapter

WASM uses packed fixed buffers and tagged metadata internally. JS-facing code receives the existing Finding object shape.

```text
WASM result buffers
  -> sudoku-wasm-adapter.js
  -> existing Finding contract
  -> existing renderer/message/UI
```

The UI does not depend on internal WASM layouts.

The preferred boundary is coarse:

- `findNextStepWasm`: one in-WASM ordered registry search, then result materialization;
- `findAllAvailableStepsWasm`: one in-WASM full-registry availability scan, then materialization only for hit techniques.

The Exocet solution validator remains an external validation contract in migration/oracle tests. If it rejects a selected Exocet finding, the coarse dispatcher resumes at the next registry id rather than changing Exocet discovery.

## Main thread / Worker

Both paths instantiate **the same `sudoku-techniques.wasm`**:

```text
                    -> main-thread adapter
same .wasm module <
                    -> Worker adapter
```

The Worker exposes coarse `findNext` and `findAll` operations plus lower-level differential diagnostics. It does not retain the old JS engine as a second solving authority.

## Shared soundness contract

A selected finding is a hard failure when:

1. it eliminates the known solution digit from a cell;
2. it fills a digit different from the known solution;
3. applying it leaves an unsolved affected cell with zero candidates.

Case 3 was upgraded from report-only behavior to an actual shared validation failure. Multiple zero-candidate cells are reported in stable row-major order.

Exhaustive known-solution validation stays in migration/testing paths; production need not pay the cost of a full known-solution check.

## Semantic differences

No intentional Sudoku technique-discovery semantic difference is permitted.

Implementation-only differences that are not observable solver semantics include:

- Sets/Maps replaced by indexed bitsets/fixed arrays while explicitly preserving insertion-order outputs;
- packed integer fact/cell ids;
- fixed result buffers;
- direct WASM ABI instead of JS collections;
- AssemblyScript incremental runtime for measured long-lived shared-instance lifecycle safety without explicit puzzle-boundary collection.

Any final validation exception must be documented here before delivery; it must not be hidden by output sorting or test normalization.

## Performance opportunities intentionally not applied

See `PERFORMANCE_OPPORTUNITIES.md`.

The most important deferred ideas are in-place mutation + undo logs instead of snapshot/clone behavior, cross-technique caches, reordered search, more aggressive pruning and altered DFC limits/depth. They are not applied because each can change observable discovery order or calibrated forcing-chain semantics.

## Known remaining risks

- Seven registry techniques are not observed by either the complete first-match corpus trace or the bounded all-available coverage sample; see `COVERAGE.md`.
- The strict oracle contract makes branch-heavy search less amenable to automatic SIMD vectorization.
- Long-running full-trace and representative benchmark workflows are intentionally separated from fast CI because the extreme puzzles are expensive.
- The final owner-specific Base64 embedding step remains outside this branch.

## MRV exclusion

There is no MRV WASM implementation in this migration. The generator remains owned by the repository owner as explicitly requested.
