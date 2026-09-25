# Current migration verification status

## Local delivery, 2026-09-25 (supersedes historical coverage claims below)

From cleanup commit `caaef8df1b939142ac79445f33696e16bb092f78`, local Node 22.23.1 / AssemblyScript 0.27.31 incremental completed **57/57 puzzles and 4886/4886 exact ordered selected-Finding comparisons**, budget 6790. Raw pre/post states and per-case hash-bound results are in `evidence/full-trace/`. The original shared soundness checker passed replay on all 4886 post-states; negative tests detect all three required failure types.

Additional local gates: static propagation 1140, dynamic propagation 228 and dynamic finders 171 (both budget64 smoke), standalone finders 2679, static forcing finders 171, Node Worker parity, direct Node/browser bridge parity at budget6790, and real Edge module Worker parity at budget64 including optional solution validation. Coverage from the actual traces and five all-available states is 41 first-match / 35 all-available / 46 union out of 53. See DELIVERY_REPORT.md, COVERAGE.md and BENCHMARK.md for scope, limitations and measured results; manifest.json in the package binds final files.

The solver and frozen oracle were not changed. Changes are the CRLF corpus parser, acceptance/packaging tools, and optional known-solution Exocet validation at the browser Worker boundary. The original application HTML has not been switched to WASM. No remote writes or GitHub Actions operations occurred. All following workflow/runtime investigation sections are historical evidence, not claims about this local run.

This file is evidence, not a design promise. Update it when a gate changes.

## Canonical post-promotion state

- canonical branch: `codex/wasm-human-techniques-migration`
- canonical promotion HEAD: `be2ba5d41ca7ac1c54c14a05c45b95bd8b072f22`
- AssemblyScript `incremental` is the intended runtime.
- Senior Exocet, allocator-lifetime, and coarse-dispatch ABI investigations below are retained as historical validation evidence, not active migration tasks.


## Verified on GitHub Actions

Migration CI run evidence before the full-budget DFC benchmark:

- technique registry: **53**
- benchmark corpus: **57**
- static propagation differential: **1140/1140 pass**
- bounded dynamic propagation differential: **228/228 pass**
- bounded Dynamic Nishio/Unary first-match differential: **114/114 pass**
- bounded dynamic budget limit used by the fast gates: **64 calls**

The differential comparisons include observable ordering, not only mathematical validity:

- contradiction result;
- true-fact insertion order;
- false-fact insertion order;
- propagated grid;
- shared dynamic budget call count;
- Dynamic Nishio/Unary raw Finding, including elimination order and first-match selection.

## Soundness gate

The DevVer oracle now rejects:

1. deleting the true solution candidate;
2. filling a digit different from the true solution;
3. leaving an affected empty cell with zero candidates.

The same rule is used by oracle trace generation.

## SIMD observation

At the current milestone, scalar and `--enable simd` AssemblyScript builds are byte-for-byte identical. This is expected because no explicit `v128` rewrite has been introduced. It is evidence that compiler-feature enablement alone does not vectorize the branch-heavy forcing-chain code.

Explicit SIMD candidates remain documented in `PERFORMANCE_NOTES.md`; none will be accepted without same-corpus behavior and performance evidence.

## Known differential bug caught and fixed

The first Dynamic Unary finder differential found a migration-lifecycle mismatch:

- JS budget abort allocates fresh empty true/false Sets.
- The initial WASM port reset the set counts but left membership bits from the previous branch.
- Outer Unary membership checks could therefore observe stale branch facts.

The WASM abort path now clears membership state as well as counts. The 57-board Dynamic Nishio/Unary finder differential passes after this fix.

This is precisely why migration acceptance is based on exact behavioral differential tests rather than final-solution equality alone.


## Runtime lifecycle selection

Controlled runtime/lifecycle comparison evidence: workflow `36018679055`, comparison commit `9225d571a84db0f05bcc836d4a848081447844b9`.

Using the same one-instance #1→#22 workload and exact selected-Finding oracle:

- `stub`: parity remained correct until failure, then #22 trapped at step 5 with `RuntimeError: unreachable`; peak linear memory reached 4 GiB.
- `incremental`: completed all 22 puzzles with **1867/1867 exact selected-Finding parity**; peak/final linear memory **524288 bytes / 8 pages**; elapsed **364776 ms**; WASM size **142447 bytes**; no explicit boundary collection.
- `minimal` + puzzle-boundary `__collect()`: completed all 22 puzzles with **1867/1867 exact selected-Finding parity**; peak/final linear memory **2147483648 bytes / 32768 pages**; elapsed **362714 ms**; WASM size **118413 bytes**; requires explicit collection at safe puzzle boundaries.

Measured conclusion: `incremental` is the canonical intended runtime. `stub` is unsuitable for the long-lived shared solver instance. `minimal` remains diagnostic evidence only and is not the documented production runtime.


## Incremental Senior Exocet lifetime diagnosis

Bounded diagnostic workflow: `36024183156`.

Exact failing target from the standalone suite:
- benchmark case: `#4`
- technique: `49 / seniorExocet`
- standalone-suite invocation ordinal: `188`
- JS oracle result: `null`
- exact grid/masks/givens captured in the diagnostic artifact.

Observed A/B:
- fresh incremental core: exact target returns `null`, exact oracle parity, 4 pages before and after the call;
- accumulated incremental core after the exact preceding 187 standalone-suite calls: same input and target trap with `RuntimeError: memory access out of bounds` at 8 pages.

Named/debug stack:
`~lib/rt/tlsf/insertBlock -> ~lib/rt/itcms/step -> ~lib/rt/itcms/__new -> StaticArray<i32>#constructor -> exocet-finder/appearingTimes -> exactAppearingTimes -> seniorRow -> seniorExocetFind`.

The failing access occurs while the incremental runtime is allocating a fixed temporary `StaticArray<i32>` inside `appearingTimes`; this evidence does not by itself establish a GC bug, leak, or Senior Exocet algorithm defect.

Historical bounded workaround considered at this stage (later superseded and reverted after root-cause isolation):
- move only the three fixed scratch arrays used by `appearingTimes` (active/combo/chosen) to module scope and reuse them;
- preserve all loops, ordering, masks, first-match behavior, and result materialization;
- no Sudoku technique condition or algorithm is changed.

At this historical stage, fast-gate and exact-reproduction validation was still required before incremental runtime promotion; those gates later passed.


### Follow-on named-stack evidence: Nice Loop

After the first Exocet scratch-lifetime fix, the exact original case-#4 Senior Exocet reproduction passed under the accumulated 187-call history, but the full standalone differential progressed further and then trapped at case #5, technique `29 / niceLoop`.

Named/debug incremental stack:
`~lib/rt/tlsf/insertBlock -> ~lib/rt/itcms/step -> ~lib/rt/itcms/__new -> StaticArray<i32>#constructor -> aic-finder/strongPartners -> niceDfs -> niceDfs -> niceLoopFind`.

Source inspection identifies the allocation at `strongPartners` as its fixed local `StaticArray<i32>(9)` remainder buffer. `strongPartners` is non-reentrant: it fully constructs the partner list and returns before recursive DFS continues. The bounded follow-on fix therefore reuses one module-scoped 9-entry scratch buffer for that helper only. Partner discovery, traversal order, recursion, first-match behavior, and Finding materialization are unchanged.

At this historical stage, validation was still required before incremental runtime promotion; later root-cause isolation superseded this workaround and the canonical gates passed.


### SK Loop heap-corruption isolation and capacity fix

Additional bounded isolation evidence:
- prefix-isolation workflow: `36024524778`
- transition workflow: `36024782311`
- exact Senior Exocet target remained benchmark case `#4`, technique `49 / seniorExocet`, JS oracle result `null`;
- exact target grid: `600800070000040012000007003840000000200500400705000080000080000003600009001002030`;
- exact candidate masks: `[0,279,266,0,279,277,272,0,24,276,468,448,260,0,308,432,0,0,281,403,394,259,307,0,432,312,0,0,0,288,327,359,293,375,306,113,0,293,288,0,357,421,0,288,97,0,293,0,271,295,301,295,0,33,280,370,362,333,0,285,115,58,121,24,210,0,0,81,25,211,26,0,280,496,0,328,336,0,240,0,248]`;
- standalone-suite target ordinal: `188`.

History isolation:
- prefix through ordinal `184` (case #4 technique `45 / tridagonForce`) leaves the exact Senior Exocet target healthy;
- adding ordinal `185` (case #4 technique `46 / skLoop`) is the first prefix that makes the later Senior Exocet allocation trap;
- adding MSLS or Junior Exocet is not required for the failure;
- same-state Junior Exocet -> Senior Exocet on a clean incremental core succeeds.

Concrete implementation defect in `skloop-finder.ts`:
- `pairMasks` was allocated as `new StaticArray<u8>(9*32)`, valid indices `0..287`;
- the table is indexed by Sudoku digit as `pairMasks[d*32+n]` with `d = 1..9`;
- digit 9 therefore writes starting at index `288`, one 32-entry digit slice past the allocation;
- the write is inside `unchecked(...)`, so the old layout can corrupt adjacent managed/allocator memory instead of trapping at the actual write site.

Smallest behavior-preserving fix:
- allocate `pairMasks` as `10*32` entries;
- keep the existing 1-based digit indexing, enumeration, masks, ordering, first-match behavior, and Finding semantics unchanged.

This is a concrete capacity/indexing defect. The later allocator trap is consistent with prior heap-state corruption from that unchecked out-of-bounds write; no claim is made that AssemblyScript incremental GC itself is defective.

At this historical stage, exact Senior reproduction plus the specified fast differential/Worker gates still had to pass before incremental runtime promotion; they later passed.


### Follow-on named-stack evidence: recursive Nice Loop frame

After hoisting the non-reentrant `strongPartners` remainder scratch, standalone validation again progressed to case #5 `niceLoop`, then trapped one allocation later.

Named/debug stack:
`~lib/rt/tlsf/insertBlock -> ~lib/rt/itcms/step -> ~lib/rt/itcms/__new -> StaticArray<u8>#constructor -> aic-finder/niceDfs -> niceDfs -> niceLoopFind`.

The source-level allocation is the recursive frame's `pDigits/pCounts/pCells` partner-buffer set. Because parent frames remain live while child DFS calls execute, these buffers cannot be replaced by one shared array. The bounded fix preallocates six module-scoped frame-specific buffer sets, matching the existing `currentPathCount 2..7` recursion contract, and selects by frame. No link ordering, recursion depth, partner enumeration, first-match logic, or Finding data is changed.

At this historical stage, fast-gate validation remained the authoritative acceptance gate.


## Final bounded incremental-runtime root cause

Prefix isolation evidence recorded in commit `495e2baf047218e78c8e8c377ea15fb3e668242d` identified the first history transition that makes a later managed allocation fail:

- standalone prefix through ordinal 184 remains healthy;
- adding ordinal 185, case #4 technique `46 / skLoop`, poisons the later allocator state;
- MSLS and Exocet calls after SK Loop are not required to create the failure.

Concrete defect:
- `skloop-finder.ts` allocated `pairMasks` as `9*32` bytes, valid indices `0..287`;
- the table is intentionally indexed by Sudoku digit `d = 1..9` as `pairMasks[d*32+n]`;
- digit 9 therefore starts at index `288`, outside the old allocation;
- because the access is wrapped in `unchecked`, the write can corrupt adjacent managed/allocator memory and the eventual trap appears later inside unrelated `__new` / TLSF operations.

Behavior-preserving fix:
- size `pairMasks` as `10*32` so the existing 1-based digit slices `1..9` are valid;
- do not alter digit order, pair enumeration, SK Loop matching, first-match semantics, candidate masks, or Finding output.

The earlier Exocet/AIC scratch-hoisting experiments were diagnostic workarounds for later allocator manifestations, not the root cause. They are reverted in the final bounded fix so the solver change remains minimal: only the SK Loop scratch capacity is changed.

At this historical stage, `incremental` remained a candidate pending the exact Senior Exocet reproduction and specified fast gates. Those gates later passed and canonical promotion completed.


### Incremental coarse-dispatch ABI diagnosis

Fast-gate run `36025366014` passed static propagation, dynamic propagation, dynamic finder, standalone finder, Exocet report, and static forcing-chain checks after the SK Loop capacity correction, but Worker parity trapped before comparing results.

Focused diagnostic workflow: `36026246748`.

Exact failure:
- benchmark case: `#22`;
- main-thread parity setup ran standalone ids `0,1,2,28,35,40,41,46,47,48,49` successfully;
- the following coarse `findNextStepWasm(..., budgetLimit=64)` call trapped with `RuntimeError: unreachable`;
- `debugLastTechniqueSearchId()` remained `-1`, proving the real dispatcher body had not started.

Debug stack:
`assembly/core/runFindNextTechniqueIdFrom@varargs -> findNextStepWasm`.

Generated WAT shows that AssemblyScript emitted a varargs/default-argument wrapper for the exported function. That wrapper checks the runtime `~argumentsLength` global and executes `unreachable` for an out-of-range argument count. This project instantiates WebAssembly directly and calls exports directly; it does not use the AssemblyScript loader to update `__setArgumentsLength` before ordinary export calls.

Boundary-only fix:
- remove default values from exported `runFindNextTechniqueIdFrom`, `runFindNextTechniqueId`, and `runScanAvailableTechniques` parameters;
- all production adapter calls already supply explicit budget values;
- this removes generated `@varargs` wrappers while leaving technique order, budget semantics, first-match behavior, and solver logic unchanged.

The fix is an ABI/integration correction, not a Sudoku algorithm change.


### findAll shared-result-buffer materialization fix

Fast-gate run `36026637703` on the SK Loop + coarse-dispatch ABI fixes passed static, dynamic, dynamic-finder, standalone, Exocet-report, and static forcing-chain gates, then Worker parity reached `findAllAvailableStepsWasm` and failed with:

`WASM availability scan marked technique 48 but adapter could not materialize its Finding`.

This is a boundary/materialization defect, not a Sudoku discovery mismatch:
- the coarse `runScanAvailableTechniques` scan correctly marked Junior Exocet id 48 available on benchmark #22;
- the scan then continued to Senior Exocet id 49;
- Junior and Senior Exocet intentionally share one Exocet result buffer, and Senior resets that buffer;
- the adapter subsequently materialized id 48 with `alreadyRun=true`, assuming its earlier result buffer still existed, so it observed `null`.

The same structural risk exists for other finder groups that share module result buffers across ids. Smallest boundary-only correction:
- keep the one coarse availability scan and its hit mask;
- materialize only reported hit ids;
- rerun each hit finder during materialization (`alreadyRun=false`) so its own result buffer is current;
- preserve registry order, candidate input, first-match/discovery semantics, Finding ordering, and the public JS/Worker API.

`findNextStepWasm` is unchanged because its dispatcher stops at the selected technique, so that selected finder result remains current for immediate materialization.


## Canonical promotion complete

The incremental runtime fast gates passed on the exact promotion candidate, and canonical promotion is complete.

- WASM Migration CI run `36027696019`: **SUCCESS**.
- Incremental Senior Exocet Diagnostic run `36027696132`: **SUCCESS**.
- canonical promotion HEAD: `be2ba5d41ca7ac1c54c14a05c45b95bd8b072f22`.
- AssemblyScript `incremental` is the intended runtime.
