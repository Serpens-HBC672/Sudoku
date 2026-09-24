# WASM prototype usage

This directory is intentionally isolated from the production HTML. The prototype does not change UI/UX and does not touch the MRV puzzle generator.

## Build

From `wasm-migration/`:

```bash
npm install
npm run build
npm run build:simd
```

Outputs:

- `build/sudoku-techniques.wasm`
- `build/sudoku-techniques-simd.wasm`

The SIMD profile only enables the WebAssembly SIMD feature. The current milestone does not claim an explicit vectorized algorithm; see `PERFORMANCE_NOTES.md`.

## Differential test

```bash
npm test
```

The test:

1. loads the readable DevVer solver as the JS behavioral oracle;
2. confirms the current registry contains 53 techniques;
3. parses all 57 benchmark boards;
4. snapshots each board's 9-bit candidate masks;
5. runs deterministic true/false static forcing-chain assumptions in JS and WASM;
6. compares contradiction result, true-fact insertion order, false-fact insertion order, and the propagated grid.

Any mismatch fails the run.

## Generate JS oracle traces

All boards:

```bash
npm run oracle -- --ids all
```

Selected boards:

```bash
npm run oracle -- --ids 22,23,39,44,56
```

Add the existing "list all available techniques" scan to recorded states:

```bash
npm run oracle -- --ids 42,55 --coverage
```

The full coverage scan calls `findAllAvailableSteps()` and can be extremely expensive on Dynamic Forcing Chain states. Use `--coverage-stride N` or `--coverage-max-states N` to bound it.

Generated JSON records preserve:

- pre-step grid;
- all 81 candidate masks;
- exact first-match raw Finding;
- post-step grid;
- post-step candidate masks;
- the shared soundness-gate result;
- optional all-technique findings for coverage states.

## JS adapter

`bridge/assembly-core.mjs` is the prototype loader/adapter. It deliberately uses per-cell setters rather than a new production memory ABI. That keeps the first compiled milestone auditable; a bulk linear-memory ABI should be introduced only after the static propagation differential gate is green.

## Base64 embedding

The repository owner plans to inline the final WASM bytes later. The migration does not require that during development. Once a final binary is approved, the adapter can instantiate decoded bytes with:

```js
const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
const { instance } = await WebAssembly.instantiate(bytes, imports);
```

The final Base64 packaging step is intentionally separate from algorithm verification.
