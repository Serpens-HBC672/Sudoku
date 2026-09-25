# WASM migration resume state

> **Archived migration / diagnostic state.** This file preserves historical migration evidence.
> Its former `current task`, `next task`, candidate-runtime, and promotion instructions are no longer authoritative.
> For current canonical state, use:
> - `wasm-migration/CURRENT_STATUS.md`
> - `wasm-migration/MIGRATION.md`
> - `wasm-migration/BUILD.md`
> - `wasm-migration/WASM_USAGE.md`

- source branch: `feat/android-release-packaging`
- frozen source baseline: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- readable oracle source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- benchmark corpus: `求解器的数独基准测试盘面参考.txt` (57 validated boards)
- migration branch: `codex/wasm-human-techniques-migration`
- recovery checkpoint before the bounded task: `7e23d42e249959ebeeb5690ddabe2b34d036f602`
- focused diagnostic harness commit: `9a147e240e388cff53ceca9012a898abc963fed2`
- current task status: controlled exact-state fresh-vs-accumulated A/B complete; identical #22 step-5 state and technique 47/MSLS succeeds on a fresh core and traps after historical #1-#21/#22-prelude allocator history; no solver fix was made
- scope remains human-style technique WASM migration only; MRV, UI/UX, Android packaging, and unrelated application logic remain out of scope

## Recovered commits since the previously visible checkpoint

The previously visible checkpoint was approximately `1a4b8bdef4a744e962eb3691dc80db5d202b0cd8`.

Relevant commits after it:

- `e70b931fead4`: switch AssemblyScript build runtime from `stub` to reclaiming `minimal`
- `74a2cc35d0d`: trigger exhaustive trace under the minimal runtime
- `718e433f2bc2`, `3da6a2cca368`, `ef58a414e85d`, `edf780334e19`: build / ABI / contract / deferred-performance documentation consolidation
- `eba3a8f28778`: record technique coverage evidence
- `1b8d02d9dd36`: expose dispatcher last-technique diagnostic
- `7d5c68baff1b`: report case / step / expected technique / last dispatcher technique on full-trace crash
- `7e23d42e2499`: trigger the diagnostic full-trace run
- `9a147e240e38`: add the bounded #22 MSLS standalone reproduction harness

## Known passing evidence retained from earlier work

- strict benchmark parser: 57 boards
- technique registry: 53
- static propagation differential: 1140/1140
- bounded dynamic propagation differential: 228/228
- Dynamic Nishio/Unary/Multiple finder differential: 171 comparisons
- DFC benchmark at the `1a4b8bd` lineage was green; the previously observed Golden Nugget DFC hotspot showed a large WASM speedup
- do not rerun DFC merely to reconfirm already-passing work

## Full-trace evidence and failure separation

Historical exhaustive trace at `3fb98015986848e20025f8d1b1881f28fa6978e4`:

- #1 through #21 completed with exact selected-Finding parity
- #22 later terminated with `RuntimeError: unreachable`
- the JS stack reached `runStandaloneTechniqueFinder`
- that SHA did not expose the selected technique id at the moment of failure, so the stack alone does **not** identify MSLS / technique 47

Later diagnostic trace at `7e23d42e249959ebeeb5690ddabe2b34d036f602` after switching to the `minimal` runtime:

- failed much earlier at #1 step 0
- diagnostic value was `lastTechniqueId = -1`
- this is a distinct failure shape and must not be used as evidence that the historical #22 trap was caused by MSLS

Do not run another full 57-puzzle trace until the historical #22 trap has been isolated with a bounded dispatcher/materialization reproduction.

## Focused #22 MSLS diagnosis

Focused workflow run: `36004028047`.

The focused test:

- loads benchmark #22 only
- generates the frozen JS oracle trace for #22 only
- selects only trace states whose expected technique is MSLS or later in TECHNIQUE_CHAIN
- for each selected state, loads the same grid/candidate masks and directly calls `runStandaloneTechniqueFinder(core, 47)`
- deep-compares the returned MSLS Finding with the frozen JS oracle MSLS Finding
- has a 6-minute job timeout and a 240-second in-test cap
- does not run the 57-board trace, DFC benchmark, or additional technique migration

Results:

1. Historical target `3fb98015986848e20025f8d1b1881f28fa6978e4`
   - 10 relevant #22 states were exercised
   - all MSLS standalone findings matched the JS oracle
   - no WASM trap occurred
   - the matrix job was marked failed only because the first diagnostic harness intentionally expected a historical trap and that expectation was falsified

2. Recovered target `7e23d42e249959ebeeb5690ddabe2b34d036f602`
   - the same 10 relevant #22 states passed
   - no WASM trap occurred
   - elapsed focused-test time: about 190889 ms

Conclusion:

- the historical #22 `unreachable` is **not reproduced by MSLS standalone**
- repeated MSLS allocation / MSLS-specific stub-runtime exhaustion is therefore not sufficient to explain the historical failure
- do not modify MSLS discovery, ordering, matching, candidate masks, or result ABI based on that hypothesis
- the historical failure requires a broader dispatcher / selected-technique materialization sequence, or another technique handled by `runStandaloneTechniqueFinder`

## Exact next task for a future run

Only if work is resumed:

1. stay on the current migration branch and re-read this file first
2. do not run the 57-board full trace
3. construct a bounded #22-only dispatcher/materialization reproduction against the historical failing SHA
4. log the selected technique id immediately before materialization / `runStandaloneTechniqueFinder`
5. stop at the first reproduced trap and identify the exact technique/state
6. make no solver fix until that reproduction exists

## Semantic constraints

- readable JS remains the behavioral oracle
- preserve TECHNIQUE_CHAIN, traversal order, digit order, combination order, first-match behavior, Finding selection, elimination/pattern ordering, forcing-chain fact ordering, DFC budget semantics, and nested propagation depth
- candidate state in compiled code remains strict 9-bit: `(mask & ~0x1FF) == 0`
- do not sort outputs to make differentials pass
- main-thread and Worker paths must use the same WASM core
- do not modify `main`


## One-state #22 MSLS follow-up (latest bounded task)

This section supersedes the earlier 10-state MSLS sweep as the authoritative evidence for the latest request.

Focused temporary workflow run: `36006543354` (success).
Historical target under test: `3fb98015986848e20025f8d1b1881f28fa6978e4`.
No full #22 solve and no 57-puzzle trace were run for this task.

State location:
- the frozen oracle was bounded with `tracePuzzle(..., 512, true)`, which stops at the first DFC state
- first DFC state in #22: step `2`
- expected technique: `dynamicNishioChain`
- because MSLS is TECHNIQUE_CHAIN id `47` and Dynamic Nishio is id `50`, this is the earliest recorded #22 state that guarantees the dispatcher would pass through MSLS before reaching the expected technique

Exact recorded state:
- `beforeGrid`: `000000039000010005003005800008009006070020000100400000009008050020000600400700000`
- `beforeMasks`: `[242,185,123,162,232,106,11,0,0,482,424,106,422,0,110,74,106,0,354,297,0,290,360,0,0,107,75,22,28,0,21,84,0,95,75,0,308,0,56,181,0,37,285,393,141,0,308,50,0,244,100,342,450,198,100,37,0,39,44,0,79,0,75,212,0,81,277,284,13,0,457,205,0,181,49,0,308,39,263,387,135]`

Exactly one WASM technique call was then made:
- `runStandaloneTechniqueFinder(core, 47)`
- result: `null`
- no `RuntimeError: unreachable`
- no Finding, no eliminations

Diagnosis:
- the historical #22 failure is **not reproducible as a state-local MSLS failure on this first DFC state**
- therefore this state plus one MSLS invocation is not sufficient to explain the old full-trace `unreachable`
- do not change MSLS discovery, matching, ordering, candidate masks, or ABI based on the earlier allocation hypothesis
- the original `3fb9801` full-trace run did not record the exact failing step or technique id, so it is not proven that MSLS was the actual `runStandaloneTechniqueFinder` technique that trapped
- if diagnosis resumes later, the next bounded target is the dispatcher/materialization sequence needed to identify the exact technique id at the historical trap; do not return to a broad MSLS sweep

No solver fix was made in this task.


## Isolated historical #22 standalone-call trap diagnostic

This is the latest bounded diagnostic task and supersedes the prior proposed dispatcher/materialization reproduction as the current evidence.

Diagnostic branch:
- `codex/wasm-22-trap-diagnostic`
- base: historical failing implementation `3fb98015986848e20025f8d1b1881f28fa6978e4`
- pre-call hook commit: `2c17c22979fc391166073462175a54017dc87cb3`
- bounded #22 harness commit: `7d703d3a2696953635ab64f1621349b00b0cefc7`
- workflow commit: `1c28c42200241cdad9c048d17016f59fe2823a06`
- workflow run: `36009770454` (success)

Scope:
- benchmark #22 only
- historical AssemblyScript `--runtime stub` build
- no 57-puzzle corpus run
- no additional migration
- no solver logic changes
- no MSLS optimization or allocator/runtime fix
- instrumentation only at the JS-to-WASM standalone technique boundary

Each standalone invocation wrote a synchronous pre-call breadcrumb before entering the finder:
- puzzle id
- solver step
- global standalone-call ordinal
- technique id/key
- 16-hex SHA-256 state fingerprint derived from `beforeGrid:beforeMasks`
- exported WASM linear-memory byte/page count

Result:
- #22 completed all `138/138` oracle trace steps
- exact selected-Finding comparisons remained green for the whole isolated trace
- total standalone calls: `2333`
- no `RuntimeError: unreachable`
- therefore there is no exact failing standalone technique id/call/state to extract from this run
- the historical full-corpus #22 trap is not reproducible by running #22 alone, even on the historical `3fb9801` implementation

Observed memory counters:
- first recorded WASM memory: `262144` bytes (4 pages)
- last/max recorded WASM memory: `2147483648` bytes (32768 pages / 2 GiB)
- delta: `2147221504` bytes
- growth events observed across standalone pre-call breadcrumbs: `6`
- the run nevertheless completed, so this is evidence of cumulative linear-memory growth under the historical stub runtime, not evidence that memory growth by itself caused the old trap

Last standalone breadcrumb on successful completion:
- solver step: `137`
- standalone call ordinal: `2333`
- technique: `0 / nakedSingle`
- state id: `dd32fd040b212dc8`
- WASM memory: `2147483648` bytes

Relevant changes between historical `3fb9801` and current checkpoint `886293e9`:
- `wasm-migration/package.json`: AssemblyScript runtime changed from `stub` to `minimal`
- `wasm-migration/assembly/msls-finder.ts`: hot-loop scratch arrays were changed to reusable module-scoped storage
- `wasm-migration/bridge/assembly-core.mjs`: dispatch/materialization changed from the historical JS loop that called each technique finder directly to a WASM dispatcher (`runFindNextTechniqueIdFrom`) followed by materialization of the already-run selected finder
- `wasm-migration/tests/full-trace-differential.mjs`: later crash breadcrumbs were added, including case, step, expected technique, and last dispatcher technique id
- additional diagnostic/focused harnesses and documentation were added after the historical failure

No causal conclusion is assigned to any of those changes. The new bounded evidence only establishes that isolated #22 on `3fb9801` can reach 2 GiB of exported WASM memory and still finish without the historical trap. The old failure may depend on execution context that this #22-only task intentionally did not reproduce; do not infer which context factor matters without a separately authorized experiment.

No solver fix was made in this task.


## Historical full-trace failure vs isolated #22 environment comparison (latest bounded task)

### Run-ID correction

The run ID supplied as the "failed #22 workflow", `36006543354`, is not a failed full-trace run.

GitHub records `36006543354` as:
- workflow: `One-state MSLS`
- branch/head: `codex/wasm-msls-one-state` / `57fa77e35fd0ecb9a3b45c67c5d53d634e8ee89b`
- conclusion: `success`
- behavior: checkout historical target `3fb98015986848e20025f8d1b1881f28fa6978e4`, create a fresh WASM instance, and execute exactly one `runStandaloneTechniqueFinder(core, 47)` call at #22 step 2

The actual historical full-trace failure tied to `3fb98015986848e20025f8d1b1881f28fa6978e4` is workflow run `36000326922`.

That run:
- completed #1 through #21 successfully
- entered #22
- terminated with `RuntimeError: unreachable`
- stack reached `runStandaloneTechniqueFinder`
- did not log the exact failing technique id, step, or WASM memory size at the #22 boundary

The successful isolated #22 comparison run remains `36009770454`.

### Evidence table

| Evidence | FAILED RUN `36000326922` | SUCCESS RUN `36009770454` | DIFFERENCE | POSSIBLE RELEVANCE |
| --- | --- | --- | --- | --- |
| Checked-out implementation | `3fb98015986848e20025f8d1b1881f28fa6978e4` | `1c28c42200241cdad9c048d17016f59fe2823a06`, which is exactly 3 commits ahead of `3fb9801` | The only files changed between them are the added #22 diagnostic workflow/harness plus a 12-line JS bridge pre-call hook. No AssemblyScript source or package/build config changed. | Strong evidence that the WASM implementation/build inputs were intentionally kept historical; the main material change is harness/instrumentation, not Sudoku technique logic. |
| Workflow command | `node tests/full-trace-differential.mjs --ids all --out full-differential-results` | `node tests/benchmark-22-trap-diagnostic.mjs` | Full corpus versus #22 only. | High relevance. |
| Node | `v22.23.2` | `v22.23.2` | None. | Does not explain the difference. |
| npm | `10.9.8` | `10.9.8` | None. | Does not explain the difference. |
| AssemblyScript | package pins `0.27.31` | same package pin `0.27.31` | None visible. | Does not explain the difference. |
| Runtime mode | `--runtime stub` | `--runtime stub` | None. | Important because stub runtime never frees managed allocations, so allocation history persists within a reused instance. |
| Build flags | `--optimizeLevel 3 --shrinkLevel 0 --exportRuntime` | same | None. | Does not explain the difference. |
| Explicit initial-memory flag | none | none | None configured. | Failed-run initial pages were not logged. Successful isolated run directly observed 4 pages / 262144 bytes at its first standalone call. |
| Explicit maximum-memory flag | none | none | None configured. | No configured maximum is visible in the workflow/package command. Isolated run successfully reached 32768 pages / 2 GiB; this establishes observed size, not an explicit configured maximum. |
| Runner OS | Ubuntu 24.04.5 | Ubuntu 24.04.5 | None at OS release level. | Low relevance by itself. |
| Runner image | `ubuntu-24.04` image `20260920.314.1`, Azure `eastus` | `ubuntu-24.04` image `20260907.300.1`, Azure `westcentralus` | Different image revision/region. | Uncontrolled environmental difference, but weaker than the verified harness lifecycle difference because Node/npm/build flags were identical. |
| Earlier puzzles before #22 | Yes: logs prove #1-#21 completed in sequence before the trap in #22. | No. Only benchmark #22 was run. | Material. | High relevance for a non-collecting runtime. |
| WASM instantiation | `const core = await instantiateCore(WASM_URL)` occurs once before the outer puzzle loop. | `const core = await instantiateCore(WASM_URL)` occurs after selecting #22 and before its trace loop. | Shared instance across puzzles versus fresh instance for #22. | Highest-supported difference. |
| WASM instance reuse across puzzles | Yes, verified from `full-trace-differential.mjs`. | Not applicable; only #22 exists in the run. | Material. | #22 in the failed run inherits the same module/runtime/allocator state used by #1-#21. |
| Linear-memory reuse across puzzles | Yes. The same exported `core.memory` belongs to the single reused instance; `loadPosition` calls `resetInput` but does not instantiate a new module/memory. | Fresh linear memory for the new #22 instance. | Material. | Strong candidate explanation for why isolated #22 does not reproduce the trap. |
| Stub allocator lifecycle | Same stub runtime for all puzzles in the reused instance; no per-puzzle module recreation. | Same stub runtime, but lifetime begins immediately before #22. | Allocation history length differs drastically. | Strong relevance because the stub runtime is non-collecting / never frees managed allocations. |
| JS-side retained WASM allocations | No explicit managed WASM object pointers are retained by the historical full-trace harness. Findings are materialized as host JS arrays/objects from scalar exports; the report stores case metadata, not Finding objects. The persistent host reference is the `core` instance itself. | Same bridge model, plus diagnostic breadcrumbs stored as host JS objects. | No evidence of host-side pinning/reference retention causing the difference. | Points toward internal runtime/linear-memory lifetime rather than an obvious JS reference leak. |
| Memory immediately before #22 | Not logged. | Fresh run begins at 4 pages / 262144 bytes. | Exact historical boundary is unknown. | This is the critical missing measurement; do not claim the historical page count. |
| Memory growth during #22 | Not logged. | 4 pages -> 32768 pages / 2 GiB, six observed growth events, then #22 still completes 138/138. | Only isolated run is instrumented. | Shows #22 alone can consume/grow a very large stub-runtime memory footprint without trapping; it does not show what happened after #1-#21 had already consumed allocator space. |
| Process/resource limits | Workflow timeout 45 min; no RAM, cgroup, `ulimit`, `NODE_OPTIONS`, or V8 heap limit was logged. | Workflow timeout 20 min; likewise no explicit RAM/cgroup/`ulimit`/V8 limit logged. | Timeout differs; memory/resource ceiling not evidenced. | Timeout is not explanatory because the failed run trapped well before 45 min. Host memory ceiling cannot be compared from existing logs. |
| Outcome | #1-#21 pass; #22 later `RuntimeError: unreachable`. | #22 passes 138/138 with 2333 standalone calls. | Failure depends on context not present in isolated #22. | Consistent with accumulated module/runtime state; not yet proof of causation. |

### Harness-level conclusion

A concrete material difference is established:

- historical full trace `36000326922` created **one** WASM instance before the 57-puzzle loop and reused that same instance, allocator state, and linear memory through #1-#21 and into #22;
- isolated run `36009770454` created a **fresh** WASM instance for #22;
- both used the historical AssemblyScript `stub` runtime and the same visible compiler/build configuration;
- the stub runtime is non-collecting, so managed allocations are not reclaimed during the lifetime of that instance;
- `resetInput()` clears solver/input state but does not recreate the WASM instance or its linear memory.

Therefore #22 did begin under materially different WASM runtime/allocator history in the failed full trace versus the successful isolated run.

What is **not** established:
- the exact linear-memory page count at the #21 -> #22 boundary in the failed run;
- that memory exhaustion was definitively the cause of `unreachable`;
- any particular Sudoku technique as the cause;
- any causal role for the differing GitHub runner image revision/region.

### Smallest supported next reproduction experiment — do not run yet

If a future task explicitly authorizes another experiment, the smallest evidence-preserving reproduction is:

1. check out historical target `3fb98015986848e20025f8d1b1881f28fa6978e4`;
2. instantiate the WASM core exactly once;
3. execute the same WASM finder sequence for benchmark #1 through #21 using the frozen oracle states and the same validator, but suppress per-step console/report output;
4. immediately before starting #22, record `core.memory.buffer.byteLength` and pages;
5. run #22 on that same still-live instance with the existing pre-call technique breadcrumbs;
6. stop at the first trap, or record successful completion;
7. do not change solver logic, runtime mode, technique implementations, or allocator behavior.

This directly tests the only strongly evidenced lifecycle difference without rerunning unrelated migration work or all 57 puzzles.

No experiment was run and no solver change was made in this comparison task.


## Shared-instance #1→#22 historical reproduction (latest bounded task)

Purpose: test only whether the historical full-trace runtime/allocation history reproduces the #22 trap. No solver logic, AssemblyScript source, runtime mode, build flags, technique order, candidate state, or optimization was changed.

Diagnostic branch and run:
- branch: `codex/wasm-22-accumulated-runtime`
- historical implementation lineage: `3fb98015986848e20025f8d1b1881f28fa6978e4`
- inherited JS-only pre-call hook: `2c17c22979fc391166073462175a54017dc87cb3`
- harness commit: `49195f66165cc24696f3efd6621297cc0d3184df`
- workflow commit: `f7c729bf9810ccea67dd6eaf4bde3c6ec15ce0a5`
- preflight-only fix: `9112edaf06acc6b595eea20a0329718023fa8225`
- experiment workflow run: `36012154795` (completed)
- artifact: `sudoku-wasm-22-accumulated-runtime` / artifact id `10813655266`
- an earlier workflow attempt `36012083071` failed in the shallow-clone lineage preflight before install/build/test; it did not execute the experiment

The experiment instantiated exactly one WASM core and preserved the historical full-trace execution path for #1 through #22:
- same `findNextStepWasm` control flow
- same validator
- same selected-Finding deep comparison
- same `loadPosition` / `resetInput` calls
- same technique ordering
- same historical `--runtime stub --optimizeLevel 3 --shrinkLevel 0 --exportRuntime` build
- no core recreation between puzzles
- no run beyond #22

### Linear-memory sequence

`core.memory.buffer.byteLength` measures linear-memory size only; it is not a measurement of live allocated bytes and is not proof of a leak.

Initial immediately after core instantiation:
- 262144 bytes / 4 pages

After each completed warm-up puzzle:

| Puzzle | byteLength | pages |
| ---: | ---: | ---: |
| 1 | 134217728 | 2048 |
| 2 | 268435456 | 4096 |
| 3 | 268435456 | 4096 |
| 4 | 536870912 | 8192 |
| 5 | 536870912 | 8192 |
| 6 | 536870912 | 8192 |
| 7 | 1073741824 | 16384 |
| 8 | 1073741824 | 16384 |
| 9 | 1073741824 | 16384 |
| 10 | 1073741824 | 16384 |
| 11 | 1073741824 | 16384 |
| 12 | 1073741824 | 16384 |
| 13 | 1073741824 | 16384 |
| 14 | 1073741824 | 16384 |
| 15 | 1073741824 | 16384 |
| 16 | 1073741824 | 16384 |
| 17 | 1073741824 | 16384 |
| 18 | 1073741824 | 16384 |
| 19 | 1073741824 | 16384 |
| 20 | 1073741824 | 16384 |
| 21 | 2147483648 | 32768 |

Important #21→#22 boundaries:
- A — immediately after #21: 2147483648 bytes / 32768 pages
- B — immediately before first `loadPosition` for #22: 2147483648 bytes / 32768 pages
- C — immediately after first `loadPosition/resetInput` for #22: 2147483648 bytes / 32768 pages
- D — immediately before the first standalone technique call in #22: 2147483648 bytes / 32768 pages

Therefore `resetInput/loadPosition` did not reduce or recreate the shared WASM linear memory. #22 began with the same 2 GiB linear-memory size inherited from #1-#21.

### Reproduced trap

The first #22 runtime failure reproduced as:
- error: `RuntimeError: unreachable`
- solver step: `5`
- standalone-call ordinal within #22: `278`
- active technique call: `47 / msls`
- compact state id: `bb8d5eee4b435209`
- linear memory immediately before entering that call: 2147483648 bytes / 32768 pages
- linear memory when the exception was caught: 4294967296 bytes / 65536 pages

The final pre-call breadcrumb was synchronously written before entering `runMslsFinder`; no later standalone call began.

No #22 pre-call memory-size change was observed before the failing call. The most recent completed-puzzle boundary growth before the failure was:
- after #20: 1073741824 bytes / 16384 pages
- after #21: 2147483648 bytes / 32768 pages

The catch observed 4 GiB / 65536 pages, whereas the pre-call breadcrumb observed 2 GiB / 32768 pages. This establishes that linear memory increased during the failing call before the exception was caught. It does not by itself establish live allocation size, leaked objects, or the allocator's exact internal reason for trapping.

### Exact saved pre-call state

The run saved the exact failing pre-call state in the workflow artifact as `benchmark-22-failing-precall-state.json`.

- puzzle: `22`
- step: `5`
- standalone call: `278`
- technique: `47 / msls`
- state id: `bb8d5eee4b435209`
- `beforeGrid`: `000000039000010005003005800008009006070020000100400000009008050020000600400700000`
- `beforeMasks`: `[80,185,123,162,232,106,11,0,0,482,424,106,422,0,110,74,106,0,354,297,0,290,360,0,0,107,75,22,28,0,21,84,0,95,75,0,308,0,56,181,0,37,285,393,141,0,308,50,0,244,100,342,450,198,100,37,0,39,44,0,79,0,75,212,0,81,277,284,13,0,457,205,0,181,49,0,308,39,263,387,135]`

### Fresh-instance A/B comparison at the exact same call

The successful isolated #22 run `36009770454` reached the same:
- step `5`
- standalone ordinal `278`
- technique `47 / msls`
- state id `bb8d5eee4b435209`

In that fresh-instance run, the pre-call linear memory was:
- 1073741824 bytes / 16384 pages

That MSLS call completed and the next standalone call (`279 / juniorExocet`) began normally.

In the accumulated-runtime reproduction, the same state/call began at:
- 2147483648 bytes / 32768 pages

and trapped before call 279, with 4294967296 bytes / 65536 pages visible when caught.

Interpretation:
- the historical failure is now reproducible when #22 inherits #1-#21 runtime/allocation history;
- the active finder at the reproduced trap is MSLS, but this does **not** establish an MSLS logic defect;
- the same MSLS call/state succeeds with a fresh runtime at a smaller linear-memory size;
- the evidence therefore supports accumulated non-collecting runtime/allocation history as a necessary differentiating condition in these two runs;
- do not equate linear-memory size with live bytes, do not label this a proven leak, and do not infer allocator causation beyond the observed correlation without a separately authorized experiment.

No fix was made. Do not continue the migration automatically.


## Controlled exact-state runtime-history A/B (latest bounded task)

Goal: hold the Sudoku input and target technique constant while varying only prior WASM runtime/allocation history.

Diagnostic branch/run:
- branch: `codex/wasm-22-runtime-history-ab`
- historical implementation lineage: `3fb98015986848e20025f8d1b1881f28fa6978e4`
- harness commit: `f2f24b069845f62f389ab3484bb65af83d5ea2ea`
- workflow commit: `e625f4330ad84d6eba11f68ec6a9cf9ad7359211`
- workflow run: `36013831556` (success)
- artifact: `sudoku-wasm-22-runtime-history-ab` / artifact id `10813867511`

Both arms used the same built historical WASM core and the same exact saved target:
- benchmark `#22`
- solver step `5`
- technique `47 / msls`
- state id `bb8d5eee4b435209`
- `beforeGrid`: `000000039000010005003005800008009006070020000100400000009008050020000600400700000`
- `beforeMasks`: `[80,185,123,162,232,106,11,0,0,482,424,106,422,0,110,74,106,0,354,297,0,290,360,0,0,107,75,22,28,0,21,84,0,95,75,0,308,0,56,181,0,37,285,393,141,0,308,50,0,244,100,342,450,198,100,37,0,39,44,0,79,0,75,212,0,81,277,284,13,0,457,205,0,181,49,0,308,39,263,387,135]`

The two arms were executed in separate Node processes in the same workflow job so the fresh Arm A core could not remain live and contaminate Arm B.

### Arm A — fresh core, one direct MSLS call

Arm A:
- instantiated a new historical core
- loaded exactly the saved grid/masks and #22 givens
- executed no preceding #22 WASM technique calls
- called `runStandaloneTechniqueFinder(core, 47)` exactly once

Measurements:
- memory before load: `262144` bytes / `4` pages
- memory after load: `262144` bytes / `4` pages
- memory immediately before MSLS: `262144` bytes / `4` pages
- memory immediately after MSLS: `268435456` bytes / `4096` pages

Outcome:
- MSLS returned normally
- result: `null`
- no `RuntimeError`

### Arm B — accumulated historical core, exact target call

Arm B:
- instantiated a separate new historical core
- reproduced #1-#21 on one shared core using the historical `findNextStepWasm` path, validator, selected-Finding comparison, `loadPosition`, and `resetInput`
- completed `1729` warm-up trace steps through #21
- advanced #22 through steps 0-4 using the same historical path
- at saved step 5, reproduced the historical technique traversal only through ids 0-46
- verified immediately before the target call:
  - `beforeGrid` exact match: `true`
  - all 81 `beforeMasks` exact match: `true`
  - target technique id `47`: `true`
  - standalone ordinal at target: `278`: verified
- then called `runStandaloneTechniqueFinder(core, 47)` once and stopped

Measurements:
- memory after #21: `2147483648` bytes / `32768` pages
- memory before loading the saved step-5 state: `2147483648` bytes / `32768` pages
- memory after loading the saved state: `2147483648` bytes / `32768` pages
- memory immediately before MSLS: `2147483648` bytes / `32768` pages
- memory immediately after MSLS: unavailable because the call trapped
- memory when the exception was caught: `4294967296` bytes / `65536` pages

Outcome:
- `RuntimeError: unreachable`
- target pre-call identity was exactly:
  - step `5`
  - standalone ordinal `278`
  - technique `47 / msls`
  - state id `bb8d5eee4b435209`

### Controlled interpretation

This A/B establishes the requested sufficient reproduction condition under this harness:

- Arm A succeeds;
- Arm B fails;
- both use the same historical WASM implementation;
- both use the exact same grid, all 81 candidate masks, #22 givens, and technique id 47;
- the material experimental difference is the accumulated prior runtime/allocation history in Arm B.

Therefore accumulated runtime/allocation history is demonstrated as a sufficient condition for reproducing this failure under the tested harness.

This does **not** establish:
- an MSLS algorithm/logic defect;
- which specific prior allocation(s) are responsible;
- live managed-byte count;
- unreachable-object count;
- a memory leak.

Linear-memory size and allocator history remain distinct from live-object reachability.

The failing Arm B call entered at 32768 pages / 2 GiB and the catch observed 65536 pages / 4 GiB. `65536` WebAssembly pages is the wasm32 4 GiB linear-memory ceiling. This supports the conclusion that the failure occurs in a runtime state that reaches that address-space ceiling during the target call, but no stronger allocator/leak causation is claimed here.

No fix was made. Do not continue the migration automatically.
