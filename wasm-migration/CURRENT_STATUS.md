# Current migration verification status

This file is evidence, not a design promise. Update it when a gate changes.

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

Measured conclusion: `incremental` is the preferred migration runtime. `stub` is unsuitable for the long-lived shared solver instance. `minimal` remains diagnostic evidence only and is not the documented production runtime.


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

Smallest behavior-preserving implementation/lifetime fix under validation:
- move only the three fixed scratch arrays used by `appearingTimes` (active/combo/chosen) to module scope and reuse them;
- preserve all loops, ordering, masks, first-match behavior, and result materialization;
- no Sudoku technique condition or algorithm is changed.

Fast-gate and exact-reproduction validation is required before incremental runtime promotion.


### Follow-on named-stack evidence: Nice Loop

After the first Exocet scratch-lifetime fix, the exact original case-#4 Senior Exocet reproduction passed under the accumulated 187-call history, but the full standalone differential progressed further and then trapped at case #5, technique `29 / niceLoop`.

Named/debug incremental stack:
`~lib/rt/tlsf/insertBlock -> ~lib/rt/itcms/step -> ~lib/rt/itcms/__new -> StaticArray<i32>#constructor -> aic-finder/strongPartners -> niceDfs -> niceDfs -> niceLoopFind`.

Source inspection identifies the allocation at `strongPartners` as its fixed local `StaticArray<i32>(9)` remainder buffer. `strongPartners` is non-reentrant: it fully constructs the partner list and returns before recursive DFS continues. The bounded follow-on fix therefore reuses one module-scoped 9-entry scratch buffer for that helper only. Partner discovery, traversal order, recursion, first-match behavior, and Finding materialization are unchanged.

Validation remains required before incremental runtime promotion.


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

Exact Senior reproduction plus the specified fast differential/Worker gates must pass before incremental runtime promotion.


### Follow-on named-stack evidence: recursive Nice Loop frame

After hoisting the non-reentrant `strongPartners` remainder scratch, standalone validation again progressed to case #5 `niceLoop`, then trapped one allocation later.

Named/debug stack:
`~lib/rt/tlsf/insertBlock -> ~lib/rt/itcms/step -> ~lib/rt/itcms/__new -> StaticArray<u8>#constructor -> aic-finder/niceDfs -> niceDfs -> niceLoopFind`.

The source-level allocation is the recursive frame's `pDigits/pCounts/pCells` partner-buffer set. Because parent frames remain live while child DFS calls execute, these buffers cannot be replaced by one shared array. The bounded fix preallocates six module-scoped frame-specific buffer sets, matching the existing `currentPathCount 2..7` recursion contract, and selects by frame. No link ordering, recursion depth, partner enumeration, first-match logic, or Finding data is changed.

Fast-gate validation remains authoritative.
