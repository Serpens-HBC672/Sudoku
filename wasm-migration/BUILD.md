# BUILD.md

## Local delivery acceptance (Windows / Node 22)

Use `npm ci --no-audit --no-fund` with the supplied package-lock.json, then `npm run build`.
The local delivered runtime is Node 22.23.1 / AssemblyScript 0.27.31 incremental.
`tests/benchmark-corpus.mjs` accepts Windows CRLF without altering the frozen corpus and hashes the actual original bytes.

After building, run `npm run test:coarse`, `npm run test:soundness` and the existing static/dynamic/standalone/Worker scripts. `npm run test:trace` runs all 57 puzzles at budget 6790 with per-case hash-bound checkpoints. The trace gate records complete oracle pre/post states and exact ordered Finding comparisons; it does not run all techniques at every step. Run `npm run benchmark:delivery` only after traces finish and while no other test workload is running; `npm run coverage:delivery` reuses those traces.

The package script `./package-delivery.ps1 -Name <new-directory-name>` copies only delivery files, hashes them, creates a ZIP, extracts it, verifies every copied file and runs a positive minimal module call from the extracted copy. It refuses to overwrite an existing directory/ZIP. See DELIVERY_REPORT.md for actual results and manifest.json at the package root for file hashes.

Historical CI run [36108090845](https://github.com/Serpens-HBC672/Sudoku/actions/runs/36108090845) was supplied as completed/success in the handoff (PR merge commit `1ea73a37b5918290d6c6f478fe0ad882c1cbf923`, tree `3515805fad34759010f21902296a25516a8b6390`, equal to staging). It was not rerun or waited on during local delivery. Its status is inherited evidence; local evidence is under evidence/.

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
