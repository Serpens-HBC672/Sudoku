# WASM_USAGE.md

Local delivery adds optional `solution` to the browser Worker's `loadPosition` message. It is reset on every load and init. Coarse findNext/findAll apply exactly the frozen oracle's Exocet known-solution rule when a solution is supplied; omitted solution leaves the original no-validator behavior. `bridge/finding-validator.js` exposes that same rule for main-thread callers. No JavaScript technique search is used as a fallback.

The original application HTML remains the frozen oracle, not a deployed WASM application. Adapter invocation, Node worker_threads parity, and real Edge module Worker parity have separate evidence scopes in DELIVERY_REPORT.md. Browser test coverage at budget 64 is a smoke test, not full-budget DFC evidence.

## Module

Compiled module: `sudoku-techniques.wasm`.

The owner can instantiate the binary directly. No generated AssemblyScript JS loader is mandatory.

Required import:

```js
{
  env: {
    abort(messagePtr, filePtr, line, column) { ... }
  }
}
```

The supplied adapters provide this import and call `WebAssembly.instantiate` directly.

## Initialization

Node/test adapter:

```js
import { instantiateCore } from "./bridge/assembly-core.mjs";
const core = await instantiateCore(wasmBytesOrFileUrl);
```

Browser-safe adapter:

```js
import { instantiateCore } from "./bridge/sudoku-wasm-adapter.js";
const core = await instantiateCore(wasmBytes);
```

The same compiled module is used by the main-thread adapter and Worker adapter.

## Input layout

The integration intentionally uses a narrow explicit setter ABI rather than exposing AssemblyScript object layouts.

A solver state consists of:

- 81 grid cells, row-major, digit `0..9`;
- 81 candidate masks, row-major;
- optional immutable 81-cell given grid for techniques such as GSP.

Candidate mask invariant:

```text
(mask & ~0x1FF) == 0
bit 0 -> digit 1
...
bit 8 -> digit 9
```

The JS adapter loads a position with:

```js
loadPosition(core, grid9x9, masks81, givenGrid9x9);
```

Pass the immutable original puzzle as the fourth argument on **every** position load. `loadPosition` resets all inputs, including givens. Omitting givens (or passing `null`) intentionally disables GSP and must not be used for parity with a JS call that receives givens. Never substitute the evolving current grid. The legacy `loadGivenGrid(core, givens)` API remains supported, but must be called **after** each `loadPosition`.

Internally the authoritative candidate representation remains a 9-bit mask. Digit arrays are only derived views used when recreating the existing JS Finding/context shape.

## Coarse search API

Preferred main-thread entry:

```js
const finding = findNextStepWasm(core, {
  budgetLimit: 6790,
  validator, // optional; used for the existing Exocet solution validator in tests
});
```

Search order is performed inside the module by `runFindNextTechniqueIdFrom`, following the frozen 53-entry `TECHNIQUE_CHAIN`.

For the UI option that lists all available techniques:

```js
const findings = findAllAvailableStepsWasm(core, { budgetLimit: 6790, validator });
```

The module first scans the full registry in one call and exposes two availability bitmasks. The scan only identifies which techniques hit; because finders can share result buffers, JS reruns each reported hit in registry order before materializing its Finding, making that finder's own result buffer current. This keeps the coarse availability scan without treating earlier shared result buffers as persistent.

Lower-level migration/test APIs remain available for exact per-technique differential tests and propagation tests. They are not the preferred application boundary.

## Finding ABI

WASM keeps technique-specific packed result buffers: action kind, cell/digit fields, packed fact ids, pattern-cell indexes and tagged metadata.

The JS compatibility adapter reconstructs the existing Finding contract:

```text
packed WASM result
    -> JS compatibility adapter
    -> existing Finding shape
    -> existing wrapFinding / renderer / UI
```

The UI does not need to understand WASM offsets, masks, technique ids or internal metadata.

No semantically meaningful ordering is sorted or normalized by the adapter. Pattern cells, eliminations, chain nodes, combination-derived arrays and contexts retain oracle order.

## Memory ownership and lifetime

Input state is copied into module-owned fixed buffers through explicit setters. JS retains ownership of its input arrays.

Returned Finding objects are ordinary JS objects reconstructed from scalar exports and result buffers; they do not borrow pointers into WASM memory.

The AssemblyScript module uses the incremental runtime. In the controlled shared-instance #1→#22 comparison, it preserved exact 1867/1867 selected-Finding parity while holding peak/final linear memory to 524288 bytes (8 pages) without explicit boundary collection. Application code must not retain raw pointers into module memory.

## Worker

Worker bridge: `bridge/sudoku-wasm-worker.js`.

Conceptual architecture:

```text
                    -> main-thread adapter
same sudoku-techniques.wasm
                    -> Worker adapter
```

Worker commands include loading a position and coarse `findNext` / `findAll` searches as well as lower-level migration diagnostics. Main-thread and Worker parity is covered by `tests/worker-parity.mjs`.

The Worker should receive the same `.wasm` bytes (for example as a transferred `ArrayBuffer`) and instantiate the module locally. It must not fall back to the old JS solver as a second computational authority.

## Future Base64 embedding

Base64 embedding is intentionally outside this migration.

A future packager may:

1. Base64-encode the exact validated `.wasm` bytes.
2. Decode them at runtime into a `Uint8Array`.
3. Pass that byte array to the same `instantiateCore` function.

No solver code, candidate representation, Finding conversion, technique ordering, DFC budget or Worker behavior needs to change.
