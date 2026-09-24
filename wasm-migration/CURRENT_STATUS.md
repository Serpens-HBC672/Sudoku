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
