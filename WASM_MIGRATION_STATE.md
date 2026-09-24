# WASM migration resume state

- source branch: `feat/android-release-packaging`
- source baseline SHA: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- readable source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- benchmark corpus: `求解器的数独基准测试盘面参考.txt` (57 validated boards)
- migration branch: `codex/wasm-human-techniques-migration`
- recovered branch HEAD before this file: `ddbbf0a2050f2730f630a616823a8970f5853c2e`
- current phase: post-language-decision progressive migration / coarse first-match integration; do not repeat Phases A-D
- scope: human-style technique engine only; MRV, UI/UX, Android packaging and unrelated application logic remain out of scope

## Completed milestones / representative commits

- `f8fa3bfd2212`: strengthen solver soundness gate
- `eaf42cb7a1a9`, `612d1d4d5986`, `8d8c6fb38127`, `11a03a9636bd`: frozen JS oracle, strict 57-board corpus parser, trace/coverage tooling
- `0466542d52cf`, `7e4df19234c3`, `39fc62d5db1e`: AssemblyScript 9-bit propagation prototype and exact static differential
- `0bcda01742c5`, `a2c1d0f734ca`: dynamic propagation and dynamic-finder differential gates
- `d9b921424d26`: real DFC hotspot benchmark
- subsequent commits progressively ported/adapted the remaining technique families, shared Worker core, Exocet, and the coarse TECHNIQUE_CHAIN dispatcher
- `ddbbf0a2050f`: route `findNextStep` through the coarse WASM dispatcher

## Tests / evidence currently known

Passing evidence on the current migration lineage:
- strict benchmark parser: 57 boards
- technique registry: 53
- static propagation differential: 1140/1140
- bounded dynamic propagation differential: 228/228
- Dynamic Nishio/Unary/Multiple finder differential: 171 comparisons in the latest observed CI
- DFC benchmark workflow: successful on recent dispatcher lineage

Known failure:
- `test:standalone` currently reports `#22 juniorExocet: raw Finding mismatch`.
- Printed actual/expected data are structurally identical. The Exocet path passes the host WASM Finding through a validator executed inside the Node `vm` oracle realm; Node strict deep equality treats cross-realm object prototypes as unequal.
- This is a differential-harness normalization defect, not evidence permitting any Exocet algorithm or ordering change.

## Exact next task

1. In `wasm-migration/tests/standalone-finder-differential.mjs`, normalize the result of `oracle.validateFindingAgainstSolution(...)` back into the host realm before strict comparison.
2. Do not change Exocet discovery, selection, ordering, sanitization, or Finding contents.
3. Let `WASM Migration CI` rerun and require `test:standalone` to pass.
4. Then inspect the exhaustive full-trace differential and DFC benchmark results before starting another implementation unit.
5. Update this file after the gate result and commit the state update.

## Semantic constraints

- Current readable JS remains the behavioral oracle.
- Preserve TECHNIQUE_CHAIN, scan/digit/combination ordering, first-match behavior, Finding selection, elimination/pattern ordering, forcing-chain assumption/contradiction ordering, DFC budget semantics, and nested propagation depth.
- Candidate state in the compiled core remains a strict 9-bit mask: `(mask & ~0x1FF) == 0`.
- Do not sort outputs merely to make differentials pass.
- Main-thread and Worker paths must converge on the same WASM core.
- Do not modify `main`.

## Files relevant to the next unit

- `wasm-migration/tests/standalone-finder-differential.mjs`
- `wasm-migration/tests/load-oracle.mjs`
- `wasm-migration/bridge/assembly-core.mjs`
- `Sudoku v3.23.3-rc.3 - DevVer.html`
