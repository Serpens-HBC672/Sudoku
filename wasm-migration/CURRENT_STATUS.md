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
