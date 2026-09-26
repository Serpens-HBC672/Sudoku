# Sudoku

Open `Sudoku v3.23.3-rc.3 - WASM.html` directly to run the application. This is the only root application HTML and the explicit Android packaging entry (`package.json` → `sudoku.webSource`). The WASM engine and adapter are embedded; no runtime download is required.

## Build and verify

```sh
npm ci --prefix wasm-migration
npm run build --prefix wasm-migration
npm run build:web
npm run check:web
npm run test:app --prefix wasm-migration
npm run prepare:web
```

The immutable JavaScript baseline is `wasm-migration/oracle/sudoku.html`; it is test/build input, never an Android entry. `scripts/build-web.mjs` combines it with `wasm-migration/app/runtime.js`, the browser adapter and the compiled engine to regenerate the root HTML. Do not hand-edit the generated file.

Normal hints, auto solving, difficulty evaluation and available-technique lists use WASM in both the main-thread and generated Blob Worker paths. Custom technique order is preserved. Detailed chain derivations use the original JavaScript path because those display details are not part of the WASM ABI. If WASM cannot initialize, the original JavaScript solver remains available; runtime search errors are not silently hidden by fallback.

Every position load supplies its original puzzle givens after reset in the same call. Never replace them with the evolving current board. The three existing soundness checks remain active.

Android build/signing instructions: [MOBILE_RELEASE.md](MOBILE_RELEASE.md). CI APKs are validation builds, not production-signed releases.
