# WASM migration resume state

- source branch: `feat/android-release-packaging`
- frozen source baseline: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- readable oracle source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- benchmark corpus: `求解器的数独基准测试盘面参考.txt` (57 validated boards)
- migration branch: `codex/wasm-human-techniques-migration`
- recovery checkpoint before the bounded task: `7e23d42e249959ebeeb5690ddabe2b34d036f602`
- focused diagnostic harness commit: `9a147e240e388cff53ceca9012a898abc963fed2`
- current task status: bounded #22 / MSLS diagnosis complete; no solver fix was made
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
