# Performance notes and deliberately deferred optimizations

This file records performance opportunities that are intentionally *not* used in the first WASM migration because they could change observable solver behavior or make differential validation harder.

## 1. `cloneGrid()` inside forcing-chain propagation

Current JS location:

- `propagateAssumptionCore()`
- each assumption starts with `const g = cloneGrid(grid)`

Potential faster structure:

- one mutable packed 81-cell board;
- an undo log / transactional stack for changed cells and candidate masks;
- rollback after each assumption instead of copying all 81 cells.

Why deferred:

The owner explicitly requires logic/behavior preservation first. In-place mutation plus rollback changes lifetime and mutation semantics across nested forcing-chain calls. It is a strong optimization candidate, but it should only be introduced after a behaviorally identical WASM port is established.

## 2. String/Set representation of forcing-chain facts

Current JS boundary behavior:

- internal fact indices are integers, but `propagateAssumptionCore()` converts true/false sets back to string keys such as `"r,c,d"` before returning;
- Unary/Multiple forcing-chain code depends on iteration order when selecting the first common conclusion.

Potential faster structure:

- 729-bit membership bitsets plus compact integer insertion-order arrays;
- no string conversion on the hot path.

What milestone 1 does:

The AS prototype already uses integer membership plus insertion-order arrays internally, but its test adapter compares the resulting order against the JS oracle. The public JS-facing behavior is not changed yet.

Why the external conversion is retained for now:

Changing outer forcing-chain consumers before their full differential port could alter which common conclusion is selected first.

## 3. Candidate arrays vs direct mask-only API

Current JS contract:

- `getCands(r,c)` returns an Array and may carry a `.mask` property;
- many modernized techniques read the mask, while older code still iterates the array.

Potential faster structure:

- `u16 candidateMask[81]` as the sole algorithm API;
- materialize digit arrays only when formatting a Finding for JS/UI.

Why deferred globally:

Changing all 53 techniques at once would combine representation migration with algorithm migration, making a mismatch harder to localize. The WASM core uses masks internally, while the JS-facing compatibility layer remains unchanged until each technique family is ported.

## 4. Precomputed peer table in WASM

Current JS:

- `PEERS_TABLE` stores the deduplicated peers for every cell.

Milestone-1 AS prototype:

- computes row/column/box peer loops directly when placing a digit;
- duplicate row/box and column/box visits become harmless no-ops after the candidate bit is cleared.

Potential faster structure:

- compact fixed 20-peer table per cell in linear memory.

Why not used yet:

The first milestone optimizes for auditability and exactness, not the last constant factor. Once the propagation differential suite is green, replacing the loops with a fixed peer table is low risk and can be measured separately.

## 5. SIMD

AssemblyScript build profiles include both scalar and `--enable simd` builds.

Important limitation:

The current prototype does not introduce explicit `v128` algorithms. The solver hotspot is dominated by branch-heavy search, first-match exits, 9-element scans, and irregular forcing-chain control flow. Simply enabling the WASM SIMD feature does not guarantee useful vector instructions.

Potential SIMD-friendly targets later:

- clearing/copying packed board/candidate buffers;
- comparing multiple candidate-mask lanes;
- bulk bitset operations for 729 forcing-chain facts;
- fixed peer/unit mask maintenance if data is repacked.

Why explicit SIMD is deferred:

Vectorizing the search loops now would either provide little benefit or require reordering/scanning transformations that risk violating first-match semantics. If the AssemblyScript dynamic hotspot remains too slow, the C++ fallback prototype should build and benchmark both:

- scalar: `-O3`
- SIMD: `-O3 -msimd128`

The SIMD build is accepted only if it wins on the same end-to-end corpus while preserving exact traces.

## 6. Technique-specific structural rewrites

Examples:

- replacing Set/Map-heavy graph techniques with packed adjacency arrays;
- replacing combination iterators with precomputed combination tables;
- caching candidate-derived structures across techniques in one state;
- merging multiple technique scans into one pass.

Why deferred:

These can reduce repeated work but also change enumeration order, allocation lifetime, cache invalidation rules, or the first matching structure. They are explicitly postponed until the corresponding technique has an exact JS↔WASM differential test.

## Performance acceptance principle

Microbenchmarks are diagnostic only. The migration decision is made on real end-to-end human-technique workloads, especially the DFC-heavy benchmark boards. A faster candidate-mask loop is not sufficient evidence that the migration succeeded.
