# Human-technique JS -> WASM migration contract

## Frozen authority

This migration branch starts from:

- source branch: `feat/android-release-packaging`
- frozen source commit: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- readable source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- benchmark corpus: `求解器的数独基准测试盘面参考.txt` (57 boards)

The JavaScript DevVer implementation is the behavioral oracle until a WASM implementation has passed differential verification.

## Scope

In scope:

- the 53 human solving techniques registered in `TECHNIQUE_CHAIN`;
- candidate-mask and technique-search support needed by those techniques;
- forcing-chain propagation and its exact budget/order semantics;
- a compatibility adapter that returns the current JS-facing Finding shape;
- benchmark, oracle-trace, coverage, and differential-test tooling.

Out of scope:

- MRV/backtracking puzzle generation;
- DLX uniqueness solving unless a later migration step requires a read-only test helper;
- UI/UX, rendering, Chinese explanations, highlighting, controls, settings behavior;
- unrelated application behavior.

The MRV generator is intentionally left to the repository owner.

## Correctness gates

Every migrated step is rejected if any of the following occurs:

1. an elimination removes the digit that is the known final solution for that cell;
2. a fill/fix/advanced action writes a digit different from the known final solution;
3. after applying the step, an affected empty cell has zero candidates.

The third check existed visually in reports as `×` but was not previously an actual gate. This branch upgrades it to a real `verifySoundnessAfterApply` failure.

Exact differential comparison additionally preserves:

- technique order;
- row/column/box traversal order;
- digit order;
- combination enumeration order;
- first-match behavior;
- elimination array order;
- contradiction selection order;
- forcing-chain true/false fact insertion order;
- DFC budget accounting and abort semantics.

A mathematically valid but differently selected first finding is still a migration mismatch.

## Technique coverage

The existing `findAllAvailableSteps()` implementation is reused as the coverage probe. The migration hook exposes two complementary modes:

- `tracePuzzle()`: normal first-match solving trace without running all 53 techniques at every step;
- `enumerateAvailableFromMasks()`: full 53-technique scan of a recorded state.

This separation is deliberate. Running all 53 techniques at every state of DFC-heavy boards such as Golden Nugget or Platinum Blonde would distort the performance benchmark by repeatedly invoking the most expensive techniques.

The trace generator can optionally attach full available-finding scans to selected states and produces a machine-readable coverage summary.

## AssemblyScript milestone 1

The first compiled prototype ports the exact static propagation kernel used by the forcing-chain family:

`Naked Single -> Hidden Single -> Locked Candidates`

It preserves the original `propagateAssumptionCore` semantics for:

- 9-bit candidate masks;
- base candidate restrictions;
- true/false fact insertion order;
- incremental candidate/unit masks;
- touched-cell and touched-unit contradiction checks;
- 200-iteration guard;
- row-major / unit / digit scan order.

The differential suite executes deterministic true/false assumptions across all 57 benchmark boards, including a second candidate-mask variant per board. This is a gate for expanding the port into dynamic propagation.

## Next implementation order

After milestone 1 is green:

1. port Naked/Hidden Pair and Triple and X-Wing/Swordfish into the dynamic propagation list;
2. port one-level nested Nishio with shared budget accounting;
3. port Dynamic Nishio / Dynamic Unary outer search;
4. validate on #22, #23, #39, #44, #56 before migrating the remaining technique families;
5. expand raw Finding serialization and JS compatibility adapter;
6. migrate remaining technique families in existing `TECHNIQUE_CHAIN` order, keeping exact per-technique differential tests.

AssemblyScript remains the first implementation language. A C++ prototype is only justified if the real DFC-heavy end-to-end benchmark shows inadequate improvement after the dynamic hotspot has been ported.

## No merge policy

This branch is a migration work branch. Do not merge it into `main` or replace the distribution HTML until exact behavior and benchmark gates are complete.
