# BUILD.md

## Authoritative source

This migration is built against the frozen readable baseline:

- source branch: `feat/android-release-packaging`
- source commit: `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`
- readable source: `Sudoku v3.23.3-rc.3 - DevVer.html`
- readable-source Git blob: `80402c3fadd8a7cd408fc283ea6e9632fa8833cc`
- benchmark corpus: `求解器的数独基准测试盘面参考.txt`
- benchmark Git blob: `3ebce44796bc41a18d94f2b00925f762a13365fd`

The minified/mangled distribution source on `main` is not a migration input.

## Toolchain

- implementation language: AssemblyScript
- AssemblyScript: **0.27.31**
- Node.js: **22.x** in CI
- CI runner: Ubuntu 24.04 / current `ubuntu-latest` where stated by the workflow
- package metadata: `wasm-migration/package.json`

The module uses AssemblyScript's **incremental runtime**. Controlled shared-instance #1→#22 evidence (workflow `36018679055`) showed the historical `stub` runtime trapping at #22 after linear memory reached 4 GiB, while `incremental` completed all 22 puzzles with exact 1867/1867 selected-Finding parity, peak/final linear memory of 524288 bytes (8 pages), no explicit boundary collection, and a 142447-byte WASM binary. `minimal` with explicit `__collect()` at safe puzzle boundaries also completed with exact parity, but still reached 2 GiB and requires lifecycle integration at puzzle boundaries, so it is not the documented production runtime.

## Reproducible build

From `wasm-migration/`:

```sh
npm install --no-audit --no-fund
npm run build
```

Equivalent scalar compiler invocation:

```sh
asc assembly/core.ts \
  --runtime incremental \
  --optimizeLevel 3 \
  --shrinkLevel 0 \
  --exportRuntime \
  --outFile build/sudoku-techniques.wasm
```

SIMD-enabled profile:

```sh
npm run build:simd
```

Equivalent command:

```sh
asc assembly/core.ts \
  --runtime incremental \
  --optimizeLevel 3 \
  --shrinkLevel 0 \
  --exportRuntime \
  --enable simd \
  --outFile build/sudoku-techniques-simd.wasm
```

`--enable simd` only enables the WebAssembly feature. It is **not** evidence that the emitted solver contains useful `v128` operations. Scalar/SIMD hashes and sizes are recorded by CI; SIMD is retained only if measured solver workloads justify it.

## Validation build

```sh
npm run corpus
npm run build
npm run test:static
npm run test:dynamic
npm run test:dynamic-finders
npm run test:standalone
npm run test:static-finders
npm run test:worker
```

Long-running gates are separate workflows:

- `.github/workflows/wasm-full-trace-differential.yml`
- `.github/workflows/wasm-coverage.yml`
- `.github/workflows/wasm-dfc-benchmark.yml`
- `.github/workflows/wasm-representative-benchmark.yml`

## Output and verification

Primary binary:

`build/sudoku-techniques.wasm`

Verify locally:

```sh
sha256sum build/sudoku-techniques.wasm
wc -c build/sudoku-techniques.wasm
```

The migration CI writes `build/SHA256SUMS.txt` and `build/SIZES.txt` and uploads the compiled scalar/SIMD modules as an artifact.

The final delivery intentionally does **not** Base64-inline the module. Base64 packaging can wrap the same bytes later without changing the solver ABI or semantics.
