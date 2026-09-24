# WASM migration resume state

- source branch: `feat/android-release-packaging`
- frozen source baseline: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- readable oracle source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- benchmark corpus: `求解器的数独基准测试盘面参考.txt` (57 validated boards)
- migration branch: `codex/wasm-human-techniques-migration`
- recovery checkpoint before the bounded task: `7e23d42e249959ebeeb5690ddabe2b34d036f602`
- focused diagnostic harness commit: `9a147e240e388cff53ceca9012a898abc963fed2`
- current task status: historical full-trace vs isolated-#22 execution-environment comparison complete; shared-instance allocator history is the strongest supported difference, but causation is not yet proven; no solver fix was made
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
